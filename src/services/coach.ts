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
import { continueConversation, generateCoachMessage } from './gemini';
import { recordCompletion } from './streaks';
import { getIntensityForMinutesLate } from '../constants/intensityLevels';
import type { IntensityLevel } from '../types';

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

  const result = await generateCoachMessage(
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate,
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
    },
    config.geminiModel,
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

  const result = await continueConversation(
    {
      userName: config.name,
      bedtime: config.bedtime,
      currentTime: nowHHMM(),
      minutesLate: minutesPast(config.bedtime),
      level,
      streak: streak.currentStreak,
      tone: config.tone,
      recentLogsSummary: summarizeRecentLogs(recentLogs),
    },
    config.geminiModel,
    history,
    text,
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
