import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import type { IntensityLevel, OwlSpeciesId } from '../types';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';
import { DEFAULT_OWL_SPECIES, getOwlSpecies } from '../constants/owlSpecies';
import { getUserConfig } from './database';

// Android notification channels are immutable once created — changing a
// channel's sound (or vibration pattern) has no effect on an existing channel.
// Bump this when an owl sound is replaced, or when the vibration pattern below
// changes, so a fresh channel is created with the new audio/vibration.
//
// v4: owl sounds replaced in 1.18.0 (owl_buraqueira / owl_corujinha_mato /
//     owl_bubo_bubo) + owl-song vibration pattern introduced.
// v5: owl sounds trimmed to a brief, louder hoot (~3s, normalized) in 1.21.0.
//     Bumping also rescues installs whose v4 channel got stuck silent (e.g.
//     created in a bad state on an earlier upgrade) — a fresh channel id forces
//     Android to re-read the (correct) sound.
// v6: 1.22.0 — the DND-bypass channel now ALSO plays the owl call (was
//     sound:null = silent), and every channel is lockscreenVisibility=PUBLIC so
//     watches/wearables mirror the full notification. Bumping forces Android to
//     rebuild the channels with the new (audible) config — the previous channel
//     could be stuck silent.
const CHANNEL_VERSION = 6;

// Vibração que imita o canto de uma coruja ("hoo, hoo-hoo, hoooo"): pulsos
// curtos seguidos de um pulso longo. Formato Android: [espera, vibra, pausa,
// vibra, ...] em milissegundos. Usado para que a coruja "cante" mesmo quando
// o som está mudo (ex.: telefone no silencioso / vibração).
const OWL_VIBRATION_PATTERN = [0, 200, 200, 200, 200, 200, 450, 550];

/** Category that gives sleep reminders their "Vou dormir" / "Adiar" buttons. */
export const SLEEP_CATEGORY = 'comentor-sleep-actions';
export const SLEEP_NOW_ACTION = 'sleep-now';
export const SNOOZE_ACTION = 'snooze-15';

/**
 * Category that gives "verify" behavior nudges (suplemento, óculos de luz
 * azul, etc.) a confirmation button. The owl keeps insisting until the user
 * taps "Já fiz ✅".
 */
export const NUDGE_CATEGORY = 'comentor-nudge-actions';
export const NUDGE_DONE_ACTION = 'nudge-done';
export const NUDGE_SNOOZE_ACTION = 'nudge-snooze';

/**
 * Category for medication/supplement reminders. The owl keeps insisting until
 * the user taps "Já tomei 💊". Separate from NUDGE_CATEGORY so the button copy
 * matches taking a medication (vs. the generic "Já fiz ✅").
 */
export const MED_CATEGORY = 'comentor-med-actions';
export const MED_DONE_ACTION = 'med-done';
export const MED_SNOOZE_ACTION = 'med-snooze';

/**
 * Variante da MED_CATEGORY para hábitos de FAZER (ver sol, respiração, beber
 * água…), em vez de tomar. Mesmos action identifiers (o roteamento em
 * RootNavigator é idêntico) — muda só o texto do botão: "Já fiz ✅" sem o
 * remédio/pílula, que não fazia sentido para um hábito.
 */
export const MED_DO_CATEGORY = 'comentor-med-do-actions';

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
  // Confirmation buttons for "verify" behavior nudges. Both open the app so
  // RootNavigator can handle them reliably even from a cold start (a killed
  // app can't run JS for a background action without a registered task), which
  // matches the proven sleep-reminder buttons.
  await Notifications.setNotificationCategoryAsync(NUDGE_CATEGORY, [
    {
      identifier: NUDGE_DONE_ACTION,
      buttonTitle: 'Já fiz ✅',
      options: { opensAppToForeground: true },
    },
    {
      identifier: NUDGE_SNOOZE_ACTION,
      buttonTitle: 'Lembrar depois',
      options: { opensAppToForeground: true },
    },
  ]);
  // Medication/supplement reminders: the owl insists until "Já tomei 💊".
  await Notifications.setNotificationCategoryAsync(MED_CATEGORY, [
    {
      identifier: MED_DONE_ACTION,
      buttonTitle: 'Já tomei 💊',
      options: { opensAppToForeground: true },
    },
    {
      identifier: MED_SNOOZE_ACTION,
      buttonTitle: 'Lembrar depois',
      options: { opensAppToForeground: true },
    },
  ]);
  // Mesmos botões, mas para hábitos de FAZER (não tomar): "Já fiz ✅" sem pílula.
  await Notifications.setNotificationCategoryAsync(MED_DO_CATEGORY, [
    {
      identifier: MED_DONE_ACTION,
      buttonTitle: 'Já fiz ✅',
      options: { opensAppToForeground: true },
    },
    {
      identifier: MED_SNOOZE_ACTION,
      buttonTitle: 'Lembrar depois',
      options: { opensAppToForeground: true },
    },
  ]);
}

function channelIdFor(species: OwlSpeciesId, dnd: boolean): string {
  return `comentor-owl-${species}-v${CHANNEL_VERSION}${dnd ? '-dnd' : ''}`;
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

async function resolveDndBypass(): Promise<boolean> {
  try {
    const config = await getUserConfig();
    return !!config.dndBypassEnabled;
  } catch {
    return false;
  }
}

/**
 * Ensures the Android notification channel for the given (or active) owl
 * species exists and returns its id. On iOS there are no channels, so it just
 * returns the synthetic id (unused there).
 *
 * When DND-bypass is on, a SEPARATE channel is used: it pierces Do Not Disturb
 * AND plays the owl call (v6: it used to be silent/vibrate-only, which the user
 * read as "no sound"). (Android channels are immutable, so the bypass flag is
 * baked into a distinct channel id; toggling the setting requires rescheduling
 * so notifications land on the new channel.)
 *
 * Every channel is lockscreenVisibility=PUBLIC so paired watches/wearables
 * (e.g. Huawei) mirror the full notification text instead of hiding it.
 */
export async function ensureChannel(
  species?: OwlSpeciesId,
  dndOverride?: boolean,
): Promise<string> {
  const sp = await resolveSpecies(species);
  const dnd = dndOverride ?? (await resolveDndBypass());
  const id = channelIdFor(sp, dnd);
  if (Platform.OS !== 'android') return id;
  const spec = getOwlSpecies(sp);
  await Notifications.setNotificationChannelAsync(id, {
    name: dnd
      ? `Comentora — ${spec.name} (Não Perturbe)`
      : `Comentora — ${spec.name}`,
    description: dnd
      ? 'Atravessa o Não Perturbe e ainda toca o canto da coruja.'
      : 'Lembretes de sono e nudges, com som de coruja',
    importance: Notifications.AndroidImportance.HIGH,
    // The owl now sings on both channels — the DND one just also pierces DND.
    sound: spec.soundFile ?? 'default',
    vibrationPattern: OWL_VIBRATION_PATTERN,
    enableVibrate: true,
    lightColor: '#F4C553',
    bypassDnd: dnd,
    // PUBLIC = the full notification shows on the lock screen and is mirrored
    // to paired wearables (watches hide PRIVATE/SECRET content).
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
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
 * any snooze), leaving daily nudges (bluelight, breathing) and medication
 * reminders intact. Used by callers that re-schedule the night chain without
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

// O pacote é fixo pra este app (igual ao app.json e ao run-e2e.sh).
const ANDROID_PACKAGE = 'com.claudiogonzaga.comentor';

/**
 * Abre a tela do sistema "Acesso ao Não Perturbe", onde o usuário libera a
 * Comentora a atravessar o modo Não Perturbe. Sem essa permissão o canal de
 * bypass é criado mas o Android ignora o bypass.
 */
export async function openDndAccessSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
  } catch {
    try {
      await Linking.sendIntent('android.settings.SETTINGS');
    } catch {
      /* desiste silenciosamente */
    }
  }
}

/**
 * Abre as configurações do canal de notificação da coruja, onde o usuário
 * ajusta volume/som/importância (o Android não deixa o app mudar isso
 * programaticamente — o volume da notificação é controlado pelo sistema).
 */
export async function openOwlChannelSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const channelId = await ensureChannel();
  try {
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE },
      { key: 'android.provider.extra.CHANNEL_ID', value: channelId },
    ]);
  } catch {
    try {
      await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE },
      ]);
    } catch {
      /* desiste silenciosamente */
    }
  }
}

/** Estado do canal lido de volta do Android — para diagnóstico no aparelho. */
export interface ChannelDiagnostics {
  /** Som configurado no canal: 'custom' (coruja), 'default' (sistema) ou null (mudo). */
  sound: 'default' | 'custom' | null;
  /** Importância numérica (HIGH=4 no enum nativo do Android, 6 no enum do expo). */
  importance: number;
  /** Se o canal atravessa o Não Perturbe. */
  bypassDnd: boolean;
  /** Visibilidade na tela de bloqueio (PUBLIC=1 mostra tudo, espelha no relógio). */
  lockscreenVisibility: number;
}

/**
 * Diagnóstico: dispara uma notificação imediata, informa quantos lembretes já
 * estão na fila e LÊ DE VOLTA o estado real do canal no Android (som,
 * importância, DND, visibilidade). Como não dá para testar no emulador, este é
 * o jeito honesto do usuário ver, no próprio aparelho, se o som está ligado.
 */
export async function sendTestNotification(): Promise<{
  granted: boolean;
  scheduledCount: number;
  channel: ChannelDiagnostics | null;
}> {
  const granted = await ensurePermissions();
  if (!granted) return { granted: false, scheduledCount: 0, channel: null };
  const channelId = await ensureChannel();
  const sound = await soundFor();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Teste de notificação',
      body: 'Funcionou! Se você está vendo isto, os lembretes da Comentora conseguem chegar no seu celular.',
      sound,
      data: { type: 'test' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
      channelId,
    },
  });

  // Lê o canal de volta — revela se o Android está com o som mudo (a causa
  // mais comum de "não toca": canal preso silencioso ou volume zerado).
  let channel: ChannelDiagnostics | null = null;
  if (Platform.OS === 'android') {
    try {
      const ch = await Notifications.getNotificationChannelAsync(channelId);
      if (ch) {
        channel = {
          sound: ch.sound,
          importance: ch.importance,
          bypassDnd: ch.bypassDnd,
          lockscreenVisibility: ch.lockscreenVisibility,
        };
      }
    } catch {
      /* leitura do canal é best-effort */
    }
  }

  return { granted: true, scheduledCount: scheduled.length, channel };
}
