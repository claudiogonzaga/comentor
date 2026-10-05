import { format } from 'date-fns';
import {
  addChatMessage,
  getActiveHabits,
  getHabitByType,
  getKV,
  getLatestCompletedInterview,
  getLogsWithMorningFeedback,
  getOrCreateLog,
  getRecentChat,
  getRecentLogs,
  getRecentSnoozeFeedback,
  getStreak,
  getUserConfig,
  incrementReminders,
  markLogCompleted,
  setKV,
  upsertHabit,
} from './database';
import { formatPastSelfQuotes, scheduleMorningCheckin } from './morning';
import { isSleepHabitFormed, minutesLateOf } from './habitFormation';
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
  DailyLog,
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
  /** Falas LITERAIS da própria pessoa em manhãs depois de dormir tarde (datadas). */
  pastSelfQuotes?: string;
  /** Nota quando o hábito de dormir no horário já está consolidado. */
  sleepFormedNote?: string;
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

// ————————————— Micro-entrevista + eu-passado —————————————

const MICRO_INTERVIEW_EVERY_DAYS = 14;
const MICRO_PENDING_KEY = 'micro_interview_pending';
const MICRO_LAST_KEY = 'micro_interview_last';
const FOLLOWUPS_KEY = 'interview_followups';

interface InterviewFollowup {
  date: string;
  text: string;
}

async function readInterviewFollowups(): Promise<InterviewFollowup[]> {
  try {
    const raw = await getKV(FOLLOWUPS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as InterviewFollowup[]) : [];
  } catch {
    return [];
  }
}

/**
 * MICRO-ENTREVISTA. A entrevista do onboarding era foto: uma vez, e nunca mais.
 * A cada ~2 semanas, o abridor do chat termina com UMA pergunta de acompanhamento
 * sobre algo que a pessoa disse ("da última vez você disse que era o celular na
 * cama — ainda é?"). A resposta é guardada e passa a entrar no contexto.
 */
async function microInterviewInstruction(): Promise<string | null> {
  try {
    const interview = await getLatestCompletedInterview();
    if (!interview?.summary) return null;
    const last = (await getKV(MICRO_LAST_KEY)) ?? interview.completedAt ?? interview.createdAt;
    const lastMs = new Date(String(last).replace(' ', 'T')).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < MICRO_INTERVIEW_EVERY_DAYS * 86_400_000) {
      return null;
    }
    await setKV(MICRO_LAST_KEY, new Date().toISOString());
    await setKV(MICRO_PENDING_KEY, '1');
    return (
      'ACOMPANHAMENTO DA ENTREVISTA: já faz mais de duas semanas desde a última vez que você revisitou as causas. ' +
      'Em vez da pergunta aberta genérica, TERMINE com UMA pergunta de acompanhamento sobre algo ESPECÍFICO que a pessoa ' +
      'disse na entrevista (as causas e gatilhos estão em "O QUE VOCÊ JÁ SABE SOBRE A PESSOA"), no formato ' +
      '"da última vez você disse que X — ainda é assim?".'
    );
  } catch {
    return null;
  }
}

/** Se o abridor fez a pergunta de acompanhamento, a resposta seguinte da pessoa é guardada. */
async function captureMicroInterviewAnswer(text: string): Promise<void> {
  try {
    if ((await getKV(MICRO_PENDING_KEY)) !== '1') return;
    await setKV(MICRO_PENDING_KEY, '0');
    const list = await readInterviewFollowups();
    list.push({ date: todayISO(), text: text.replace(/\s+/g, ' ').trim().slice(0, 300) });
    await setKV(FOLLOWUPS_KEY, JSON.stringify(list.slice(-10)));
  } catch {
    /* best-effort */
  }
}

function formatDateBR(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

async function buildPersonalizationContext(habitId: number): Promise<{
  interviewContext: string;
  recentSnoozeFeedback: string;
  pastSelfQuotes: string;
  sleepFormedNote: string;
}> {
  const [interview, feedback, morningLogs, followups, sleep] = await Promise.all([
    getLatestCompletedInterview().catch(() => null),
    getRecentSnoozeFeedback(habitId, 3).catch(() => [] as SnoozeFeedback[]),
    getLogsWithMorningFeedback(habitId, 30).catch(() => [] as DailyLog[]),
    readInterviewFollowups(),
    isSleepHabitFormed(habitId),
  ]);
  let interviewContext = summaryToCoachContext(interview?.summary ?? null);
  if (followups.length > 0) {
    const recent = followups
      .slice(-5)
      .reverse()
      .map((f) => `- ${formatDateBR(f.date)}: "${f.text}"`)
      .join('\n');
    interviewContext =
      `${interviewContext}\nAtualizações que a pessoa deu depois, nas conversas (mais recentes primeiro):\n${recent}`.trim();
  }
  return {
    interviewContext,
    recentSnoozeFeedback: formatSnoozeFeedback(feedback),
    pastSelfQuotes: formatPastSelfQuotes(morningLogs),
    sleepFormedNote: sleep.formed
      ? `O hábito de deitar no horário está CONSOLIDADO (${sleep.onTime} das últimas ${sleep.total} noites no horário). ` +
        'Não cobre como se fosse novidade: reconheça o que ela construiu e trate um deslize como exceção, não como padrão.'
      : '',
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
  if (ctx.pastSelfQuotes && ctx.pastSelfQuotes.trim().length > 0) {
    extras.push(
      `\nO QUE A PRÓPRIA PESSOA DISSE EM MANHÃS DEPOIS DE DORMIR TARDE:\n${ctx.pastSelfQuotes}\n` +
        'Você pode citar UMA dessas falas, literalmente e entre aspas, com a data, quando for pertinente ao que está ' +
        'acontecendo agora. É o argumento mais forte que você tem — é a voz dela mesma. Nunca invente, resuma ou ' +
        'parafraseie uma citação; se não couber, não cite.',
    );
  }
  if (ctx.sleepFormedNote && ctx.sleepFormedNote.trim().length > 0) {
    extras.push(`\nESTADO DO HÁBITO:\n${ctx.sleepFormedNote}`);
  }
  return extras.length ? `${base}\n${extras.join('\n')}` : base;
}

/**
 * O caminho REMOTO (gemini.ts) monta o próprio system prompt a partir de
 * `systemPrompt` + `healthContext` e ignora o resto do contexto. Até aqui, a
 * entrevista e os motivos de adiamento só chegavam ao modelo LOCAL — no Gemini,
 * o caminho principal, eram descartados. Este wrapper entrega ao remoto o
 * prompt já completo, e zera healthContext para ele não anexar a seção de
 * saúde uma segunda vez.
 */
function forRemote(ctx: CoachingContext): CoachingContext {
  return { ...ctx, systemPrompt: buildSystemPromptText(ctx), healthContext: undefined };
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
  return generateCoachMessageRemote(forRemote(context), config.geminiModel, history);
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
  return continueConversationRemote(forRemote(context), config.geminiModel, history, userMessage);
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
  return generateSnoozeArgumentRemote(forRemote(context), config.geminiModel, snoozeMinutes);
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

// Prompt do ABRIR-CHAT: o Askeo puxa conversa comentando o progresso e
// apontando, com gentileza, onde dá pra melhorar — terminando com uma pergunta.
const CHAT_OPENER_PROMPT = `Você é o Askeo, uma coruja-coach calorosa, humana e direta. A pessoa ACABOU de abrir o chat com você. NÃO espere ela falar — INICIE a conversa.

Em 2 a 4 frases curtas: comente o PROGRESSO recente dela usando os dados abaixo (sono, exercício, passos, peso, hábitos), elogie sinceramente o que foi bem e aponte com gentileza UM ponto onde ela pode melhorar. Termine com UMA pergunta aberta e específica para engajar a conversa.

Histórico recente: {recentLogsSummary}

Tom: {tone}. Seja breve, natural e acolhedora. NÃO cite números crus nem soe robótica. NUNCA use saudações genéricas tipo "Olá, como posso ajudar?".`;

/**
 * Mensagem de ABERTURA do chat (quando o usuário toca "Chat com Askeo"):
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
  const personalization = await buildPersonalizationContext(habit.id);
  const micro = await microInterviewInstruction();

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
      systemPrompt: micro ? `${CHAT_OPENER_PROMPT}\n\n${micro}` : CHAT_OPENER_PROMPT,
      ...personalization,
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
 * relevante para o momento e gera a primeira fala do Askeo convencendo
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
  await captureMicroInterviewAnswer(text);
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
  const now = nowHHMM();
  await markLogCompleted(log.id, now);
  const updated = await recordCompletion(habitId, today);
  // Manhã seguinte: pergunta como acordou — já sabendo o quanto passou do
  // horário, então a pergunta sai específica ("deitou 1h40 atrasado…").
  const late = minutesLateOf(log.targetTime || config.bedtime, now) ?? 0;
  void scheduleMorningCheckin(habitId, today, late).catch(() => {});
  return updated;
}

/**
 * Re-registers every Askeo notification (night escalation chain + daily
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
  const sleepFormed = await isSleepHabitFormed(habit.id);
  await scheduleNightReminders({
    bedtime: config.bedtime,
    intervalMinutes: config.reminderIntervalMinutes,
    // Sono consolidado (14 das últimas 16 noites no horário): uma cobrança só,
    // em vez de doze. A coruja que se cala é parte do método.
    maxReminders: sleepFormed.formed ? 2 : 12,
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
