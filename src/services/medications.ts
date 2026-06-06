import * as Notifications from 'expo-notifications';
import {
  getDoneNudgeTypes,
  getUserConfig,
  listMedications,
  markNudgeDone,
  markNudgeUndone,
} from './database';
import { MED_CATEGORY, ensureChannel, ensureNotificationCategories } from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { syncSpokenMedications } from './spokenNudges';

/**
 * Lembretes de medicamentos/suplementos. Cada lembrete habilitado VERIFICA:
 * a coruja insiste (re-notifica) até o usuário confirmar com "Já tomei 💊".
 *
 * Reaproveita a infra de `nudge_completions` usando a chave `med:<id>` para
 * registrar "tomei hoje", e o mesmo desenho do nudges.ts (âncora DIÁRIA +
 * corrente de insistências DATE para o dia atual).
 */

/** Quantas vezes a coruja re-insiste no mesmo dia, além do lembrete inicial. */
const MED_MAX_REPEATS = 4;
/** Espaçamento mínimo (min) entre as insistências. */
const MIN_MED_INTERVAL_MIN = 5;

/** Chave usada em nudge_completions para registrar "tomou hoje". */
function completionKey(medId: number): string {
  return `med:${medId}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Constrói a data de hoje no horário HH:MM (pode estar no passado). */
function buildTodayAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Cancela todas as notificações de medicamento agendadas (qualquer uma cujo
 * data.type começa com `med:`). Não toca em lembretes de sono, prep ou nudges.
 */
export async function cancelAllMedications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type?.startsWith('med:')) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Cancela os lembretes de medicamento e re-agenda tudo. Para cada lembrete
 * habilitado registra uma âncora DIÁRIA no horário; para os ainda NÃO tomados
 * hoje, agenda também uma corrente de insistências de hoje (a cada
 * `intervalMinutes`, até `MED_MAX_REPEATS` vezes), com os botões
 * "Já tomei 💊" / "Lembrar depois". Idempotente — seguro chamar a cada save /
 * ao abrir o app (re-arma a corrente do dia).
 */
export async function scheduleAllMedications(): Promise<string[]> {
  const channelId = await ensureChannel();
  await ensureNotificationCategories();
  await cancelAllMedications();

  let sound: string = 'default';
  let intervalMin = 10;
  try {
    const config = await getUserConfig();
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
    intervalMin = Math.max(MIN_MED_INTERVAL_MIN, config.reminderIntervalMinutes ?? 10);
  } catch {
    /* keep defaults */
  }

  const today = todayISO();
  let doneKeys: string[] = [];
  try {
    doneKeys = await getDoneNudgeTypes(today);
  } catch {
    /* if the completions read fails, treat nothing as done */
  }

  const meds = await listMedications();
  const ids: string[] = [];

  for (const med of meds) {
    if (!med.enabled) continue;
    const parts = med.time.split(':').map((s) => parseInt(s, 10));
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const safeHour = Math.min(23, Math.max(0, h));
    const safeMinute = Math.min(59, Math.max(0, m));

    const key = completionKey(med.id);
    const emoji = med.emoji ?? '💊';
    const title = `${emoji} ${med.name}`;
    const baseBody = med.dosage?.trim()
      ? `Hora de tomar: ${med.dosage.trim()}.`
      : 'Hora de tomar o seu lembrete.';

    // Dias da semana em que o lembrete vale (0=domingo … 6=sábado, igual a
    // Date.getDay()). Os 7 dias = diário; um subconjunto = semanal em dias
    // específicos (ex.: [2, 4] = terça e quinta).
    const activeDays =
      med.daysOfWeek && med.daysOfWeek.length > 0
        ? med.daysOfWeek
        : [0, 1, 2, 3, 4, 5, 6];
    const isDaily = activeDays.length >= 7;

    const anchorContent = {
      title,
      body: baseBody,
      data: { type: `med:${med.id}`, medId: med.id },
      sound,
      categoryIdentifier: MED_CATEGORY,
    };

    // Âncora recorrente. Diário → um gatilho DAILY; semanal → um gatilho
    // WEEKLY por dia selecionado (no expo, weekday 1=domingo … 7=sábado, então
    // somamos 1 ao índice 0–6).
    if (isDaily) {
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: anchorContent,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: safeHour,
            minute: safeMinute,
            channelId,
          },
        });
        ids.push(id);
      } catch (err) {
        console.warn(`failed to schedule medication anchor ${med.id}:`, err);
      }
    } else {
      for (const dow of activeDays) {
        try {
          const id = await Notifications.scheduleNotificationAsync({
            content: anchorContent,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: dow + 1,
              hour: safeHour,
              minute: safeMinute,
              channelId,
            },
          });
          ids.push(id);
        } catch (err) {
          console.warn(
            `failed to schedule weekly medication anchor ${med.id} (dow ${dow}):`,
            err,
          );
        }
      }
    }

    // Corrente de insistências de hoje — só se HOJE for um dia ativo e o
    // lembrete ainda não tiver sido marcado como feito.
    const todayDow = new Date().getDay();
    if (activeDays.includes(todayDow) && !doneKeys.includes(key)) {
      const base = buildTodayAt(safeHour, safeMinute);
      for (let k = 1; k <= MED_MAX_REPEATS; k++) {
        const fireAt = new Date(base.getTime() + k * intervalMin * 60_000);
        if (fireAt.getTime() <= Date.now()) continue;
        try {
          const id = await Notifications.scheduleNotificationAsync({
            content: {
              title,
              body: `${baseBody}\n\nAinda pendente — toque em "Já tomei 💊" quando tomar.`,
              data: { type: `med:${med.id}`, medId: med.id, followup: true },
              sound,
              categoryIdentifier: MED_CATEGORY,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireAt,
              channelId,
            },
          });
          ids.push(id);
        } catch (err) {
          console.warn(`failed to schedule medication follow-up ${med.id}:`, err);
        }
      }
    }
  }

  // Versões FALADAS dos lembretes (voz Gemini cacheada + fallback voz do
  // sistema), armadas em background. Fecha a intenção de que TODO aviso possa
  // ser falado, mesmo com a tela apagada. Best-effort, fora do caminho crítico.
  const spokenItems = meds
    .filter((med) => med.enabled)
    .map((med) => {
      const p = med.time.split(':').map((s) => parseInt(s, 10));
      const hh = p[0];
      const mm = p[1] ?? 0;
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      const dosage = med.dosage?.trim();
      const text = dosage
        ? `Hora do seu lembrete: ${med.name}. ${dosage}.`
        : `Hora do seu lembrete: ${med.name}.`;
      const days =
        med.daysOfWeek && med.daysOfWeek.length > 0 ? med.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
      return {
        id: med.id,
        text,
        hour: Math.min(23, Math.max(0, hh)),
        minute: Math.min(59, Math.max(0, mm)),
        daysOfWeek: days,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  void syncSpokenMedications(spokenItems).catch(() => {});

  return ids;
}

/**
 * Marca um medicamento como tomado hoje, encerra a corrente de insistências
 * de hoje e dispensa as notificações já visíveis daquele lembrete. A âncora
 * diária permanece para o dia seguinte.
 */
export async function confirmMedication(medId: number): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(completionKey(medId), today);
  } catch (err) {
    console.warn(`failed to mark medication done ${medId}:`, err);
  }

  // Cancela as insistências futuras (follow-ups) deste medicamento.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { medId?: number; followup?: boolean };
    if (data?.medId === medId && data?.followup) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }

  // Dispensa as notificações deste medicamento que já estão na bandeja.
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const p of presented) {
      const data = p.request.content.data as { medId?: number };
      if (data?.medId === medId) {
        await Notifications.dismissNotificationAsync(p.request.identifier);
      }
    }
  } catch {
    /* dismissal is best-effort */
  }
}

/**
 * Desfaz o "Já tomei" de hoje: remove a marca de concluído e re-agenda os
 * lembretes, o que recria a corrente de insistências do dia (se ainda estiver
 * dentro da janela). Usado quando o usuário desmarca um item da lista de
 * tarefas na tela inicial.
 */
export async function unconfirmMedication(medId: number): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeUndone(completionKey(medId), today);
  } catch (err) {
    console.warn(`failed to mark medication undone ${medId}:`, err);
  }
  await scheduleAllMedications();
}

/**
 * "Lembrar depois": agenda uma única insistência deste medicamento daqui a
 * `minutes` minutos (não marca como tomado). A âncora diária e a corrente
 * normal seguem intactas.
 */
export async function snoozeMedication(medId: number, minutes = 10): Promise<void> {
  const channelId = await ensureChannel();
  await ensureNotificationCategories();

  let sound: string = 'default';
  try {
    const config = await getUserConfig();
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
  } catch {
    /* keep default */
  }

  const meds = await listMedications();
  const med = meds.find((x) => x.id === medId);
  if (!med) return;

  const emoji = med.emoji ?? '💊';
  const baseBody = med.dosage?.trim()
    ? `Hora de tomar: ${med.dosage.trim()}.`
    : 'Hora de tomar o seu lembrete.';

  const fireAt = new Date(Date.now() + Math.max(1, minutes) * 60_000);
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${emoji} ${med.name}`,
        body: `${baseBody}\n\nAinda pendente — toque em "Já tomei 💊" quando tomar.`,
        data: { type: `med:${med.id}`, medId: med.id, followup: true },
        sound,
        categoryIdentifier: MED_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId,
      },
    });
  } catch (err) {
    console.warn(`failed to snooze medication ${medId}:`, err);
  }
}
