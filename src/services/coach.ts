import { format } from 'date-fns';
import {
  addChatMessage,
  getActiveHabits,
  getHabitByType,
  getOrCreateLog,
  getRecentChat,
  getRecentLogs,
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
import { pickFallback } from './fallbackMessages';
import { recordCompletion } from './streaks';
import { getIntensityForMinutesLate, INTENSITY_LEVELS } from '../constants/intensityLevels';
import { DEFAULT_SYSTEM_PROMPT, fillTemplate } from '../constants/promptTemplate';
import type {
  ChatMessage,
  IntensityLevel,
  LocalModelId,
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
}

function buildSystemPromptText(ctx: CoachingContext): string {
  const template = ctx.systemPrompt && ctx.systemPrompt.trim().length > 0
    ? ctx.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
  return fillTemplate(template, {
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
        maxTokens: 400,
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
        text: 'O modelo local ainda não foi baixado. Vai em Configurações para baixar e voltamos a conversar. 🦉',
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
        maxTokens: 400,
      });
      if (!text.trim()) throw new Error('empty');
      return { text: text.trim(), offline: false };
    } catch (err) {
      console.warn('Local chat failed:', err);
      return {
        text: 'Tive um problema pra te responder agora. Mas o que importa: você ainda está acordado. O que vamos fazer sobre isso? 🦉',
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
        maxTokens: 300,
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
    },
    history,
  );

  await addChatMessage(habit.id, 'corujinha', result.text, level);
  return { message: result.text, level, offline: result.offline, habitId: habit.id };
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
