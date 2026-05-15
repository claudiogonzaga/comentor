import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { IntensityLevel, OwlSpeciesId } from '../types';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';
import { DEFAULT_OWL_SPECIES, getOwlSpecies } from '../constants/owlSpecies';
import { getUserConfig } from './database';

// Android notification channels are immutable once created — changing a
// channel's sound has no effect. Bump this when an owl .wav is replaced so a
// fresh channel is created with the new audio.
const CHANNEL_VERSION = 1;

/** Category that gives sleep reminders their "Vou dormir" / "Adiar" buttons. */
export const SLEEP_CATEGORY = 'comentor-sleep-actions';
export const SLEEP_NOW_ACTION = 'sleep-now';
export const SNOOZE_ACTION = 'snooze-15';

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

/**
 * Registers the action buttons shown on sleep reminders. Tapping a button
 * opens the app; RootNavigator routes the action by its identifier.
 */
export async function ensureNotificationCategories() {
  await Notifications.setNotificationCategoryAsync(SLEEP_CATEGORY, [
    {
      identifier: SLEEP_NOW_ACTION,
      buttonTitle: 'Vou dormir 🌙',
      options: { opensAppToForeground: true },
    },
    {
      identifier: SNOOZE_ACTION,
      buttonTitle: 'Adiar 15 min',
      options: { opensAppToForeground: true },
    },
  ]);
}

function channelIdFor(species: OwlSpeciesId): string {
  return `comentor-owl-${species}-v${CHANNEL_VERSION}`;
}

async function resolveSpecies(species?: OwlSpeciesId): Promise<OwlSpeciesId> {
  if (species) return species;
  try {
    const config = await getUserConfig();
    return config.owlSpecies ?? DEFAULT_OWL_SPECIES;
  } catch {
    return DEFAULT_OWL_SPECIES;
  }
}

/**
 * Ensures the Android notification channel for the given (or active) owl
 * species exists and returns its id. On iOS there are no channels, so it just
 * returns the synthetic id (unused there).
 */
export async function ensureChannel(species?: OwlSpeciesId): Promise<string> {
  const sp = await resolveSpecies(species);
  const id = channelIdFor(sp);
  if (Platform.OS !== 'android') return id;
  const spec = getOwlSpecies(sp);
  await Notifications.setNotificationChannelAsync(id, {
    name: `CoMentor — ${spec.name}`,
    description: 'Lembretes de sono e nudges, com som de coruja',
    importance: Notifications.AndroidImportance.HIGH,
    sound: spec.soundFile ?? 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#F4C553',
    bypassDnd: false,
  });
  return id;
}

/** The .wav filename for iOS notification sound, or 'default'. */
async function soundFor(species?: OwlSpeciesId): Promise<string> {
  const sp = await resolveSpecies(species);
  return getOwlSpecies(sp).soundFile ?? 'default';
}

interface ScheduleParams {
  bedtime: string;
  intervalMinutes: number;
  maxReminders: number;
  habitId: number;
  logId?: number;
  /**
   * Accepted for backwards-compatibility with existing callers. The
   * wind-down / preparation reminder is now a daily nudge (see
   * services/nudges.ts), so this flag is no longer used here.
   */
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
  const channelId = await ensureChannel();
  const sound = await soundFor();
  await ensureNotificationCategories();
  await cancelSleepEscalationReminders();

  const bed = buildBedtimeDate(bedtime);
  const ids: string[] = [];

  for (let i = 0; i < maxReminders; i++) {
    const fireAt = new Date(bed.getTime() + i * intervalMinutes * 60_000);
    const level = (Math.min(5, i + 1) as IntensityLevel);
    const cfg = INTENSITY_LEVELS[level];
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: cfg.notificationTitle,
        body: cfg.notificationBody,
        data: { type: 'sleep-reminder', level, habitId, logId, fireAt: fireAt.toISOString() },
        sound,
        categoryIdentifier: SLEEP_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId,
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
  // Stop the current escalation chain so only the snoozed reminder remains —
  // otherwise the older escalation notifications keep firing on top of it.
  await cancelSleepEscalationReminders();
  const channelId = await ensureChannel();
  const sound = await soundFor();
  await ensureNotificationCategories();

  const fireAt = new Date(Date.now() + minutes * 60_000);
  const cfg = INTENSITY_LEVELS[Math.min(5, level + 1) as IntensityLevel];
  await Notifications.scheduleNotificationAsync({
    content: {
      title: cfg.notificationTitle,
      body: cfg.notificationBody,
      data: { type: 'sleep-reminder', level: cfg.level, habitId, fireAt: fireAt.toISOString() },
      sound,
      categoryIdentifier: SLEEP_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId,
    },
  });
}

export async function listScheduled() {
  return Notifications.getAllScheduledNotificationsAsync();
}

/**
 * Fires an immediate notification so the user can hear what a given owl
 * species sounds like before choosing it.
 */
export async function previewSpeciesSound(species: OwlSpeciesId): Promise<boolean> {
  if (!(await ensurePermissions())) return false;
  const channelId = await ensureChannel(species);
  const spec = getOwlSpecies(species);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${spec.emoji} ${spec.name}`,
      body: spec.call,
      sound: spec.soundFile ?? 'default',
      data: { type: 'sound-preview' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId,
    },
  });
  return true;
}
