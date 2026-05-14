import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { IntensityLevel } from '../types';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';

const CHANNEL_ID = 'comentor-sleep';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensurePermissions(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const req = await Notifications.requestPermissionsAsync({
    android: {},
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return req.granted;
}

export async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Lembretes do CoMentor',
    description: 'Lembretes de hábitos de sono',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#F4C553',
    bypassDnd: false,
  });
}

interface ScheduleParams {
  bedtime: string;
  intervalMinutes: number;
  maxReminders: number;
  habitId: number;
  logId?: number;
  prepRemindersEnabled?: boolean;
}

function buildBedtimeDate(bedtime: string, daysAhead = 0): Date {
  const [h, m] = bedtime.split(':').map(Number);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(h, m);
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  if (daysAhead > 0) d.setDate(d.getDate() + daysAhead);
  return d;
}

export async function scheduleNightReminders({
  bedtime,
  intervalMinutes,
  maxReminders,
  habitId,
  logId,
}: ScheduleParams): Promise<string[]> {
  await ensureChannel();
  await cancelSleepEscalationReminders();

  const bed = buildBedtimeDate(bedtime);
  const ids: string[] = [];

  // Note: the prep / wind-down notification is now handled by the
  // "breathing" entry in the nudges table (see services/nudges.ts).
  // scheduleAllNudges() should be called alongside this function so the
  // breathing nudge fires daily at its configured HH:MM.

  for (let i = 0; i < maxReminders; i++) {
    const fireAt = new Date(bed.getTime() + i * intervalMinutes * 60_000);
    const level = (Math.min(5, i + 1) as IntensityLevel);
    const cfg = INTENSITY_LEVELS[level];
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: cfg.notificationTitle,
        body: cfg.notificationBody,
        data: { type: 'sleep-reminder', level, habitId, logId, fireAt: fireAt.toISOString() },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId: CHANNEL_ID,
      },
    });
    ids.push(id);
  }
  return ids;
}

export async function cancelAllReminders() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Cancels only the night-time sleep escalation notifications (5 levels +
 * any snooze), leaving daily nudges (bluelight, supplements, breathing)
 * intact. Used by callers that re-schedule the night chain without
 * disturbing the unrelated daily nudges.
 */
export async function cancelSleepEscalationReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === 'sleep-reminder' || data?.type === 'prep-reminder') {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

export async function snoozeFor(minutes: number, level: IntensityLevel, habitId: number) {
  const fireAt = new Date(Date.now() + minutes * 60_000);
  const cfg = INTENSITY_LEVELS[Math.min(5, level + 1) as IntensityLevel];
  await Notifications.scheduleNotificationAsync({
    content: {
      title: cfg.notificationTitle,
      body: cfg.notificationBody,
      data: { type: 'sleep-reminder', level: cfg.level, habitId, fireAt: fireAt.toISOString() },
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: CHANNEL_ID,
    },
  });
}

export async function listScheduled() {
  return Notifications.getAllScheduledNotificationsAsync();
}
