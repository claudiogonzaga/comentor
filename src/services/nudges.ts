import * as Notifications from 'expo-notifications';
import { listNudges, updateNudge } from './database';
import { ensureChannel } from './notifications';
import type { Nudge } from '../types';

const CHANNEL_ID = 'comentor-sleep';

/**
 * Cancels all currently-scheduled nudge notifications (any whose
 * data.type starts with `nudge:`). Leaves sleep-escalation, prep, and
 * any other unrelated notifications untouched.
 */
export async function cancelAllNudges(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type?.startsWith('nudge:')) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Cancels existing nudge notifications and re-registers a DAILY repeating
 * notification for every enabled nudge in the database. Idempotent — safe
 * to call after any settings save / on app start.
 */
export async function scheduleAllNudges(): Promise<string[]> {
  await ensureChannel();
  await cancelAllNudges();

  const nudges = await listNudges();
  const ids: string[] = [];

  for (const n of nudges) {
    if (!n.enabled) continue;
    const parts = n.scheduleTime.split(':').map((s) => parseInt(s, 10));
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const safeHour = Math.min(23, Math.max(0, h));
    const safeMinute = Math.min(59, Math.max(0, m));

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `${n.emoji ?? '🦉'} ${n.title}`,
          body: n.body,
          data: { type: `nudge:${n.type}`, nudgeId: n.id, nudgeType: n.type },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: safeHour,
          minute: safeMinute,
          channelId: CHANNEL_ID,
        },
      });
      ids.push(id);
    } catch (err) {
      console.warn(`failed to schedule nudge ${n.type}:`, err);
    }
  }

  return ids;
}

export async function setNudgeEnabled(id: number, enabled: boolean): Promise<Nudge | null> {
  const result = await updateNudge(id, { enabled });
  await scheduleAllNudges();
  return result;
}

export async function setNudgeTime(id: number, scheduleTime: string): Promise<Nudge | null> {
  const result = await updateNudge(id, { scheduleTime });
  await scheduleAllNudges();
  return result;
}
