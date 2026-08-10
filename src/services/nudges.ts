import * as Notifications from 'expo-notifications';
import {
  getDoneNudgeTypes,
  getUserConfig,
  listNudges,
  markNudgeDone,
  markNudgeUndone,
  updateNudge,
} from './database';
import { NUDGE_CATEGORY, ensureChannel, ensureNotificationCategories, gatedSchedule } from './notifications';
import { persuasiveBody, escalationBody } from './persuasion';
import { getOwlSpecies } from '../constants/owlSpecies';
import type { Nudge } from '../types';

/**
 * TODO item da Home = item que a coruja VERIFICA: ela insiste (re-notifica) a
 * cada `reminderIntervalMinutes` até você marcar "Já fiz" ou "Não vou fazer".
 *
 * Antes só 'bluelight' insistia; todo o resto dava um único lembrete diário e
 * sumia — se você estivesse ocupado no horário marcado, o hábito passava batido
 * e a coruja nunca mais tocava no assunto. Como todo item da lista da Home é
 * marcável, todos passam a insistir.
 *
 * Este conjunto é a exceção, não a regra: tipos aqui dentro voltam a ser
 * lembrete único. Vazio de propósito.
 */
const NON_VERIFY_NUDGE_TYPES = new Set<string>();

/** Teto de insistências quando a configuração não puder ser lida. */
const DEFAULT_MAX_INSISTENCES = 5;

/**
 * Minutos, contados do horário do lembrete, em que cai cada insistência.
 *
 * O ESPAÇAMENTO DOBRA: 10, 20, 40, 80, 160 min — ou seja, as insistências caem
 * aos 10, 30, 70, 150 e 310 minutos. A ideia é cobrar de perto logo depois do
 * horário, quando ainda dá para fazer, e ir afrouxando em vez de martelar no
 * mesmo ritmo o dia inteiro.
 *
 * `base` é o intervalo configurado em Lembretes (padrão 10, mínimo 5).
 */
function insistenceOffsetsMin(base: number, count: number): number[] {
  const out: number[] = [];
  let gap = base;
  let acc = 0;
  for (let i = 0; i < count; i++) {
    acc += gap;
    out.push(acc);
    gap *= 2;
  }
  return out;
}
/** Espaçamento mínimo (min) entre as insistências, mesmo se o intervalo for menor. */
const MIN_NUDGE_INTERVAL_MIN = 5;

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
 * Cancela todas as notificações de nudge agendadas (qualquer uma cujo
 * data.type começa com `nudge:`). Não toca em lembretes de sono, prep, etc.
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
 * Cancela os nudges existentes e re-agenda tudo. Para cada nudge habilitado
 * registra um lembrete DIÁRIO (âncora). Para os nudges "verify" ainda NÃO
 * confirmados hoje, agenda também uma corrente de insistências de hoje
 * (a cada `intervalMinutes`, até `NUDGE_MAX_REPEATS` vezes), com os botões
 * "Já fiz ✅" / "Lembrar depois". Idempotente — seguro chamar a cada save /
 * ao abrir o app (re-arma a corrente do dia).
 */
/**
 * Esgotadas as insistências sem nenhuma resposta, o item é dado como NÃO FEITO
 * (chave `:missed`, separada de `:skip` — uma é desistência da coruja, a outra é
 * decisão sua).
 *
 * Roda de forma preguiçosa: ao abrir o app e a cada reagendamento, olha o que já
 * venceu. Não depende de execução em segundo plano no horário exato, que o
 * Android não garante para nenhum app.
 */
export async function finalizeExpiredNudgeChains(): Promise<void> {
  const today = todayISO();
  let intervalMin = 10;
  let maxInsistences = DEFAULT_MAX_INSISTENCES;
  try {
    const config = await getUserConfig();
    intervalMin = Math.max(MIN_NUDGE_INTERVAL_MIN, config.reminderIntervalMinutes ?? 10);
    maxInsistences = Math.max(
      0,
      Math.min(10, config.nudgeMaxInsistences ?? DEFAULT_MAX_INSISTENCES),
    );
  } catch {
    /* keep defaults */
  }
  if (maxInsistences <= 0) return; // insistência desligada: nunca desiste sozinha

  const offsets = insistenceOffsetsMin(intervalMin, maxInsistences);
  const lastOffset = offsets[offsets.length - 1];

  let doneTypes: string[] = [];
  try {
    doneTypes = await getDoneNudgeTypes(today);
  } catch {
    return; // sem saber o que já foi resolvido, não marca nada
  }

  let nudges: Nudge[] = [];
  try {
    nudges = await listNudges();
  } catch {
    return;
  }

  for (const n of nudges) {
    if (!n.enabled) continue;
    if (NON_VERIFY_NUDGE_TYPES.has(n.type)) continue;
    if (
      doneTypes.includes(n.type) ||
      doneTypes.includes(`${n.type}:skip`) ||
      doneTypes.includes(`${n.type}:missed`)
    ) {
      continue;
    }
    const parts = n.scheduleTime.split(':').map((s) => parseInt(s, 10));
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const base = buildTodayAt(Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m)));
    if (Date.now() <= base.getTime() + lastOffset * 60_000) continue;
    try {
      await markNudgeDone(`${n.type}:missed`, today);
    } catch (err) {
      console.warn(`failed to mark nudge missed ${n.type}:`, err);
    }
  }
}

export async function scheduleAllNudges(): Promise<string[]> {
  // Antes de reagendar: fecha o que já venceu, para não re-armar corrente de
  // item que a coruja já desistiu de cobrar hoje.
  await finalizeExpiredNudgeChains();

  const channelId = await ensureChannel();
  await ensureNotificationCategories();
  await cancelAllNudges();

  let sound: string = 'default';
  let intervalMin = 10;
  let maxInsistences = DEFAULT_MAX_INSISTENCES;
  let userName: string | null = null;
  try {
    const config = await getUserConfig();
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
    intervalMin = Math.max(MIN_NUDGE_INTERVAL_MIN, config.reminderIntervalMinutes ?? 10);
    maxInsistences = Math.max(
      0,
      Math.min(10, config.nudgeMaxInsistences ?? DEFAULT_MAX_INSISTENCES),
    );
    userName = config.name;
  } catch {
    /* keep defaults */
  }

  const today = todayISO();
  let doneTypes: string[] = [];
  try {
    doneTypes = await getDoneNudgeTypes(today);
  } catch {
    /* if the completions read fails, treat nothing as done */
  }

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

    const isVerify = !NON_VERIFY_NUDGE_TYPES.has(n.type);
    const title = `${n.emoji ?? '🦉'} ${n.title}`;

    // Lembrete diário (âncora) — sempre presente, dispara todo dia no horário.
    try {
      const id = await gatedSchedule({
        content: {
          title,
          body: n.body,
          data: { type: `nudge:${n.type}`, nudgeId: n.id, nudgeType: n.type, verify: isVerify },
          sound,
          ...(isVerify ? { categoryIdentifier: NUDGE_CATEGORY } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: safeHour,
          minute: safeMinute,
          channelId,
        },
      });
      if (id) ids.push(id);
    } catch (err) {
      console.warn(`failed to schedule nudge anchor ${n.type}:`, err);
    }

    // Corrente de insistências de hoje — só para nudges "verify" ainda não
    // confirmados. A coruja re-notifica até o usuário tocar "Já fiz ✅".
    if (
      isVerify &&
      !doneTypes.includes(n.type) &&
      !doneTypes.includes(`${n.type}:skip`) &&
      !doneTypes.includes(`${n.type}:missed`)
    ) {
      const base = buildTodayAt(safeHour, safeMinute);
      const offsets = insistenceOffsetsMin(intervalMin, maxInsistences);
      for (let k = 1; k <= offsets.length; k++) {
        const fireAt = new Date(base.getTime() + offsets[k - 1] * 60_000);
        if (fireAt.getTime() <= Date.now()) continue;
        try {
          const id = await gatedSchedule({
            content: {
              title,
              // Escalada: 1ª cobrança pergunta com o nome; 2ª pede explicação;
              // depois, argumentos persuasivos variados.
              body:
                escalationBody({ userName, question: `você já fez ${n.title}?`, k }) ||
                persuasiveBody(n.title, 'Toque em "Já fiz ✅" quando terminar.', k),
              data: {
                type: `nudge:${n.type}`,
                nudgeId: n.id,
                nudgeType: n.type,
                verify: true,
                followup: true,
              },
              sound,
              categoryIdentifier: NUDGE_CATEGORY,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireAt,
              channelId,
            },
          });
          if (id) ids.push(id);
        } catch (err) {
          console.warn(`failed to schedule nudge follow-up ${n.type}:`, err);
        }
      }
    }
  }

  return ids;
}

/**
 * Marca um comportamento como feito hoje, encerra a corrente de insistências
 * de hoje e dispensa as notificações já visíveis daquele nudge. A âncora
 * diária permanece para o dia seguinte.
 */
export async function confirmNudge(nudgeType: string): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(nudgeType, today);
  } catch (err) {
    console.warn(`failed to mark nudge done ${nudgeType}:`, err);
  }

  // Cancela as insistências futuras (follow-ups) deste nudge.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { nudgeType?: string; followup?: boolean };
    if (data?.nudgeType === nudgeType && data?.followup) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }

  // Dispensa as notificações deste nudge que já estão na bandeja.
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const p of presented) {
      const data = p.request.content.data as { nudgeType?: string };
      if (data?.nudgeType === nudgeType) {
        await Notifications.dismissNotificationAsync(p.request.identifier);
      }
    }
  } catch {
    /* dismissal is best-effort */
  }
}

/**
 * "Não vou fazer hoje": encerra a insistência de hoje SEM contar como feito
 * (chave `:skip`, separada para não inflar estatísticas). Volta a lembrar amanhã.
 */
export async function skipNudgeToday(nudgeType: string): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(`${nudgeType}:skip`, today);
  } catch (err) {
    console.warn(`failed to mark nudge skipped ${nudgeType}:`, err);
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { nudgeType?: string; followup?: boolean };
    if (data?.nudgeType === nudgeType && data?.followup) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const p of presented) {
      const data = p.request.content.data as { nudgeType?: string };
      if (data?.nudgeType === nudgeType) {
        await Notifications.dismissNotificationAsync(p.request.identifier);
      }
    }
  } catch {
    /* dismissal is best-effort */
  }
}

/**
 * Desfaz o "Já fiz" de hoje: remove a marca de concluído e re-agenda os
 * nudges, o que recria a corrente de insistências do dia (se ainda estiver
 * dentro da janela). Usado quando o usuário desmarca um item da lista de
 * tarefas na tela inicial.
 */
export async function unconfirmNudge(nudgeType: string): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeUndone(nudgeType, today);
  } catch (err) {
    console.warn(`failed to mark nudge undone ${nudgeType}:`, err);
  }
  await scheduleAllNudges();
}

/**
 * Volta o hábito de hoje para PENDENTE — desfaz "Já fiz" e "Não vou fazer hoje".
 * Re-agenda (re-arma a insistência). Deixa o usuário CORRIGIR a marcação.
 */
export async function resetNudgeToday(nudgeType: string): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeUndone(nudgeType, today);
    await markNudgeUndone(`${nudgeType}:skip`, today);
  } catch (err) {
    console.warn(`failed to reset nudge ${nudgeType}:`, err);
  }
  await scheduleAllNudges();
}

/**
 * "Lembrar depois": agenda uma única insistência deste nudge daqui a
 * `minutes` minutos (não marca como feito). A âncora diária e a corrente
 * normal seguem intactas.
 */
export async function snoozeNudge(nudgeType: string, minutes = 20): Promise<void> {
  const channelId = await ensureChannel();
  await ensureNotificationCategories();

  let sound: string = 'default';
  try {
    const config = await getUserConfig();
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
  } catch {
    /* keep default */
  }

  const nudges = await listNudges();
  const n = nudges.find((x) => x.type === nudgeType);
  if (!n) return;

  const fireAt = new Date(Date.now() + Math.max(1, minutes) * 60_000);
  try {
    await gatedSchedule({
      content: {
        title: `${n.emoji ?? '🦉'} ${n.title}`,
        body: `${n.body}\n\nAinda pendente — toque em "Já fiz ✅" quando terminar.`,
        data: {
          type: `nudge:${n.type}`,
          nudgeId: n.id,
          nudgeType: n.type,
          verify: true,
          followup: true,
        },
        sound,
        categoryIdentifier: NUDGE_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId,
      },
    });
  } catch (err) {
    console.warn(`failed to snooze nudge ${nudgeType}:`, err);
  }
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
