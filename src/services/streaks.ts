import { differenceInCalendarDays, parseISO } from 'date-fns';
import { getStreak, setStreak } from './database';

export async function recordCompletion(habitId: number, dateISO: string) {
  const streak = await getStreak(habitId);
  let current = streak.currentStreak;
  let best = streak.bestStreak;

  if (!streak.lastCompletedDate) {
    current = 1;
  } else {
    const diff = differenceInCalendarDays(parseISO(dateISO), parseISO(streak.lastCompletedDate));
    if (diff === 0) {
      // Already counted today
    } else if (diff === 1) {
      current += 1;
    } else if (diff > 1) {
      current = 1;
    }
  }

  if (current > best) best = current;
  await setStreak(habitId, current, best, dateISO);
  return { current, best };
}

export async function checkBrokenStreak(habitId: number, todayISO: string) {
  const streak = await getStreak(habitId);
  if (!streak.lastCompletedDate || streak.currentStreak === 0) return streak;
  const diff = differenceInCalendarDays(parseISO(todayISO), parseISO(streak.lastCompletedDate));
  if (diff > 1) {
    await setStreak(habitId, 0, streak.bestStreak, streak.lastCompletedDate);
    return { ...streak, currentStreak: 0 };
  }
  return streak;
}
