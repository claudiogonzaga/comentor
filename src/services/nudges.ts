import * as Notifications from 'expo-notifications';
import {
  bumpTechnique,
  getDoneNudgeTypes,
  getHabitByType,
  getUserConfig,
  listNudges,
  markNudgeDone,
  markNudgeUndone,
  updateNudge,
  upsertDecisionPoint,
  cancelFutureDecisionPoints,
  resetFutureDecisionPoints,
  getKV,
  setKV,
} from './database';
import {
  NUDGE_CATEGORY,
  NUDGE_CLOSE_CATEGORY,
  NUDGE_SOFT_CATEGORY,
  PARAR_CATEGORY,
  ensureChannel,
  ensureNotificationCategories,
  gatedSchedule,
} from './notifications';
import { getDailyInsistenceLines } from './insistenceLines';
import { nudgePhrase, PRE_REMINDER_MIN } from './nudgePhrases';
import { notifyLocalChange } from './syncBus';
import {
  armSpokenTask,
  cancelSpokenChain,
  chainAlarmId,
  spokenTaskText,
  syncSpokenTasks,
  type SpokenTaskAlarm,
} from './spokenNudges';
import { logicalDay, recordHabitEvent, type ConfirmMeta } from './habitEvents';
import {
  snoozeStrictInsistence,
  stopStrictInsistence,
  syncStrictHabits,
  type StrictHabitItem,
} from './strictHabits';
import { refreshReviewNotification } from './review';
import { getRegressionNote } from './habitFormation';
import { getPastSelfQuotesText } from './morning';
import { getOwlSpecies } from '../constants/owlSpecies';
import { clearDayRows, listHabitRows, setMark } from './habitDb';
import { evaluateHabit, reminderPlanOf, type HabitEvaluation, type ReminderPlan } from './habitStage';
import { addDays, daysBetween, isPaused, isScheduledDay, weekStartOf } from './habitStrength';
import { daysMask } from './strictHabits';
import type { Nudge, Tone } from '../types';
import type { HabitDef, HabitStats } from '../types/habits';

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
 * A INSISTÊNCIA CRESCE AOS POUCOS: antes do horário, um aviso gentil; no
 * horário, só o lembrete; a 1ª cobrança — a PERGUNTA, "fez ou precisa de mais
 * tempo?" — vem só por volta de meia hora depois. Daí o espaçamento dobra: com
 * a base 10, as cobranças caem aos 30, 70, 150, 310 e 630 minutos (a série
 * 10, 30, 70… sem o primeiro termo, que perguntava cedo demais).
 *
 * `base` é o intervalo configurado em Lembretes (padrão 10, mínimo 5).
 */
function insistenceOffsetsMin(base: number, count: number): number[] {
  const out: number[] = [];
  let gap = base;
  let acc = 0;
  for (let i = 0; i <= count; i++) {
    acc += gap;
    if (i > 0) out.push(acc);
    gap *= 2;
  }
  return out;
}

/**
 * Um gatilho diário às hh:mm. Respondido ANTES da hora (skipToday), o de hoje
 * não pode tocar — e um gatilho DIÁRIO não sabe pular um dia: os outros 6 dias
 * da semana ficam com gatilho SEMANAL (recorrente — não se esgota se o app
 * passar dias vivo em segundo plano, com o JS congelado e sem reagendar) e só o
 * dia da semana de HOJE vira DATE nas próximas EARLY_ANSWER_WEEKS semanas. O
 * primeiro reagendamento a partir de amanhã devolve o DIÁRIO.
 */
async function scheduleDailySkippingToday(
  content: Notifications.NotificationContentInput,
  hour: number,
  minute: number,
  skipToday: boolean,
  channelId: string,
  days: number[] = ALL_DAYS,
): Promise<{ first: string | null; ids: string[] }> {
  const ids: string[] = [];
  let first: string | null = null;
  const keep = (id: string | null) => {
    if (!id) return;
    ids.push(id);
    first = first ?? id;
  };
  const everyDay = ALL_DAYS.every((d) => days.includes(d));
  if (!skipToday && everyDay) {
    keep(
      await gatedSchedule({
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId },
      }),
    );
    return { first, ids };
  }
  // Dias da semana escolhidos (ou o diário com o dia de HOJE já respondido): um
  // gatilho SEMANAL por dia; o de hoje, se respondido antes da hora, vira DATE
  // nas próximas semanas.
  const todayAt = buildTodayAt(hour, minute);
  const todayDow = todayAt.getDay();
  for (const dow of days) {
    if (dow === todayDow && skipToday) {
      for (let w = 1; w <= EARLY_ANSWER_WEEKS; w++) {
        const at = new Date(todayAt);
        at.setDate(at.getDate() + 7 * w);
        keep(await gatedSchedule({ content, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId } }));
      }
      continue;
    }
    keep(
      await gatedSchedule({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: dow + 1, // expo: 1=domingo … 7=sábado
          hour,
          minute,
          channelId,
        },
      }),
    );
  }
  return { first, ids };
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** A data local de um dia (yyyy-MM-dd) às hh:mm. */
function dateAt(day: string, hour: number, minute: number): Date {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  return new Date(y, (m || 1) - 1, d || 1, hour, minute, 0, 0);
}

/**
 * Os gatilhos de um hábito no horário hh:mm, conforme a FREQUÊNCIA:
 *  - diário / dias da semana: DIÁRIO ou SEMANAIS (ver scheduleDailySkippingToday);
 *  - X vezes por semana: datas avulsas nos próximos 14 dias, menos o resto da
 *    semana corrente se a cota já foi cumprida (reagendado a cada abertura).
 * `nextAt`: a próxima vez que toca (para a voz), ou null.
 */
async function scheduleHabitTrigger(
  def: HabitDef,
  stats: HabitStats,
  content: Notifications.NotificationContentInput,
  hour: number,
  minute: number,
  skipToday: boolean,
  channelId: string,
): Promise<{ first: string | null; ids: string[]; nextAt: number | null }> {
  const today = todayISO();
  const now = Date.now();
  if (def.freq === 'semana') {
    const per = Math.max(1, Math.min(7, def.perWeek ?? 3));
    const quotaMet = (stats.weekDone ?? 0) >= per;
    const thisWeek = weekStartOf(today);
    const ids: string[] = [];
    let first: string | null = null;
    let nextAt: number | null = null;
    for (let i = 0; i < 14; i++) {
      const day = addDays(today, i);
      if (i === 0 && skipToday) continue;
      if (quotaMet && weekStartOf(day) === thisWeek) continue;
      if (isPaused(def, day)) continue;
      const at = dateAt(day, hour, minute);
      if (at.getTime() <= now) continue;
      const id = await gatedSchedule({ content, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId } });
      if (id) {
        ids.push(id);
        first = first ?? id;
        nextAt = nextAt ?? at.getTime();
      }
    }
    return { first, ids, nextAt };
  }
  const days = def.freq === 'dias' ? def.daysOfWeek : ALL_DAYS;
  const r = await scheduleDailySkippingToday(content, hour, minute, skipToday, channelId, days);
  let nextAt: number | null = null;
  for (let i = 0; i < 8 && r.first; i++) {
    const day = addDays(today, i);
    if (!days.includes(new Date(dateAt(day, 12, 0)).getDay())) continue;
    if (i === 0 && skipToday) continue;
    const at = dateAt(day, hour, minute).getTime();
    if (at <= now) continue;
    nextAt = at;
    break;
  }
  return { ...r, nextAt };
}

/** Respondido no dia: feito, não fiz ou folga. */
function answeredIn(done: string[], type: string): boolean {
  return done.includes(type) || done.includes(`${type}:skip`) || done.includes(`${type}:folga`);
}

/** Resolvido no dia: respondido ou dado como sem resposta. */
function settledIn(done: string[], type: string): boolean {
  return answeredIn(done, type) || done.includes(`${type}:missed`);
}

interface HabitPlanEntry {
  def: HabitDef;
  ev: HabitEvaluation;
  plan: ReminderPlan;
  /** Hoje é dia deste hábito (dia escolhido; cota da semana ainda aberta). */
  scheduledToday: boolean;
}

/**
 * Avalia cada hábito ligado e não pausado (fase, graduação) e decide a escada de
 * hoje. Os pausados, arquivados e desligados ficam de fora: nada a agendar.
 */
async function computeHabitPlans(
  habits: HabitDef[],
  today: string,
  maxInsist: number,
  userName: string | null,
): Promise<Map<string, HabitPlanEntry>> {
  const out = new Map<string, HabitPlanEntry>();
  for (const def of habits) {
    if (!def.enabled || def.archived) continue;
    if (def.pausedUntil && def.pausedUntil >= today) continue;
    try {
      const ev = await evaluateHabit(def, today, userName);
      const plan = reminderPlanOf(def, ev.stats, maxInsist);
      const per = Math.max(1, Math.min(7, def.perWeek ?? 3));
      const scheduledToday =
        isScheduledDay(def, today) && !(def.freq === 'semana' && (ev.stats.weekDone ?? 0) >= per && ev.stats.today === 'pendente');
      out.set(def.type, { def, ev, plan, scheduledToday });
    } catch (err) {
      console.warn(`[nudges] avaliação de ${def.type} falhou:`, err);
    }
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

// PONTOS DE DECISÃO (v1.106): cada vez que a coruja decide mandar (ou não)
// uma âncora, uma cobrança ou uma amostra, isso fica registrado — com a
// probabilidade da escolha. É o que permite, depois, estimar o efeito de cada
// cobrança sem confundir "a coruja insistiu" com "a pessoa já ia fazer".
function stratumOf(d: Date): string {
  const h = d.getHours();
  return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
}

function logDecision(p: {
  date: string;
  key: string;
  kind: string;
  k: number;
  action: string;
  technique?: string | null;
  at?: Date | null;
  pAction?: number | null;
}): void {
  void upsertDecisionPoint({
    date: p.date,
    key: p.key,
    kind: p.kind,
    k: p.k,
    action: p.action,
    technique: p.technique ?? null,
    scheduledAt: p.at ? p.at.toISOString() : null,
    pAction: p.pAction ?? 1,
    stratum: p.at ? stratumOf(p.at) : null,
  }).catch(() => {});
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
/**
 * Resposta antecipada: por quantas semanas o dia da semana de HOJE fica com
 * gatilhos DATE (os outros 6 dias seguem com SEMANAL). Margem para o app passar
 * semanas sem reagendar (vivo em segundo plano, sem cold start).
 */
const EARLY_ANSWER_WEEKS = 8;

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
export async function finalizeExpiredNudgeChains(plans?: Map<string, HabitPlanEntry>): Promise<void> {
  const today = todayISO();
  let intervalMin = 10;
  let maxInsistences = DEFAULT_MAX_INSISTENCES;
  let userName: string | null = null;
  try {
    const config = await getUserConfig();
    intervalMin = Math.max(MIN_NUDGE_INTERVAL_MIN, config.reminderIntervalMinutes ?? 10);
    maxInsistences = Math.max(
      0,
      Math.min(10, config.nudgeMaxInsistences ?? DEFAULT_MAX_INSISTENCES),
    );
    userName = config.name ?? null;
  } catch {
    /* keep defaults */
  }

  let doneTypes: string[] = [];
  try {
    doneTypes = await getDoneNudgeTypes(today);
  } catch {
    return; // sem saber o que já foi resolvido, não marca nada
  }

  let entries = plans;
  if (!entries) {
    try {
      entries = await computeHabitPlans(await listHabitRows(), today, maxInsistences, userName);
    } catch {
      return;
    }
  }

  for (const { def: n, plan, scheduledToday } of entries.values()) {
    if (NON_VERIFY_NUDGE_TYPES.has(n.type)) continue;
    // Só a escada com pergunta tem corrente — e só ela vence. Na fase "quase"
    // (só o aviso na hora), o dia sem resposta fica sem registro.
    if (!plan.ask || plan.maxChain <= 0 || !scheduledToday) continue;
    if (settledIn(doneTypes, n.type)) continue;
    const offsets = insistenceOffsetsMin(intervalMin, plan.maxChain);
    if (offsets.length === 0) continue;
    const lastOffset = offsets[offsets.length - 1];
    const parts = n.scheduleTime.split(':').map((x) => parseInt(x, 10));
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const base = buildTodayAt(Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m)));
    // Reaberto pelo usuário (desfez "Feito"/"Não feito" na Home) DEPOIS que a
    // corrente de hoje já terminou: a coruja não volta a dar como perdido por
    // conta própria — senão o ✕ não fazia nada. Reaberto ANTES (de manhã, um
    // hábito da noite), a corrente toca de novo e, sem resposta, vence como
    // qualquer outra — senão o "sem resposta" do dia se perdia.
    const reopened = (await getKV(reopenedKey(n.type)).catch(() => null)) ?? '';
    if (reopened === today) continue; // formato antigo (só a data): como antes
    const reopenedAt = Number(reopened);
    if (Number.isFinite(reopenedAt) && reopenedAt > base.getTime() + lastOffset * 1.2 * 60_000) continue;
    // Só vence o lembrete que TOCOU: hábito ligado (ou com horário mudado) hoje
    // depois do horário não tocou, e registrá-lo como "sem resposta" polui os dados.
    if (!anchorRangToday(await getKV(`anchor_armed:${n.type}`).catch(() => null), n.scheduleTime, today)) {
      continue;
    }
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

/**
 * Chave em app_kv: instante (epoch ms) em que o usuário reabriu o item (desfez
 * a marcação). Valores antigos guardavam só o dia (YYYY-MM-DD).
 */
function reopenedKey(nudgeType: string): string {
  return `reopened:${nudgeType}`;
}

/** Chave em app_kv: até quando (epoch ms) vale o "Me dê mais tempo" do item. */
function snoozeUntilKey(nudgeType: string): string {
  return `snooze_until:${nudgeType}`;
}

function hhmmToMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * A âncora deste hábito tocou (ou vai tocar) HOJE, neste horário? O valor de
 * `anchor_armed:<tipo>` é "HH:MM|dia|HH:MM-em-que-foi-armada" (o 3º campo é
 * novo; valores antigos não o têm). Vale se foi armada antes de hoje, ou hoje
 * antes do horário.
 */
function anchorRangToday(armed: string | null, scheduleTime: string, today: string): boolean {
  const [armedHHMM, armedDate, armedAt] = (armed ?? '').split('|');
  if (armedHHMM !== scheduleTime || !armedDate) return false;
  if (armedDate < today) return true;
  if (armedDate > today) return false;
  const at = armedAt ? hhmmToMinutes(armedAt) : null;
  const sched = hhmmToMinutes(scheduleTime);
  return at !== null && sched !== null && at < sched;
}

// EXCLUSÃO: scheduleAllNudges cancela tudo e reagenda item a item, com dezenas
// de awaits no meio. Duas execuções ao mesmo tempo (no cold start há duas: o
// init da store e o efeito do App) se intercalavam — uma cancelava o que a
// outra acabara de agendar e o resto sobrava em dobro (âncoras DIÁRIAS e
// cobranças duplicadas). Agora só uma roda por vez; quem chega no meio marca
// `nudgeRunDirty` e recebe a mesma promise, que roda mais uma passada no fim.
let nudgeRun: Promise<string[]> | null = null;
let nudgeRunDirty = false;

export function scheduleAllNudges(): Promise<string[]> {
  if (nudgeRun) {
    nudgeRunDirty = true;
    return nudgeRun;
  }
  const run = (async () => {
    let ids: string[] = [];
    do {
      nudgeRunDirty = false;
      ids = await scheduleAllNudgesOnce();
    } while (nudgeRunDirty);
    return ids;
  })().finally(() => {
    nudgeRun = null;
    // Pedido que chegou entre o fim do laço e este finally (ou antes de uma
    // passada que falhou): não pode ficar sem execução.
    if (nudgeRunDirty) {
      nudgeRunDirty = false;
      void scheduleAllNudges().catch(() => {});
    }
  });
  nudgeRun = run;
  return run;
}

/**
 * Espera o reagendamento em curso terminar. Quem vai CANCELAR ou ACRESCENTAR
 * notificações de um item (Já fiz, Não fiz, Me dê mais tempo) precisa disto:
 * uma passada que leu o estado antes da resposta agendaria a corrente DEPOIS
 * do cancelamento, e a coruja seguiria cobrando o que já foi respondido.
 */
async function settleNudgeScheduling(): Promise<void> {
  // Laço: ao terminar, uma passada pendente pode ter começado em seguida.
  while (nudgeRun) await nudgeRun.catch(() => {});
}

/** Notificação única do "Me dê mais tempo" (também recriada ao reagendar). */
async function scheduleSnoozeNotification(
  n: Nudge,
  fireAt: Date,
  sound: string,
  channelId: string,
): Promise<string | null> {
  return gatedSchedule({
    content: {
      title: `${n.emoji ?? '🦉'} ${n.title}`,
      body: `${n.body}\n\nAinda pendente — toque em "Já fiz ✅" quando terminar.`,
      data: {
        type: `nudge:${n.type}`,
        nudgeId: n.id,
        nudgeType: n.type,
        verify: true,
        followup: true,
        day: todayISO(),
        at: fireAt.getTime(),
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
}

/** O aviso falado do "Me dê mais tempo": mesmo prazo e mesmo id ao reagendar. */
function snoozeSpokenAlarm(n: Nudge, fireAt: Date): SpokenTaskAlarm {
  return {
    id: chainAlarmId(n.type, 'snooze', todayISO(), fireAt.getTime()),
    text: spokenTaskText(n.title, `${n.body}. Ainda pendente.`),
    atEpochMs: fireAt.getTime(),
    repeatDaily: false,
  };
}

async function scheduleAllNudgesOnce(): Promise<string[]> {
  // As versões FALADAS de tudo o que for agendado abaixo: a mesma corrente, para
  // a voz chegar com o celular no bolso e o fone no ouvido.
  const spoken: SpokenTaskAlarm[] = [];
  // Os hábitos RIGOROSOS: no horário, o nativo vibra em pulsos até a resposta.
  const strict: StrictHabitItem[] = [];

  const channelId = await ensureChannel();
  await ensureNotificationCategories();

  let sound: string = 'default';
  let intervalMin = 10;
  let maxInsistences = DEFAULT_MAX_INSISTENCES;
  let tone: Tone = 'gentle';
  let userName: string | null = null;
  try {
    const config = await getUserConfig();
    tone = config.tone ?? 'gentle';
    userName = config.name ?? null;
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
  // A FASE de cada hábito (e a graduação) decide a escada de hoje — avaliada uma
  // vez só e compartilhada com o fechamento das correntes vencidas.
  const habits = await listHabitRows();
  const plans = await computeHabitPlans(habits, today, maxInsistences, userName);

  // Antes de reagendar: fecha o que já venceu, para não re-armar corrente de
  // item que a coruja já desistiu de cobrar hoje.
  await finalizeExpiredNudgeChains(plans);
  await cancelAllNudges();

  let doneTypes: string[] = [];
  try {
    doneTypes = await getDoneNudgeTypes(today);
  } catch {
    /* if the completions read fails, treat nothing as done */
  }

  const ids: string[] = [];
  await resetFutureDecisionPoints(today, new Date().toISOString()).catch(() => {});

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
  const pendingVerify = Array.from(plans.values()).filter(
    (e) =>
      e.plan.ask &&
      e.plan.maxChain > 0 &&
      e.scheduledToday &&
      e.def.kind === 'fazer' &&
      !NON_VERIFY_NUDGE_TYPES.has(e.def.type) &&
      !settledIn(doneTypes, e.def.type),
  );
  const linesByType = new Map<string, Awaited<ReturnType<typeof getDailyInsistenceLines>>>();
  if (pendingVerify.length > 0) {
    const results = await Promise.all(
      pendingVerify.map((e) =>
        getDailyInsistenceLines(e.def, e.plan.maxChain, {
          pastSelfQuotes,
          deferGeneration: true,
          onGenerated: rescheduleSoon,
        }).catch(() => null),
      ),
    );
    results.forEach((r, i) => {
      if (r) linesByType.set(pendingVerify[i].def.type, r);
    });
  }

  for (const n of habits) {
    const entry = plans.get(n.type);
    if (!entry) {
      // Desligado, arquivado ou pausado: o gatilho deixa de existir — ao voltar, conta de novo.
      void setKV(`anchor_armed:${n.type}`, '').catch(() => {});
      continue;
    }
    const { ev, plan, scheduledToday } = entry;
    const parts = n.scheduleTime.split(':').map((s) => parseInt(s, 10));
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const safeHour = Math.min(23, Math.max(0, h));
    const safeMinute = Math.min(59, Math.max(0, m));

    const isVerify = !NON_VERIFY_NUDGE_TYPES.has(n.type);
    const title = `${n.emoji ?? '🦉'} ${n.title}`;
    const baseData = { type: `nudge:${n.type}`, nudgeId: n.id, nudgeType: n.type };
    const anchorToday = buildTodayAt(safeHour, safeMinute);

    // GRADUOU agora: a coruja explica por que vai se calar. É um evento — e é para ser.
    if (ev.justGraduated) {
      const text = nudgePhrase('graduado', { task: n.title, name: userName, tone, day: today, key: n.type });
      const at = Date.now() + 20_000;
      try {
        const id = await gatedSchedule({
          content: { title, body: text, data: { ...baseData, verify: false, graduated: true }, sound },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId },
        });
        if (id) {
          ids.push(id);
          spoken.push({ id: chainAlarmId(n.type, 'formed', today, at), text: spokenTaskText(n.title, text), atEpochMs: at, repeatDaily: false });
        }
      } catch (err) {
        console.warn(`failed to schedule graduation ${n.type}:`, err);
      }
    }

    // AS 4 PERGUNTAS (formado, ou sem avisos): um aviso único no horário do
    // hábito, no máximo a cada 3 dias — a Home também mostra o cartão.
    if (plan.srbaiCheck && anchorToday.getTime() > Date.now()) {
      const last = (await getKV(`srbai_notified:${n.type}`).catch(() => null)) ?? '';
      if (!last || daysBetween(last, today) >= 3) {
        const text = nudgePhrase('srbai', { task: n.title, name: userName, tone, day: today, key: n.type });
        try {
          const id = await gatedSchedule({
            content: { title, body: text, data: { ...baseData, verify: false, srbai: true }, sound },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: anchorToday, channelId },
          });
          if (id) {
            ids.push(id);
            void setKV(`srbai_notified:${n.type}`, today).catch(() => {});
          }
        } catch (err) {
          console.warn(`failed to schedule srbai check ${n.type}:`, err);
        }
      }
    }

    if (!plan.anchor) {
      // A fase não pede aviso hoje (formado, ou "nenhum") — também é uma decisão.
      if (isVerify && scheduledToday) {
        logDecision({ date: today, key: n.type, kind: 'anchor', k: 0, action: 'skip', technique: `fase:${ev.stats.stage}`, at: anchorToday });
      }
      void setKV(`anchor_armed:${n.type}`, '').catch(() => {});
      continue;
    }

    // NO HORÁRIO: só lembra, sem perguntar — uma fala que muda todo dia. No dia
    // seguinte a uma falta, a fala é de VOLTA ("nunca duas vezes"); com pista, a
    // fala cita a pista (lembrete amarrado ao contexto forma hábito). No hábito
    // de PARAR, é a conferência da noite.
    const phraseCtx = { task: n.title, name: userName, tone, day: today, key: n.type, cue: n.cue };
    let anchorBody: string;
    if (n.kind === 'parar') {
      anchorBody = nudgePhrase('parar', phraseCtx);
    } else {
      const comeback = ev.stats.missedYesterday;
      anchorBody = nudgePhrase(comeback ? 'volta' : 'hora_pista', phraseCtx);
      if (comeback && n.minimum) anchorBody += `\nNem que seja a versão mínima: ${n.minimum}.`;
      if (n.body?.trim()) anchorBody += `\n${n.body.trim()}`;
      const reg = await getRegressionNote(n.type, today, n.title).catch(() => null);
      if (reg) anchorBody = reg;
    }
    // JÁ RESPONDIDO hoje e o horário ainda não chegou (marcou "Já fiz" de manhã
    // um hábito das 18h): o aviso de HOJE não pode tocar — nem o gentil de antes.
    const answered = isVerify && answeredIn(doneTypes, n.type);
    const answeredEarly = answered && anchorToday.getTime() > Date.now();

    // ANTES DO HORÁRIO: um aviso gentil, sem botão de resposta — "está chegando".
    const preMins = safeHour * 60 + safeMinute - PRE_REMINDER_MIN;
    if (plan.pre && n.kind === 'fazer' && preMins >= 0) {
      const preHour = Math.floor(preMins / 60);
      const preMinute = preMins % 60;
      const preToday = buildTodayAt(preHour, preMinute);
      const preBody = nudgePhrase('antes', { ...phraseCtx, minutes: PRE_REMINDER_MIN });
      const skipPre = answered && preToday.getTime() > Date.now();
      try {
        const pre = await scheduleHabitTrigger(
          n,
          ev.stats,
          { title, body: preBody, data: { ...baseData, verify: false, pre: true }, sound },
          preHour,
          preMinute,
          skipPre,
          channelId,
        );
        ids.push(...pre.ids);
        if (pre.nextAt) {
          spoken.push({ id: `${n.type}~pre`, text: spokenTaskText(n.title, preBody), atEpochMs: pre.nextAt, repeatDaily: n.freq === 'diario' });
        }
      } catch (err) {
        console.warn(`failed to schedule nudge pre-reminder ${n.type}:`, err);
      }
    }

    try {
      const anchor = await scheduleHabitTrigger(
        n,
        ev.stats,
        {
          title,
          body: anchorBody,
          data: { ...baseData, verify: isVerify, ...(n.kind === 'parar' ? { parar: true } : {}) },
          sound,
          // Um botão só ("Já fiz"): a pergunta vem meia hora depois. No de parar,
          // "Dia limpo" / "Escorreguei".
          ...(isVerify ? { categoryIdentifier: n.kind === 'parar' ? PARAR_CATEGORY : NUDGE_SOFT_CATEGORY } : {}),
        },
        safeHour,
        safeMinute,
        answeredEarly,
        channelId,
      );
      ids.push(...anchor.ids);
      const id = anchor.first;
      if (anchor.nextAt) {
        spoken.push({
          id: `${n.type}~anchor`,
          text: spokenTaskText(n.title, anchorBody),
          atEpochMs: anchor.nextAt,
          repeatDaily: n.freq === 'diario',
        });
      }
      // Registra a âncora de hoje se ela ainda vai tocar, ou se já tocou — o que
      // só é certo quando o gatilho, com este horário, já estava armado antes de
      // hoje (hábito criado ou com horário mudado depois do horário só toca amanhã).
      if (isVerify) {
        const armedKey = `anchor_armed:${n.type}`;
        const [armedHHMM, armedDate] = ((await getKV(armedKey).catch(() => null)) ?? '').split('|');
        const armedBefore = armedHHMM === n.scheduleTime && !!armedDate && armedDate < today;
        if (scheduledToday && !answeredEarly && (anchorToday.getTime() > Date.now() || armedBefore)) {
          logDecision({ date: today, key: n.type, kind: 'anchor', k: 0, action: id ? 'send' : 'blocked', at: anchorToday });
        }
        if (id && armedHHMM !== n.scheduleTime) {
          // 3º campo: a hora em que foi armada — é o que diz se ainda tocou hoje.
          const nowD = new Date();
          const armedAt = `${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}`;
          void setKV(armedKey, `${n.scheduleTime}|${today}|${armedAt}`).catch(() => {});
        }
      }
    } catch (err) {
      console.warn(`failed to schedule nudge anchor ${n.type}:`, err);
    }

    // RIGOROSO: além da âncora (e da corrente), o nativo vibra em pulsos no horário
    // até a resposta — sempre que a fase pede aviso na hora. Escolha do hábito.
    // Na frequência semanal com a cota cumprida, a semana está feita: não chama.
    if (isVerify && n.strict && (n.freq !== 'semana' || scheduledToday)) {
      const answeredToday = settledIn(doneTypes, n.type);
      const snoozeUntil = answeredToday
        ? 0
        : Number(await getKV(snoozeUntilKey(n.type)).catch(() => null)) || 0;
      strict.push({
        key: n.type,
        title,
        body: anchorBody,
        name: n.title,
        hour: safeHour,
        minute: safeMinute,
        days: n.freq === 'dias' ? daysMask(n.daysOfWeek) : 127,
        skipDay: answeredToday ? today : '',
        resumeAt: snoozeUntil > Date.now() ? snoozeUntil : 0,
      });
    }

    // Corrente de hoje — só na fase que pede pergunta e cobranças, num dia do
    // hábito ainda sem resposta. As cobranças são GERADAS para esta pessoa (com
    // fallback fixo), os horários têm jitter, e cada uma leva o rótulo da técnica.
    if (
      isVerify &&
      plan.ask &&
      plan.maxChain > 0 &&
      scheduledToday &&
      n.kind === 'fazer' &&
      !settledIn(doneTypes, n.type)
    ) {
      const base = anchorToday;
      // "Me dê mais tempo" ainda valendo: recria o aviso do adiamento (o
      // cancelAllNudges acima o apagou) e não cobra antes dele.
      const snoozeUntil = Number(await getKV(snoozeUntilKey(n.type)).catch(() => null)) || 0;
      const snoozed = snoozeUntil > Date.now();
      if (snoozed) {
        try {
          const id = await scheduleSnoozeNotification(n, new Date(snoozeUntil), sound, channelId);
          if (id) {
            ids.push(id);
            spoken.push(snoozeSpokenAlarm(n, new Date(snoozeUntil)));
          }
        } catch (err) {
          console.warn(`failed to re-schedule snooze ${n.type}:`, err);
        }
      }
      const offsets = jitteredOffsetsMin(intervalMin, plan.maxChain, `${today}|${n.type}`);
      if (offsets.length === 0) continue;
      // A última batida não convence: só pede o registro (Fiz / Não fiz / Por quê).
      const lastK = offsets.reduce((acc, o, i) => (o !== null ? i + 1 : acc), 0);
      const gen =
        linesByType.get(n.type) ??
        (await getDailyInsistenceLines(n, offsets.length, {
          pastSelfQuotes,
          deferGeneration: true,
          onGenerated: rescheduleSoon,
        }));
      const lines = gen.lines;
      // Probabilidade de uma batida do meio ser pulada (ver jitteredOffsetsMin):
      // 1/8 por dia, sorteada entre as batidas do meio.
      const pSkip = offsets.length >= 4 ? 1 / 8 / (offsets.length - 2) : 0;
      for (let k = 1; k <= offsets.length; k++) {
        const off = offsets[k - 1];
        const isMiddle = k > 1 && k < offsets.length;
        if (off === null) {
          // batida pulada de propósito — registrada como decisão
          logDecision({ date: today, key: n.type, kind: 'insistence', k, action: 'skip', technique: 'pulada', pAction: pSkip });
          continue;
        }
        const fireAt = new Date(base.getTime() + off * 60_000);
        if (fireAt.getTime() <= Date.now()) continue;
        if (snoozed && fireAt.getTime() <= snoozeUntil) continue;
        const line = lines[k - 1] ?? lines[lines.length - 1];
        if (!line) continue;
        const isLast = k === lastK && lastK > 1;
        // A 1ª cobrança é a PERGUNTA (fez, mais tempo ou hoje não — e por que a
        // coruja precisa saber). Das seguintes, as geradas pelo modelo; sem elas,
        // o banco de falas, que gira todo dia (as fixas viravam ladainha).
        const isAsk = k === 1;
        const text = isAsk
          ? nudgePhrase('pergunta', phraseCtx)
          : gen.generated
            ? line.text
            : nudgePhrase('insiste', { ...phraseCtx, k });
        const technique = isLast ? 'fechamento' : isAsk ? 'pergunta-pessoal' : line.technique;
        void bumpTechnique(technique, 'shown').catch(() => {});
        const closeText = `Não precisa fazer agora. Só me diz: “${n.title}” — fez ou não fez?`;
        try {
          const id = await gatedSchedule({
            content: {
              title,
              body: isLast ? closeText : isAsk ? text : withActionLine(text),
              // `day`/`at`: a que dia a cobrança pertence e quando toca — para a
              // resposta depois da meia-noite e para o "Me dê mais tempo".
              data: { ...baseData, verify: true, followup: true, technique, k, day: today, at: fireAt.getTime() },
              sound,
              categoryIdentifier: isLast ? NUDGE_CLOSE_CATEGORY : NUDGE_CATEGORY,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireAt,
              channelId,
            },
          });
          if (id) {
            ids.push(id);
            spoken.push({
              id: chainAlarmId(n.type, `f${k}`, today, fireAt.getTime()),
              // Sem a instrução do botão, que só faz sentido na tela.
              text: isLast ? spokenTaskText('', closeText) : spokenTaskText(isAsk ? '' : n.title, text),
              atEpochMs: fireAt.getTime(),
              repeatDaily: false,
            });
          }
          logDecision({
            date: today,
            key: n.type,
            kind: 'insistence',
            k,
            action: id ? 'send' : 'blocked',
            technique,
            at: fireAt,
            pAction: isMiddle ? 1 - pSkip : 1,
          });
        } catch (err) {
          console.warn(`failed to schedule nudge follow-up ${n.type}:`, err);
        }
      }
    }
  }

  // REVISÃO DA SEMANA: domingo, 18:30 — cinco minutos para olhar a semana e
  // ajustar o que atrapalhou (pista, versão mínima, plano B). Só com hábitos.
  if (plans.size > 0) {
    try {
      const id = await gatedSchedule({
        content: {
          title: '🦉 Revisão da semana',
          body: 'Cinco minutos para olhar a semana dos seus hábitos e ajustar o que atrapalhou.',
          data: { type: 'nudge:weekly-review', weeklyReview: true },
          sound,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 18, minute: 30, channelId },
      });
      if (id) ids.push(id);
    } catch (err) {
      console.warn('failed to schedule weekly review:', err);
    }
  }

  // "Fechar o dia": só existe se sobrou item sem resposta.
  await refreshReviewNotification();

  // Arma sem esperar a rede (a voz do Gemini vem depois). Com await, para quem
  // espera esta passada (settleNudgeScheduling) cancelar a voz já com tudo armado.
  await syncSpokenTasks('nudge', spoken).catch(() => {});
  // Idem para a vibração dos rigorosos (hábito que saiu da lista para de insistir).
  await syncStrictHabits('nudge', strict).catch(() => {});
  notifyLocalChange();

  return ids;
}

/**
 * Encerra o que estava agendado/visível de um nudge depois de uma resposta:
 * cancela as insistências (follow-ups) do dia respondido e dispensa as
 * notificações dele na bandeja. Se a resposta veio ANTES do horário de hoje,
 * reagenda para a âncora de hoje não tocar (ver scheduleAllNudgesOnce).
 */
async function closeNudgeChain(nudgeType: string, day: string, scheduledHHMM: string | null): Promise<void> {
  // Um reagendamento em curso leu o estado antes desta resposta: espera ele
  // acabar, senão a corrente seria agendada depois do cancelamento abaixo.
  await settleNudgeScheduling();

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { nudgeType?: string; followup?: boolean; day?: string };
    // Resposta ao lembrete de ONTEM (depois da meia-noite) não derruba a
    // corrente de hoje, se ela já tiver sido armada.
    if (data?.nudgeType === nudgeType && data?.followup && (!data.day || data.day === day)) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
  // A voz das cobranças respondidas cala junto com as notificações.
  await cancelSpokenChain('nudge', nudgeType, { day }).catch(() => {});
  notifyLocalChange();

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

  const mins = scheduledHHMM ? hhmmToMinutes(scheduledHHMM) : null;
  if (day === todayISO() && mins !== null) {
    const at = buildTodayAt(Math.floor(mins / 60), mins % 60);
    if (at.getTime() > Date.now()) await scheduleAllNudges().catch(() => {});
  }
}

/**
 * Marca um comportamento como feito hoje, encerra a corrente de insistências
 * de hoje e dispensa as notificações já visíveis daquele nudge. A âncora
 * diária permanece para o dia seguinte. `meta` diz por onde veio a resposta
 * (e, em `meta.day`, a que dia pertence o lembrete respondido).
 * `opts.minimum`: fez a VERSÃO MÍNIMA (conta como feito; fica anotado).
 */
export async function confirmNudge(
  nudgeType: string,
  meta: ConfirmMeta = {},
  opts: { minimum?: boolean } = {},
): Promise<void> {
  const today = logicalDay(meta.day);
  // Rigoroso vibrando: para já, antes de qualquer espera abaixo.
  stopStrictInsistence(nudgeType, today);
  try {
    await markNudgeDone(nudgeType, today);
    // Um dia tem um estado só: o "feito" substitui o "não fiz", a folga e o
    // "sem resposta" (correção, ou a resposta que chegou de outro aparelho).
    await setMark(nudgeType, ':skip', today, false);
    await setMark(nudgeType, ':folga', today, false);
    await setMark(nudgeType, ':missed', today, false);
    await setMark(nudgeType, ':min', today, !!opts.minimum);
  } catch (err) {
    console.warn(`failed to mark nudge done ${nudgeType}:`, err);
  }
  const scheduledHHMM = await scheduleTimeOf(nudgeType);
  void recordHabitEvent(nudgeType, 'done', opts.minimum ? { ...meta, technique: meta.technique ?? 'minimo' } : meta, scheduledHHMM);
  void cancelFutureDecisionPoints(today, nudgeType, new Date().toISOString()).catch(() => {});
  void refreshReviewNotification();
  await closeNudgeChain(nudgeType, today, scheduledHHMM);
}

/**
 * "Não vou fazer hoje": encerra a insistência de hoje SEM contar como feito
 * (chave `:skip`, separada para não inflar estatísticas). Volta a lembrar amanhã.
 * Num hábito de PARAR, é o DESLIZE do dia.
 */
export async function skipNudgeToday(nudgeType: string, meta: ConfirmMeta = {}): Promise<void> {
  const today = logicalDay(meta.day);
  stopStrictInsistence(nudgeType, today);
  try {
    await markNudgeDone(`${nudgeType}:skip`, today);
    await setMark(nudgeType, '', today, false);
    await setMark(nudgeType, ':min', today, false);
    await setMark(nudgeType, ':folga', today, false);
    await setMark(nudgeType, ':missed', today, false);
  } catch (err) {
    console.warn(`failed to mark nudge skipped ${nudgeType}:`, err);
  }
  const scheduledHHMM = await scheduleTimeOf(nudgeType);
  void recordHabitEvent(nudgeType, 'not_done', meta, scheduledHHMM);
  void cancelFutureDecisionPoints(today, nudgeType, new Date().toISOString()).catch(() => {});
  void refreshReviewNotification();
  await closeNudgeChain(nudgeType, today, scheduledHHMM);
}

/**
 * FOLGA (v1.130): dia neutro — doente, viagem, descanso. Encerra a insistência
 * de hoje e NÃO conta nem como feito nem como falta (a força fica como estava).
 */
export async function restNudgeToday(nudgeType: string, meta: ConfirmMeta = {}): Promise<void> {
  const today = logicalDay(meta.day);
  stopStrictInsistence(nudgeType, today);
  try {
    await setMark(nudgeType, ':folga', today, true);
    await setMark(nudgeType, '', today, false);
    await setMark(nudgeType, ':min', today, false);
    await setMark(nudgeType, ':skip', today, false);
    await setMark(nudgeType, ':missed', today, false);
  } catch (err) {
    console.warn(`failed to mark nudge rest ${nudgeType}:`, err);
  }
  const scheduledHHMM = await scheduleTimeOf(nudgeType);
  void recordHabitEvent(nudgeType, 'rest', meta, scheduledHHMM);
  void cancelFutureDecisionPoints(today, nudgeType, new Date().toISOString()).catch(() => {});
  void refreshReviewNotification();
  await closeNudgeChain(nudgeType, today, scheduledHHMM);
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
    await markNudgeUndone(`${nudgeType}:min`, today);
    // Também o "Não feito" automático, e avisa o finalize para não re-marcar.
    await markNudgeUndone(`${nudgeType}:missed`, today);
    await setKV(reopenedKey(nudgeType), String(Date.now()));
  } catch (err) {
    console.warn(`failed to mark nudge undone ${nudgeType}:`, err);
  }
  void recordHabitEvent(nudgeType, 'undone', { via: 'home' });
  await scheduleAllNudges();
}

/**
 * Volta o hábito de hoje para PENDENTE — desfaz "Já fiz", "Não vou fazer hoje",
 * a folga, a versão mínima e a quantidade do dia. Re-agenda (re-arma a
 * insistência). Deixa o usuário CORRIGIR a marcação.
 */
export async function resetNudgeToday(nudgeType: string): Promise<void> {
  const today = todayISO();
  try {
    // O "Não feito" automático (:missed) também sai — e fica anotado que o item
    // foi REABERTO hoje, para o finalizeExpiredNudgeChains não re-marcá-lo na
    // passada seguinte (era o que fazia o ✕ da Home não mudar nada).
    await clearDayRows(nudgeType, today);
    await setKV(reopenedKey(nudgeType), String(Date.now()));
  } catch (err) {
    console.warn(`failed to reset nudge ${nudgeType}:`, err);
  }
  // Registra o "desfazer": se a marcação desfeita era automática (relógio,
  // prática no app), isto é um FALSO POSITIVO do sensor — dado precioso.
  void recordHabitEvent(nudgeType, 'undone', { via: 'home' });
  await scheduleAllNudges();
}

/**
 * "Me dê mais tempo": PAUSA a corrente por `minutes` minutos e agenda um único
 * aviso para o fim do prazo (não marca como feito). As insistências que
 * tocariam antes disso são canceladas — o botão promete sossego, não mais um
 * aviso por cima dos outros — e a notificação visível sai da bandeja. As que
 * vêm depois, e a âncora diária, seguem intactas.
 *
 * `opts.until`: prazo exato (epoch ms) em vez de `minutes` a partir de agora — é
 * o "Mais tempo" tocado na notificação rigorosa, aplicado depois (strictAnswers).
 */
export async function snoozeNudge(
  nudgeType: string,
  minutes = 20,
  opts: { until?: number } = {},
): Promise<void> {
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

  const fireAt =
    opts.until && opts.until > Date.now()
      ? new Date(opts.until)
      : new Date(Date.now() + Math.max(1, minutes) * 60_000);
  // Rigoroso: para de vibrar agora e volta a insistir no fim do prazo.
  snoozeStrictInsistence(nudgeType, fireAt.getTime());
  // Guarda o prazo: qualquer reagendamento (abrir o app, salvar algo) cancela
  // todos os nudges e precisa saber recriar este aviso e pular o que vem antes.
  await setKV(snoozeUntilKey(nudgeType), String(fireAt.getTime())).catch(() => {});
  // Reagendamento em curso: espera, para ele não apagar o aviso recém-criado.
  await settleNudgeScheduling();

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) {
      const data = s.content.data as { nudgeType?: string; followup?: boolean; at?: number };
      if (data?.nudgeType !== nudgeType || !data?.followup) continue;
      // Sem `at` (agendada por versão anterior): na dúvida, silencia.
      if (typeof data.at === 'number' && data.at > fireAt.getTime()) continue;
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const p of presented) {
      const data = p.request.content.data as { nudgeType?: string };
      if (data?.nudgeType === nudgeType) {
        await Notifications.dismissNotificationAsync(p.request.identifier);
      }
    }
  } catch {
    /* best-effort: o aviso do adiamento ainda é agendado abaixo */
  }
  await cancelSpokenChain('nudge', nudgeType, { upToMs: fireAt.getTime() }).catch(() => {});

  try {
    const id = await scheduleSnoozeNotification(n, fireAt, sound, channelId);
    if (id) await armSpokenTask('nudge', snoozeSpokenAlarm(n, fireAt));
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

/** Liga/desliga o modo RIGOROSO (vibra em pulsos até a resposta) de um hábito. */
export async function setNudgeStrict(id: number, strict: boolean): Promise<Nudge | null> {
  const result = await updateNudge(id, { strict });
  await scheduleAllNudges();
  return result;
}
