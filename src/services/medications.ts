import * as Notifications from 'expo-notifications';
import {
  getDoneNudgeTypes,
  getUserConfig,
  listMedications,
  markNudgeDone,
  markNudgeUndone,
} from './database';
import {
  MED_CATEGORY,
  MED_DO_CATEGORY,
  ensureChannel,
  ensureNotificationCategories,
  gatedSchedule,
} from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { syncSpokenMedications } from './spokenNudges';
import type { Medication } from '../types';

/**
 * Distingue lembrete de TOMAR (remédio/suplemento) de FAZER (ver sol, beber
 * água, respiração…). O sinal é o emoji escolhido — só 💊 (remédio) e 🌿
 * (suplemento) são "tomar". Tudo o mais é um hábito de fazer, que recebe
 * "Já fiz ✅" em vez do equivocado "Já tomei 💊".
 */
const INGEST_EMOJIS = new Set(['💊', '🌿']);
function isIngest(med: Pick<Medication, 'emoji'>): boolean {
  return INGEST_EMOJIS.has((med.emoji ?? '').trim());
}

/**
 * Monta título, corpo e categoria de um lembrete conforme seja de tomar ou
 * fazer. `pendingBody` é o texto da corrente de insistências ("ainda pendente").
 */
function reminderCopy(med: Pick<Medication, 'emoji' | 'name' | 'dosage'>): {
  emoji: string;
  title: string;
  baseBody: string;
  /** Instrução do botão a tocar (sem o "Ainda pendente"). */
  actionLine: string;
  pendingBody: string;
  category: string;
} {
  const ingest = isIngest(med);
  const emoji = med.emoji ?? (ingest ? '💊' : '🔔');
  const detail = med.dosage?.trim();
  if (ingest) {
    const baseBody = detail ? `Hora de tomar: ${detail}.` : 'Hora de tomar o seu lembrete.';
    const actionLine = 'Toque em "Já tomei 💊" quando tomar.';
    return {
      emoji,
      title: `${emoji} ${med.name}`,
      baseBody,
      actionLine,
      pendingBody: `${baseBody}\n\nAinda pendente — ${actionLine}`,
      category: MED_CATEGORY,
    };
  }
  const baseBody = detail ? `Está na hora: ${detail}.` : 'Está na hora deste hábito.';
  const actionLine = 'Toque em "Já fiz ✅" quando concluir.';
  return {
    emoji,
    title: `${emoji} ${med.name}`,
    baseBody,
    actionLine,
    pendingBody: `${baseBody}\n\nAinda pendente — ${actionLine}`,
    category: MED_DO_CATEGORY,
  };
}

/**
 * Mensagem ESCALADA da k-ésima insistência (k = 1, 2, 3…): a coruja vai
 * aumentando o tom — do lembrete gentil ao apelo direto — até o usuário marcar.
 */
function escalatedBody(name: string, actionLine: string, k: number): string {
  const openers = [
    `Ainda pendente: "${name}". ${actionLine}`,
    `Vamos lá, me responde por favor 🙏 — "${name}" ainda não foi marcado. ${actionLine}`,
    `Ô! Não vou desistir de você: "${name}" continua te esperando. ${actionLine}`,
    `Última cobrança por agora… "${name}" segue pendente. É rapidinho — ${actionLine.charAt(0).toLowerCase()}${actionLine.slice(1)}`,
  ];
  return openers[Math.min(Math.max(1, k) - 1, openers.length - 1)];
}

/**
 * Lembretes de medicamentos/suplementos. Cada lembrete habilitado VERIFICA:
 * a coruja insiste (re-notifica) até o usuário confirmar com "Já tomei 💊".
 *
 * Reaproveita a infra de `nudge_completions` usando a chave `med:<id>` para
 * registrar "tomei hoje", e o mesmo desenho do nudges.ts (âncora DIÁRIA +
 * corrente de insistências DATE para o dia atual).
 */

/** Quantas vezes a coruja re-insiste no mesmo dia, além do lembrete inicial.
 * Alto de propósito: um bom coach insiste até a tarefa ser resolvida. A corrente
 * é cancelada assim que o usuário marca Já fiz / Não vou fazer / Me dê mais tempo,
 * e é re-armada ao abrir o app — então insiste "até resolver" (respeitando os
 * períodos sem som). */
const MED_MAX_REPEATS = 20;
/** Espaçamento mínimo (min) entre as insistências. */
const MIN_MED_INTERVAL_MIN = 5;

/** Chave usada em nudge_completions para registrar "tomou hoje". */
function completionKey(medId: number): string {
  return `med:${medId}`;
}

/**
 * Chave de "pulei hoje" ("Não vou fazer"): encerra a corrente de insistências
 * do dia SEM contar como feito (separada de completionKey p/ não inflar
 * estatísticas/streaks). Reseta no dia seguinte como qualquer marca diária.
 */
function skipKey(medId: number): string {
  return `med:${medId}:skip`;
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
    const { title, baseBody, actionLine, pendingBody, category } = reminderCopy(med);

    // Dias da semana em que o lembrete vale (0=domingo … 6=sábado, igual a
    // Date.getDay()). Os 7 dias = diário; um subconjunto = semanal em dias
    // específicos (ex.: [2, 4] = terça e quinta).
    const activeDays =
      med.daysOfWeek && med.daysOfWeek.length > 0
        ? med.daysOfWeek
        : [0, 1, 2, 3, 4, 5, 6];
    const isDaily = activeDays.length >= 7;

    // JEJUM INTERMITENTE: em vez do lembrete normal, agenda (a) um aviso 30 min
    // antes do fim da janela de alimentação e (b) um aviso no FIM ("pare de
    // comer"). `time` é a 1ª refeição; janela = 24 − fastingHours. Sem âncora
    // "hora de tomar" e sem corrente de insistências.
    if (med.fastingHours != null) {
      const fastH = Math.min(23, Math.max(1, Math.round(med.fastingHours)));
      const firstMin = safeHour * 60 + safeMinute;
      const endMin = (firstMin + (24 - fastH) * 60) % (24 * 60);
      const warnMin = (endMin - 30 + 24 * 60) % (24 * 60);
      const hhmm = (mins: number) =>
        `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const fastingNotifs = [
        {
          atMin: warnMin,
          body: `Faltam 30 min para fechar sua janela de alimentação (até ${hhmm(endMin)}). Aproveite para comer.`,
        },
        {
          atMin: endMin,
          body: `Janela de alimentação fechada (${hhmm(endMin)}). Hora de parar de comer — começa o jejum de ${fastH}h. 🙌`,
        },
      ];
      for (const n of fastingNotifs) {
        const content = {
          title,
          body: n.body,
          data: { type: `med:${med.id}`, medId: med.id },
          sound,
        };
        const nh = Math.floor(n.atMin / 60);
        const nm = n.atMin % 60;
        if (isDaily) {
          try {
            const id = await gatedSchedule({
              content,
              trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DAILY,
                hour: nh,
                minute: nm,
                channelId,
              },
            });
            if (id) ids.push(id);
          } catch (err) {
            console.warn(`failed to schedule fasting notif ${med.id}:`, err);
          }
        } else {
          for (const dow of activeDays) {
            try {
              const id = await gatedSchedule({
                content,
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                  weekday: dow + 1,
                  hour: nh,
                  minute: nm,
                  channelId,
                },
              });
              if (id) ids.push(id);
            } catch (err) {
              console.warn(
                `failed to schedule weekly fasting notif ${med.id} (dow ${dow}):`,
                err,
              );
            }
          }
        }
      }
      continue; // jejum não usa âncora nem corrente de insistências
    }

    const anchorContent = {
      title,
      body: baseBody,
      data: { type: `med:${med.id}`, medId: med.id },
      sound,
      categoryIdentifier: category,
    };

    // Âncora recorrente. Diário → um gatilho DAILY; semanal → um gatilho
    // WEEKLY por dia selecionado (no expo, weekday 1=domingo … 7=sábado, então
    // somamos 1 ao índice 0–6).
    if (isDaily) {
      try {
        const id = await gatedSchedule({
          content: anchorContent,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: safeHour,
            minute: safeMinute,
            channelId,
          },
        });
        if (id) ids.push(id);
      } catch (err) {
        console.warn(`failed to schedule medication anchor ${med.id}:`, err);
      }
    } else {
      for (const dow of activeDays) {
        try {
          const id = await gatedSchedule({
            content: anchorContent,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: dow + 1,
              hour: safeHour,
              minute: safeMinute,
              channelId,
            },
          });
          if (id) ids.push(id);
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
    if (activeDays.includes(todayDow) && !doneKeys.includes(key) && !doneKeys.includes(skipKey(med.id))) {
      const base = buildTodayAt(safeHour, safeMinute);
      // Âncora da corrente: o horário do lembrete OU agora (o que for MAIOR).
      // Assim, se o app reabre depois do horário e a tarefa segue pendente, a
      // coruja volta a insistir A PARTIR DE AGORA — em vez de pular tudo que já
      // passou e ficar muda (era por isso que "não insistia").
      const anchor = base.getTime() > Date.now() ? base.getTime() : Date.now();
      for (let k = 1; k <= MED_MAX_REPEATS; k++) {
        const fireAt = new Date(anchor + k * intervalMin * 60_000);
        if (fireAt.getTime() <= Date.now()) continue;
        try {
          const id = await gatedSchedule({
            content: {
              title,
              // Tom crescente a cada insistência (≥3 vezes).
              body: `${baseBody}\n\n${escalatedBody(med.name, actionLine, k)}`,
              data: { type: `med:${med.id}`, medId: med.id, followup: true },
              sound,
              categoryIdentifier: category,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireAt,
              channelId,
            },
          });
          if (id) ids.push(id);
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
    .filter((med) => med.enabled && med.fastingHours == null)
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
/**
 * Cancela as insistências futuras (follow-ups) deste lembrete e dispensa as
 * notificações dele já visíveis na bandeja. Usado ao confirmar, adiar ou pular.
 */
async function clearMedNotifications(medId: number): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { medId?: number; followup?: boolean };
    if (data?.medId === medId && data?.followup) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
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

export async function confirmMedication(medId: number): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(completionKey(medId), today);
  } catch (err) {
    console.warn(`failed to mark medication done ${medId}:`, err);
  }
  await clearMedNotifications(medId);
}

/**
 * "Não vou fazer/tomar": encerra a insistência de HOJE sem marcar como feito.
 * Grava skipKey (separado de "feito" p/ estatísticas honestas), cancela os
 * follow-ups e dispensa a notificação atual. Volta a lembrar normalmente amanhã.
 */
export async function skipMedicationToday(medId: number): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(skipKey(medId), today);
  } catch (err) {
    console.warn(`failed to mark medication skipped ${medId}:`, err);
  }
  await clearMedNotifications(medId);
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
 * Volta o lembrete de hoje para PENDENTE — desfaz tanto o "Já tomei" quanto o
 * "Não vou tomar". Re-agenda (re-arma a insistência se ainda estiver na janela).
 * Permite ao usuário CORRIGIR a marcação a qualquer momento.
 */
export async function resetMedicationToday(medId: number): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeUndone(completionKey(medId), today);
    await markNudgeUndone(skipKey(medId), today);
  } catch (err) {
    console.warn(`failed to reset medication ${medId}:`, err);
  }
  await scheduleAllMedications();
}

/**
 * "Lembrar depois": agenda uma única insistência deste medicamento daqui a
 * `minutes` minutos (não marca como tomado). A âncora diária e a corrente
 * normal seguem intactas.
 */
export async function snoozeMedication(medId: number, minutes = 20): Promise<void> {
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

  const { title, pendingBody, category } = reminderCopy(med);

  // Pausa a corrente atual (cancela os follow-ups pendentes e dispensa o aviso
  // visível) — assim "me dê mais tempo" silencia agora e só volta daqui a 30min.
  await clearMedNotifications(medId);

  const fireAt = new Date(Date.now() + Math.max(1, minutes) * 60_000);
  try {
    await gatedSchedule({
      content: {
        title,
        body: pendingBody,
        data: { type: `med:${med.id}`, medId: med.id, followup: true },
        sound,
        categoryIdentifier: category,
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
