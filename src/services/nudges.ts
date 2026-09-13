import * as Notifications from 'expo-notifications';
import {
  bumpTechnique,
  getDoneNudgeTypes,
  getHabitByType,
  getHabitState,
  getUserConfig,
  listNudges,
  markNudgeDone,
  markNudgeUndone,
  updateNudge,
} from './database';
import {
  NUDGE_CATEGORY,
  NUDGE_CLOSE_CATEGORY,
  SAMPLE_CATEGORY,
  ensureChannel,
  ensureNotificationCategories,
  gatedSchedule,
} from './notifications';
import { getDailyInsistenceLines } from './insistenceLines';
import { recordHabitEvent, type ConfirmMeta } from './habitEvents';
import { refreshReviewNotification } from './review';
import {
  evaluateFormation,
  formedAnnouncement,
  getRegressionNote,
  type FormationDecision,
} from './habitFormation';
import { getPastSelfQuotesText } from './morning';
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

/** FNV-1a: hash simples e determinístico, para o jitter ser estável dentro do dia. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Offsets com IMPREVISIBILIDADE. A regularidade é o que treina o reflexo de
 * ignorar: se a coruja fala sempre aos 10, 30, 70 minutos, o cérebro aprende o
 * padrão e para de ouvir. Então:
 *  - cada batida ganha um desvio de até ±20% do espaço que a precede;
 *  - com 4 ou mais batidas, uma do meio pode ser PULADA (≈1 em 8) — nunca a
 *    primeira nem a última.
 * Determinístico por (dia, hábito): reagendar no mesmo dia não muda nada.
 * Como os espaços dobram, o jitter nunca inverte a ordem das batidas.
 */
function jitteredOffsetsMin(base: number, count: number, seed: string): (number | null)[] {
  const raw = insistenceOffsetsMin(base, count);
  const h = hash32(seed);
  const out: (number | null)[] = [];
  let prev = 0;
  for (let i = 0; i < raw.length; i++) {
    const gap = raw[i] - prev;
    prev = raw[i];
    const r = ((h >>> ((i * 5) % 27)) & 31) / 31; // 0..1, distinto por batida
    const jitter = Math.round((r * 2 - 1) * gap * 0.2);
    out.push(Math.max(1, raw[i] + jitter));
  }
  if (count >= 4 && ((h >>> 27) & 7) === 0) {
    out[1 + (h % (count - 2))] = null;
  }
  return out;
}

// Regeração em segundo plano: quando as cobranças geradas ficam prontas DEPOIS
// do agendamento (que não espera pelo modelo), reagenda uma vez, com um
// pequeno atraso para juntar vários hábitos numa só passada. A segunda passada
// acha o cache e não dispara geração nenhuma — sem laço.
let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
function rescheduleSoon(): void {
  if (rescheduleTimer) clearTimeout(rescheduleTimer);
  rescheduleTimer = setTimeout(() => {
    rescheduleTimer = null;
    void scheduleAllNudges().catch(() => {});
  }, 2000);
}

/** Instrução do botão, anexada às cobranças que ainda não a trazem. */
const ACTION_LINE = 'Toque em "Já fiz ✅" quando terminar.';
function withActionLine(text: string): string {
  return /já fiz|marque aqui|precisa de mais tempo/i.test(text) ? text : `${text} ${ACTION_LINE}`;
}
/** Espaçamento mínimo (min) entre as insistências, mesmo se o intervalo for menor. */
const MIN_NUDGE_INTERVAL_MIN = 5;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Horário programado do nudge (para o atraso nos eventos); null se não achar. */
async function scheduleTimeOf(nudgeType: string): Promise<string | null> {
  try {
    return (await listNudges()).find((x) => x.type === nudgeType)?.scheduleTime ?? null;
  } catch {
    return null;
  }
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
    // Hábito formado não tem corrente — logo não tem o que vencer.
    try {
      if ((await getHabitState(n.type)).state !== 'forming') continue;
    } catch {
      /* sem estado: trata como formando */
    }
    const parts = n.scheduleTime.split(':').map((s) => parseInt(s, 10));
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const base = buildTodayAt(Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m)));
    // Margem de 20%: o jitter pode empurrar a última batida um pouco além do
    // offset nominal, e não faz sentido dar como perdido antes de ela tocar.
    if (Date.now() <= base.getTime() + lastOffset * 1.2 * 60_000) continue;
    try {
      await markNudgeDone(`${n.type}:missed`, today);
      // Para a análise, isto é SEM RESPOSTA — não "não fez".
      void recordHabitEvent(n.type, 'no_answer', { via: 'auto' }, n.scheduleTime);
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
  try {
    const config = await getUserConfig();
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
    intervalMin = Math.max(MIN_NUDGE_INTERVAL_MIN, config.reminderIntervalMinutes ?? 10);
    maxInsistences = Math.max(
      0,
      Math.min(10, config.nudgeMaxInsistences ?? DEFAULT_MAX_INSISTENCES),
    );
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

  // Memória compartilhada com o coach: o que a pessoa escreveu em manhãs ruins.
  // Entra no gerador de cobranças (técnica "eu-passado").
  let pastSelfQuotes = '';
  try {
    const sleep = await getHabitByType('sleep');
    if (sleep) pastSelfQuotes = await getPastSelfQuotesText(sleep.id);
  } catch {
    /* sem citações */
  }

  // As cobranças geradas são buscadas EM PARALELO para todos os hábitos que
  // ainda vão ter corrente hoje — cada chamada tem teto de ~9 s, e em série
  // isso viraria quase um minuto na abertura do app. Em cache, é instantâneo.
  const pendingVerify = nudges.filter(
    (n) =>
      n.enabled &&
      !NON_VERIFY_NUDGE_TYPES.has(n.type) &&
      !doneTypes.includes(n.type) &&
      !doneTypes.includes(`${n.type}:skip`) &&
      !doneTypes.includes(`${n.type}:missed`),
  );
  const linesByType = new Map<string, Awaited<ReturnType<typeof getDailyInsistenceLines>>['lines']>();
  if (maxInsistences > 0 && pendingVerify.length > 0) {
    const results = await Promise.all(
      pendingVerify.map((n) =>
        getDailyInsistenceLines(n, maxInsistences, {
          pastSelfQuotes,
          deferGeneration: true,
          onGenerated: rescheduleSoon,
        }).catch(() => null),
      ),
    );
    results.forEach((r, i) => {
      if (r) linesByType.set(pendingVerify[i].type, r.lines);
    });
  }

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
    const baseData = { type: `nudge:${n.type}`, nudgeId: n.id, nudgeType: n.type };

    // HÁBITO FORMADO? A máquina de estados decide o que agendar hoje.
    let decision: FormationDecision | null = null;
    if (isVerify) {
      try {
        decision = await evaluateFormation(n.type, today);
      } catch {
        decision = null;
      }
    }
    if (decision?.justFormed) {
      // A coruja explica por que vai se calar. É um evento — e é para ser.
      try {
        const id = await gatedSchedule({
          content: {
            title,
            body: formedAnnouncement(n.title, decision.doneDays),
            data: { ...baseData, verify: false },
            sound,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(Date.now() + 20_000),
            channelId,
          },
        });
        if (id) ids.push(id);
      } catch (err) {
        console.warn(`failed to schedule formed announcement ${n.type}:`, err);
      }
    }
    if (decision?.schedule === 'none') continue; // formado: sem âncora, sem corrente
    if (decision?.schedule === 'sample') {
      // Amostra: uma pergunta de um toque, no horário do hábito (ou já, se passou).
      const at = buildTodayAt(safeHour, safeMinute);
      const fireAt = at.getTime() > Date.now() ? at : new Date(Date.now() + 60_000);
      try {
        const id = await gatedSchedule({
          content: {
            title,
            body: `Só conferindo: “${n.title}” continua acontecendo?`,
            data: { ...baseData, verify: false, sample: true },
            sound,
            categoryIdentifier: SAMPLE_CATEGORY,
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId },
        });
        if (id) ids.push(id);
      } catch (err) {
        console.warn(`failed to schedule sample ${n.type}:`, err);
      }
      continue;
    }

    // Âncora diária. Se houve REGRESSÃO há poucos dias, a âncora a nomeia:
    // "você tinha isso na mão por 3 semanas — o que mudou?"
    let anchorBody = n.body;
    if (isVerify) {
      const reg = await getRegressionNote(n.type, today, n.title).catch(() => null);
      if (reg) anchorBody = reg;
    }
    try {
      const id = await gatedSchedule({
        content: {
          title,
          body: anchorBody,
          data: { ...baseData, verify: isVerify },
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
    // confirmados. As cobranças são GERADAS para esta pessoa (com fallback
    // fixo), os horários têm jitter, e cada uma leva o rótulo da técnica para
    // o aprendizado do que convence.
    if (
      isVerify &&
      !doneTypes.includes(n.type) &&
      !doneTypes.includes(`${n.type}:skip`) &&
      !doneTypes.includes(`${n.type}:missed`)
    ) {
      const base = buildTodayAt(safeHour, safeMinute);
      const offsets = jitteredOffsetsMin(intervalMin, maxInsistences, `${today}|${n.type}`);
      if (offsets.length === 0) continue;
      // A última batida não convence: só pede o registro (Fiz / Não fiz / Por quê).
      const lastK = offsets.reduce((acc, o, i) => (o !== null ? i + 1 : acc), 0);
      const lines =
        linesByType.get(n.type) ??
        (
          await getDailyInsistenceLines(n, offsets.length, {
            pastSelfQuotes,
            deferGeneration: true,
            onGenerated: rescheduleSoon,
          })
        ).lines;
      for (let k = 1; k <= offsets.length; k++) {
        const off = offsets[k - 1];
        if (off === null) continue; // batida pulada de propósito
        const fireAt = new Date(base.getTime() + off * 60_000);
        if (fireAt.getTime() <= Date.now()) continue;
        const line = lines[k - 1] ?? lines[lines.length - 1];
        if (!line) continue;
        const isLast = k === lastK && lastK > 1;
        const technique = isLast ? 'fechamento' : line.technique;
        void bumpTechnique(technique, 'shown').catch(() => {});
        try {
          const id = await gatedSchedule({
            content: {
              title,
              body: isLast
                ? `Não precisa fazer agora. Só me diz: “${n.title}” — fez ou não fez?`
                : withActionLine(line.text),
              data: { ...baseData, verify: true, followup: true, technique, k },
              sound,
              categoryIdentifier: isLast ? NUDGE_CLOSE_CATEGORY : NUDGE_CATEGORY,
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

  // "Fechar o dia": só existe se sobrou item sem resposta.
  await refreshReviewNotification();

  return ids;
}

/**
 * Marca um comportamento como feito hoje, encerra a corrente de insistências
 * de hoje e dispensa as notificações já visíveis daquele nudge. A âncora
 * diária permanece para o dia seguinte. `meta` diz por onde veio a resposta.
 */
export async function confirmNudge(nudgeType: string, meta: ConfirmMeta = {}): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(nudgeType, today);
  } catch (err) {
    console.warn(`failed to mark nudge done ${nudgeType}:`, err);
  }
  void recordHabitEvent(nudgeType, 'done', meta, await scheduleTimeOf(nudgeType));
  void refreshReviewNotification();

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
export async function skipNudgeToday(nudgeType: string, meta: ConfirmMeta = {}): Promise<void> {
  const today = todayISO();
  try {
    await markNudgeDone(`${nudgeType}:skip`, today);
  } catch (err) {
    console.warn(`failed to mark nudge skipped ${nudgeType}:`, err);
  }
  void recordHabitEvent(nudgeType, 'not_done', meta, await scheduleTimeOf(nudgeType));
  void refreshReviewNotification();
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
