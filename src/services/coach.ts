import { format } from 'date-fns';
import {
  addChatMessage,
  getActiveHabits,
  getHabitByType,
  getLatestCompletedInterview,
  getOrCreateLog,
  getRecentChat,
  getRecentLogs,
  getRecentSnoozeFeedback,
  getStreak,
  getUserConfig,
  incrementReminders,
  markLogCompleted,
  upsertHabit,
} from './database';
import {
  continueConversation as continueConversationRemote,
  generateCoachMessage as generateCoachMessageRemote,
  generateSnoozeArgument as generateSnoozeArgumentRemote,
} from './gemini';
import { generateLocal, type LocalChatMessage } from './localModel';
import {
  ensureChannel,
  ensureNotificationCategories,
  ensurePermissions,
  scheduleNightReminders,
} from './notifications';
import { scheduleAllNudges } from './nudges';
import { scheduleSleepAwarenessNotifications } from './sleepAwareness';
import { scheduleInspirationNotifications } from './inspiration';
import { scheduleAllMedications } from './medications';
import { scheduleSedentaryNudges } from './sedentary';
import { getHealthSnapshot, formatHealthForCoach } from './health';
import { summaryToCoachContext } from './interview';
import { pickFallback } from './fallbackMessages';
import { recordCompletion } from './streaks';
import { getIntensityForMinutesLate, INTENSITY_LEVELS } from '../constants/intensityLevels';
import { DEFAULT_SYSTEM_PROMPT, fillTemplate } from '../constants/promptTemplate';
import type {
  ChatMessage,
  IntensityLevel,
  LocalModelId,
  SnoozeFeedback,
  Tone,
  UserConfig,
} from '../types';

const SLEEP_HABIT_DEFAULTS = {
  type: 'sleep' as const,
  name: 'Sono',
  daysOfWeek: '0,1,2,3,4,5,6',
};

export async function ensureSleepHabit(bedtime: string) {
  const existing = await getHabitByType('sleep');
  if (existing) return existing;
  await upsertHabit({
    ...SLEEP_HABIT_DEFAULTS,
    target: bedtime,
    reminderTime: bedtime,
  });
  const created = await getHabitByType('sleep');
  if (!created) throw new Error('Could not create sleep habit');
  return created;
}

/**
 * Resolve rapidamente o id do hábito de sono (sem chamar a IA). A tela de
 * chat usa isto para já habilitar o envio de mensagens enquanto a mensagem
 * de abertura ainda está sendo gerada.
 */
export async function getSleepHabitId(): Promise<number> {
  const config = await getUserConfig();
  const habit = await ensureSleepHabit(config.bedtime);
  return habit.id;
}

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function nowHHMM(): string {
  return format(new Date(), 'HH:mm');
}

function minutesPast(bedtime: string): number {
  const [h, m] = bedtime.split(':').map(Number);
  const target = new Date();
  target.setHours(h, m, 0, 0);
  const diff = (Date.now() - target.getTime()) / 60_000;
  return Math.max(0, Math.round(diff));
}

function summarizeRecentLogs(logs: { date: string; completed: boolean; actualTime: string | null }[]): string {
  if (logs.length === 0) return 'sem histórico ainda';
  const completed = logs.filter((l) => l.completed).length;
  const lastSeven = logs.slice(0, 7);
  const onTime = lastSeven.filter((l) => l.completed).length;
  return `${completed}/${logs.length} dias completados; últimos 7 dias: ${onTime}/${lastSeven.length}`;
}

interface CoachingContext {
  userName: string | null;
  bedtime: string;
  currentTime: string;
  minutesLate: number;
  level: IntensityLevel;
  streak: number;
  tone: Tone;
  recentLogsSummary: string;
  systemPrompt?: string;
  interviewContext?: string;
  recentSnoozeFeedback?: string;
  /** Resumo dos dados de saúde (sono/exercício/passos) do Health Connect. */
  healthContext?: string;
}

/**
 * Lê o retrato de saúde do Health Connect e o formata para o contexto da IA.
 * Best-effort: devolve string vazia se indisponível / sem permissão / erro.
 */
async function getHealthContext(): Promise<string> {
  try {
    const snapshot = await getHealthSnapshot();
    return snapshot ? formatHealthForCoach(snapshot) : '';
  } catch {
    return '';
  }
}

function formatSnoozeFeedback(feedback: SnoozeFeedback[]): string {
  if (feedback.length === 0) return '';
  const lines = feedback.slice(0, 3).map((f, i) => {
    const reason = f.reason ?? '';
    const custom = f.customText ?? '';
    const combined = [reason, custom].filter(Boolean).join(' — ');
    return `${i === 0 ? 'último adiamento' : `adiamento -${i}`}: ${combined || '(sem motivo)'}`;
  });
  return lines.join('; ');
}

async function buildPersonalizationContext(
  habitId: number,
): Promise<{ interviewContext: string; recentSnoozeFeedback: string }> {
  const interview = await getLatestCompletedInterview();
  const feedback = await getRecentSnoozeFeedback(habitId, 3);
  return {
    interviewContext: summaryToCoachContext(interview?.summary ?? null),
    recentSnoozeFeedback: formatSnoozeFeedback(feedback),
  };
}

function buildSystemPromptText(ctx: CoachingContext): string {
  const template = ctx.systemPrompt && ctx.systemPrompt.trim().length > 0
    ? ctx.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
  const base = fillTemplate(template, {
    userName: ctx.userName ?? 'amigo(a)',
    bedtime: ctx.bedtime,
    currentTime: ctx.currentTime,
    minutesLate: ctx.minutesLate,
    level: ctx.level,
    technique: INTENSITY_LEVELS[ctx.level].technique,
    streak: ctx.streak,
    tone: ctx.tone,
    recentLogsSummary: ctx.recentLogsSummary,
  });
  const extras: string[] = [];
  if (ctx.interviewContext && ctx.interviewContext.trim().length > 0) {
    extras.push(`\nO QUE VOCÊ JÁ SABE SOBRE A PESSOA (da entrevista inicial):\n${ctx.interviewContext}`);
  }
  if (ctx.recentSnoozeFeedback && ctx.recentSnoozeFeedback.trim().length > 0) {
    extras.push(
      `\nADIAMENTOS RECENTES (motivos que a pessoa deu pra adiar nas últimas vezes):\n${ctx.recentSnoozeFeedback}\n` +
        `Use essa informação para personalizar a abordagem — não repita argumentos genéricos se já souber o motivo real.`,
    );
  }
  if (ctx.healthContext && ctx.healthContext.trim().length > 0) {
    extras.push(
      `\nDADOS DE SAÚDE RECENTES (do Health Connect — use para personalizar, mas não soe robótico citando números crus):\n${ctx.healthContext}`,
    );
  }
  return extras.length ? `${base}\n${extras.join('\n')}` : base;
}

function historyToLocalMessages(history: ChatMessage[]): LocalChatMessage[] {
  return history.slice(-10).map((m) => ({
    role: m.role === 'corujinha' ? 'assistant' : 'user',
    content: m.content,
  }));
}

async function runCoachGeneration(
  config: UserConfig,
  context: CoachingContext,
  history: ChatMessage[],
): Promise<{ text: string; offline: boolean }> {
  if (config.aiBackend === 'local') {
    if (!config.localModelId || !config.localModelDownloaded) {
      return {
        text: pickFallback(context.level, context.tone, {
          bedtime: context.bedtime,
          minutesLate: context.minutesLate,
          streak: context.streak,
        }),
        offline: true,
      };
    }
    try {
      const messages: LocalChatMessage[] = [
        { role: 'system', content: buildSystemPromptText(context) },
        ...historyToLocalMessages(history),
      ];
      if (messages.length === 1 || messages[messages.length - 1].role !== 'user') {
        messages.push({
          role: 'user',
          content: `[Sistema: gere uma mensagem de coach de sono para nível ${context.level}, ${context.minutesLate} minutos atrasado.]`,
        });
      }
      const text = await generateLocal(config.localModelId as LocalModelId, messages, {
        maxTokens: 1200,
      });
      if (!text.trim()) throw new Error('empty');
      return { text: text.trim(), offline: false };
    } catch (err) {
      console.warn('Local model failed, fallback:', err);
      return {
        text: pickFallback(context.level, context.tone, {
          bedtime: context.bedtime,
          minutesLate: context.minutesLate,
          streak: context.streak,
        }),
        offline: true,
      };
    }
  }
  return generateCoachMessageRemote(context, config.geminiModel, history);
}

async function runChatGeneration(
  config: UserConfig,
  context: CoachingContext,
  history: ChatMessage[],
  userMessage: string,
): Promise<{ text: string; offline: boolean }> {
  if (config.aiBackend === 'local') {
    if (!config.localModelId || !config.localModelDownloaded) {
      return {
        text: 'O modelo local ainda não foi baixado. Vai em Configurações para baixar e voltamos a conversar.',
        offline: true,
      };
    }
    try {
      const messages: LocalChatMessage[] = [
        { role: 'system', content: buildSystemPromptText(context) },
        ...historyToLocalMessages(history),
        { role: 'user', content: userMessage },
      ];
      const text = await generateLocal(config.localModelId as LocalModelId, messages, {
        maxTokens: 1200,
      });
      if (!text.trim()) throw new Error('empty');
      return { text: text.trim(), offline: false };
    } catch (err) {
      console.warn('Local chat failed:', err);
      return {
        text: 'Tive um problema pra te responder agora. Mas o que importa: você ainda está acordado. O que vamos fazer sobre isso?',
        offline: true,
      };
    }
  }
  return continueConversationRemote(context, config.geminiModel, history, userMessage);
}

async function runSnoozeGeneration(
  config: UserConfig,
  context: CoachingContext,
  snoozeMinutes: number,
): Promise<{ text: string; offline: boolean }> {
  if (config.aiBackend === 'local') {
    if (!config.localModelId || !config.localModelDownloaded) {
      return {
        text: `Mais ${snoozeMinutes}? A gente sabe como isso termina. Repensa.`,
        offline: true,
      };
    }
    try {
      const userMsg = `[Sistema interno: o usuário acabou de pedir mais ${snoozeMinutes} minutos antes de dormir. ` +
        `Está atrasado ${context.minutesLate} minutos. Streak: ${context.streak} dias. Tom: ${context.tone}. ` +
        `Gere UMA resposta curta (2-3 frases, máx 250 caracteres) tentando convencê-lo a NÃO adiar. ` +
        `Use uma técnica de persuasão (aversão à perda, identidade, ou efeito dotação da streak). ` +
        `Não seja moralista. Seja direto e respeitoso.]`;
      const messages: LocalChatMessage[] = [
        { role: 'system', content: buildSystemPromptText(context) },
        { role: 'user', content: userMsg },
      ];
      const text = await generateLocal(config.localModelId as LocalModelId, messages, {
        maxTokens: 800,
      });
      if (!text.trim()) throw new Error('empty');
      return { text: text.trim(), offline: false };
    } catch (err) {
      console.warn('Local snooze failed:', err);
      return {
        text: `Mais ${snoozeMinutes}? Sua versão de amanhã está te observando. Volta agora.`,
        offline: true,
      };
    }
  }
  return generateSnoozeArgumentRemote(context, config.geminiModel, snoozeMinutes);
}

export interface CoachInvocationResult {
  message: string;
  level: IntensityLevel;
  offline: boolean;
  habitId: number;
}

export async function getCoachMessageForNow(): Promise<CoachInvocationResult> {
  const config = await getUserConfig();
  const habit = await ensureSleepHabit(config.bedtime);
  const log = await getOrCreateLog(habit.id, todayISO(), config.bedtime);
  await incrementReminders(log.id);

  const minutesLate = minutesPast(config.bedtime);
  const level = getIntensityForMinutesLate(minutesLate, config.reminderIntervalMinutes);
  const streak = await getStreak(habit.id);
  const recentLogs = await getRecentLogs(habit.id, 14);
  const history = await getRecentChat(habit.id, 10);
  const personalization = await buildPersonalizationContext(habit.id);
  const healthContext = await getHealthContext();

  const result = await runCoachGeneration(
    config,
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate,
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
      systemPrompt: config.systemPrompt,
      ...personalization,
      healthContext,
    },
    history,
  );

  await addChatMessage(habit.id, 'corujinha', result.text, level);
  return { message: result.text, level, offline: result.offline, habitId: habit.id };
}

// Prompt do ABRIR-CHAT: a Comentora puxa conversa comentando o progresso e
// apontando, com gentileza, onde dá pra melhorar — terminando com uma pergunta.
const CHAT_OPENER_PROMPT = `Você é a Comentora, uma coruja-coach calorosa, humana e direta. A pessoa ACABOU de abrir o chat com você. NÃO espere ela falar — INICIE a conversa.

Em 2 a 4 frases curtas: comente o PROGRESSO recente dela usando os dados abaixo (sono, exercício, passos, peso, hábitos), elogie sinceramente o que foi bem e aponte com gentileza UM ponto onde ela pode melhorar. Termine com UMA pergunta aberta e específica para engajar a conversa.

Histórico recente: {recentLogsSummary}

Tom: {tone}. Seja breve, natural e acolhedora. NÃO cite números crus nem soe robótica. NUNCA use saudações genéricas tipo "Olá, como posso ajudar?".`;

/**
 * Mensagem de ABERTURA do chat (quando o usuário toca "Chat com Comentora"):
 * a coruja conduz, comentando o progresso e onde melhorar. Persiste a fala e a
 * devolve. Independente do fluxo de "convencer a dormir".
 */
export async function getChatOpenerForNow(): Promise<CoachInvocationResult> {
  const config = await getUserConfig();
  const habit = await ensureSleepHabit(config.bedtime);
  const minutesLate = minutesPast(config.bedtime);
  const level = getIntensityForMinutesLate(minutesLate, config.reminderIntervalMinutes);
  const streak = await getStreak(habit.id);
  const recentLogs = await getRecentLogs(habit.id, 14);
  const history = await getRecentChat(habit.id, 6);
  const healthContext = await getHealthContext();

  const result = await runCoachGeneration(
    config,
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate,
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
      systemPrompt: CHAT_OPENER_PROMPT,
      healthContext,
    },
    history,
  );

  await addChatMessage(habit.id, 'corujinha', result.text, level);
  return { message: result.text, level, offline: result.offline, habitId: habit.id };
}

export interface ConvinceFocus {
  emoji: string;
  title: string;
  blurb: string;
}

export interface ConvinceResult {
  message: string;
  level: IntensityLevel;
  offline: boolean;
  habitId: number;
  focus: ConvinceFocus;
}

function minutesUntilBedtime(bedtime: string): number {
  const [h, m] = bedtime.split(':').map(Number);
  const target = new Date();
  target.setHours(h, m, 0, 0);
  let diff = Math.round((target.getTime() - Date.now()) / 60_000);
  if (diff < -720) diff += 1440;
  return diff;
}

/** Escolhe o comportamento de sono mais relevante para o momento atual. */
function pickConvinceFocus(bedtime: string): ConvinceFocus {
  const until = minutesUntilBedtime(bedtime);
  const hour = new Date().getHours();
  if (until <= 0) {
    return {
      emoji: '🌙',
      title: 'Ir para a cama agora',
      blurb: 'Já passou do seu horário — cada minuto acordado é sono profundo perdido.',
    };
  }
  if (until <= 45) {
    return {
      emoji: '🌬️',
      title: 'Começar a desacelerar',
      blurb: 'Falta pouco pra dormir: respiração lenta e telas longe preparam o corpo.',
    };
  }
  if (hour >= 18) {
    return {
      emoji: '🕶️',
      title: 'Cortar a luz azul',
      blurb: 'O sol já se foi — luz de telas agora atrasa a melatonina e empurra seu sono.',
    };
  }
  if (hour >= 12) {
    return {
      emoji: '☕',
      title: 'Chega de cafeína por hoje',
      blurb: 'Café da tarde ainda está no seu corpo na hora de dormir.',
    };
  }
  return {
    emoji: '☀️',
    title: 'Pegar sol da manhã',
    blurb: 'Luz natural cedo acerta seu relógio e melhora o sono desta noite.',
  };
}

/**
 * Abre uma conversa de persuasão: escolhe o comportamento de sono mais
 * relevante para o momento e gera a primeira fala da Comentora convencendo
 * a pessoa a adotá-lo agora. A instrução enviada à IA é efêmera — só a
 * resposta dela é salva no histórico.
 */
export async function getConvinceMessageForNow(): Promise<ConvinceResult> {
  const config = await getUserConfig();
  const habit = await ensureSleepHabit(config.bedtime);
  const log = await getOrCreateLog(habit.id, todayISO(), config.bedtime);
  await incrementReminders(log.id);

  const minutesLate = minutesPast(config.bedtime);
  const level = getIntensityForMinutesLate(minutesLate, config.reminderIntervalMinutes);
  const streak = await getStreak(habit.id);
  const recentLogs = await getRecentLogs(habit.id, 14);
  const history = await getRecentChat(habit.id, 6);
  const personalization = await buildPersonalizationContext(habit.id);
  const healthContext = await getHealthContext();
  const focus = pickConvinceFocus(config.bedtime);

  const instruction =
    `[Instrução interna: o usuário tocou em "Me convença a ser saudável". ` +
    `Comportamento-foco para agora (${nowHHMM()}): ${focus.title} — ${focus.blurb} ` +
    `Escreva a PRIMEIRA mensagem da conversa: convença a pessoa, de forma calorosa ` +
    `e persuasiva (sem moralismo, no máximo 4 frases), a adotar esse comportamento ` +
    `agora. Use uma técnica de persuasão concreta (benefício imediato, identidade ou ` +
    `aversão à perda). Termine com uma pergunta que abra o diálogo.]`;

  const result = await runChatGeneration(
    config,
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate,
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
      systemPrompt: config.systemPrompt,
      ...personalization,
      healthContext,
    },
    history,
    instruction,
  );

  await addChatMessage(habit.id, 'corujinha', result.text, level);
  return {
    message: result.text,
    level,
    offline: result.offline,
    habitId: habit.id,
    focus,
  };
}

export async function sendUserMessage(
  habitId: number,
  text: string,
  level: IntensityLevel,
): Promise<{ message: string; offline: boolean }> {
  const config = await getUserConfig();
  await addChatMessage(habitId, 'user', text);
  const history = await getRecentChat(habitId, 10);
  const streak = await getStreak(habitId);
  const recentLogs = await getRecentLogs(habitId, 14);

  const personalization = await buildPersonalizationContext(habitId);
  const healthContext = await getHealthContext();
  const result = await runChatGeneration(
    config,
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate: minutesPast(config.bedtime),
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
      systemPrompt: config.systemPrompt,
      ...personalization,
      healthContext,
    },
    history,
    text,
  );

  await addChatMessage(habitId, 'corujinha', result.text, level);
  return { message: result.text, offline: result.offline };
}

export async function getSnoozeArgument(
  habitId: number,
  level: IntensityLevel,
  snoozeMinutes: number,
): Promise<{ message: string; offline: boolean }> {
  const config = await getUserConfig();
  const streak = await getStreak(habitId);
  const recentLogs = await getRecentLogs(habitId, 14);

  const personalization = await buildPersonalizationContext(habitId);
  const result = await runSnoozeGeneration(
    config,
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate: minutesPast(config.bedtime),
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
      systemPrompt: config.systemPrompt,
      ...personalization,
    },
    snoozeMinutes,
  );

  await addChatMessage(habitId, 'corujinha', result.text, level);
  return { message: result.text, offline: result.offline };
}

export async function markSleepDone(habitId: number) {
  const today = todayISO();
  const config = await getUserConfig();
  const log = await getOrCreateLog(habitId, today, config.bedtime);
  await markLogCompleted(log.id, nowHHMM());
  const updated = await recordCompletion(habitId, today);
  return updated;
}

/**
 * Re-registers every Comentora notification (night escalation chain + daily
 * nudges) onto the channel for the user's currently selected owl sound.
 * Call after the owl species changes so the new sound takes effect without
 * waiting for the next Settings save.
 */
export async function rescheduleAllNotifications(): Promise<void> {
  if (!(await ensurePermissions())) return;
  const config = await getUserConfig();
  await ensureNotificationCategories();
  await ensureChannel(config.owlSpecies);
  const habit = await ensureSleepHabit(config.bedtime);
  await scheduleNightReminders({
    bedtime: config.bedtime,
    intervalMinutes: config.reminderIntervalMinutes,
    maxReminders: 12,
    habitId: habit.id,
  });
  await scheduleAllNudges();
  await scheduleSleepAwarenessNotifications();
  await scheduleInspirationNotifications();
  // Remédios/hábitos e o nudge de sedentário também são reagendados para que,
  // ao alternar o modo silencioso, todos caiam no canal certo (silencioso/com som).
  await scheduleAllMedications();
  await scheduleSedentaryNudges();
}

export async function getDashboardData() {
  const config = await getUserConfig();
  const habits = await getActiveHabits();
  const sleepHabit = habits.find((h) => h.type === 'sleep');
  let streak = { currentStreak: 0, bestStreak: 0 };
  let todayLog = null;
  if (sleepHabit) {
    const s = await getStreak(sleepHabit.id);
    streak = { currentStreak: s.currentStreak, bestStreak: s.bestStreak };
    todayLog = await getOrCreateLog(sleepHabit.id, todayISO(), config.bedtime);
  }
  const minutesToBedtime = (() => {
    if (!config.bedtime) return null;
    const [h, m] = config.bedtime.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    let diff = Math.round((target.getTime() - Date.now()) / 60_000);
    if (diff < -60 * 12) diff += 60 * 24;
    return diff;
  })();

  return {
    config,
    habits,
    sleepHabit,
    streak,
    todayLog,
    minutesToBedtime,
  };
}
