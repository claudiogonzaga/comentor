// O APP DE HÁBITOS (v1.130) — a API que as telas usam.
//
// Um hábito é uma linha de `nudges` (ver src/types/habits.ts); o registro do dia
// fica em `nudge_completions` (chaves `<t>`, `<t>:min`, `<t>:folga`, `<t>:skip`,
// `<t>:missed`) e a quantidade em `habit_values`. A força, a fase e a graduação
// são calculadas em habitStrength.ts / habitStage.ts. Os avisos continuam sendo
// agendados por nudges.ts, agora com a escada que diminui conforme a fase.

import { format } from 'date-fns';
import {
  addHabitEvent,
  createMedication,
  deleteMedication,
  getDb,
  getHabitEventsBetween,
  getHabitState,
  getKV,
  getMedication,
  getUserConfig,
  setKV,
} from './database';
import { logicalDay, recordHabitEvent, type ConfirmVia } from './habitEvents';
import {
  addSlipRow,
  clearDayRows,
  deleteHabitRow,
  getHabitRow,
  getMarksOf,
  getValuesOf,
  insertHabitRow,
  listHabitRows,
  listSlipRows,
  listSrbaiRows,
  recordSrbaiRow,
  setMark,
  setValueRow,
  updateHabitRow,
} from './habitDb';
import {
  dropCelebration,
  evaluateHabit,
  pushCelebration,
  readCelebrations,
  statsFor,
} from './habitStage';
import { addDays, dayStatusOf, dowOf, isScheduledDay, MILESTONES, weekStartOf } from './habitStrength';
import { nudgePhrase } from './nudgePhrases';
import {
  confirmNudge,
  resetNudgeToday,
  restNudgeToday,
  scheduleAllNudges,
  skipNudgeToday,
} from './nudges';
import { scheduleAllMedications } from './medications';
import { notifyLocalChange } from './syncBus';
import type {
  HabitDayStatus,
  HabitDef,
  HabitInput,
  HabitMark,
  HabitPeriod,
  HabitSlip,
  HabitStats,
  MarkResult,
  SrbaiEntry,
  TodayHabit,
  WeekHabitSummary,
  WeekSummary,
} from '../types/habits';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const FOREVER = '9999-12-31';

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function reschedule(): void {
  void scheduleAllNudges().catch(() => {});
}

function newType(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  return `h-${s}`;
}

// ————————————————— consultas —————————————————

/** Todos os hábitos (sem os arquivados, salvo pedido), na ordem da lista. */
export async function listHabits(opts: { includeArchived?: boolean } = {}): Promise<HabitDef[]> {
  return listHabitRows(!!opts.includeArchived);
}

export async function getHabit(type: string): Promise<HabitDef | null> {
  return getHabitRow(type);
}

/** Estatísticas de um hábito (força, fase, calendário, sequência…). */
export async function getHabitStats(type: string): Promise<HabitStats> {
  const def = await getHabitRow(type);
  if (!def) throw new Error(`hábito não encontrado: ${type}`);
  return statsFor(def);
}

/** Estatísticas de todos os hábitos não arquivados, por `type`. */
export async function getAllHabitStats(): Promise<Record<string, HabitStats>> {
  const out: Record<string, HabitStats> = {};
  for (const def of await listHabitRows()) {
    try {
      out[def.type] = await statsFor(def);
    } catch (err) {
      console.warn(`[habitos] stats de ${def.type}:`, err);
    }
  }
  return out;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : 24 * 60;
}

/**
 * Os hábitos de HOJE: ligados, não arquivados, não pausados e que são do dia
 * (em 'dias', só nos dias escolhidos; em 'semana', todo dia — com doneForWeek
 * quando a cota já foi cumprida). Os FORMADOS entram também (a tela pode
 * recolhê-los). Ordenados por horário.
 */
export async function getTodayHabits(): Promise<TodayHabit[]> {
  const today = todayISO();
  const out: TodayHabit[] = [];
  for (const def of await listHabitRows()) {
    if (!def.enabled) continue;
    if (def.pausedUntil && def.pausedUntil >= today) continue;
    if (!isScheduledDay(def, today)) continue;
    try {
      const stats = await statsFor(def, today);
      const per = Math.max(1, Math.min(7, def.perWeek ?? 3));
      const doneForWeek = def.freq === 'semana' && (stats.weekDone ?? 0) >= per && stats.today !== 'feito' && stats.today !== 'minimo';
      out.push({ habit: def, stats, period: periodOf(def.scheduleTime), doneForWeek });
    } catch (err) {
      console.warn(`[habitos] hoje: ${def.type}:`, err);
    }
  }
  out.sort((a, b) => minutesOf(a.habit.scheduleTime) - minutesOf(b.habit.scheduleTime));
  return out;
}

/** Estado de um dia qualquer (para o calendário e a edição retroativa). */
export async function getDayStatus(
  type: string,
  day: string,
): Promise<{ status: HabitDayStatus; value: number | null; reason: string | null }> {
  const def = await getHabitRow(type);
  if (!def) return { status: 'fora', value: null, reason: null };
  const [marks, values, events] = await Promise.all([getMarksOf(type, day), getValuesOf(type, day), getHabitEventsBetween(day, day)]);
  const status = dayStatusOf(def, day, marks[day], values[day], todayISO());
  const reason = events.filter((e) => e.key === type && e.reason).pop()?.reason ?? null;
  return { status, value: values[day] ?? null, reason };
}

/** Manhã (< 12h), tarde (< 18h) ou noite, pelo horário HH:MM. */
export function periodOf(hhmm: string): HabitPeriod {
  const h = parseInt(hhmm.split(':')[0] ?? '', 10);
  if (!Number.isFinite(h)) return 'manha';
  return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
}

/** Hábitos em formação agora (para o aviso "a pesquisa sugere começar com poucos"). */
export async function countFormingHabits(): Promise<number> {
  let n = 0;
  const today = todayISO();
  for (const def of await listHabitRows()) {
    if (!def.enabled || (def.pausedUntil && def.pausedUntil >= today)) continue;
    if ((await getHabitState(def.type)).state === 'forming') n += 1;
  }
  return n;
}

// ————————————————— criar, editar, pausar —————————————————

/** Normaliza o que a tela manda (frequência coerente, horários válidos). */
function normalize(input: Partial<HabitInput>): Partial<HabitDef> {
  const out: Partial<HabitDef> = { ...input };
  if (out.scheduleTime !== undefined && !/^\d{1,2}:\d{2}$/.test(out.scheduleTime)) out.scheduleTime = '08:00';
  if (out.freq === 'diario') out.daysOfWeek = [...ALL_DAYS];
  if (out.freq === 'dias' && (!out.daysOfWeek || out.daysOfWeek.length === 0)) out.daysOfWeek = [...ALL_DAYS];
  if (out.freq === 'semana' && !out.perWeek) out.perWeek = 3;
  if (out.measure === 'sim') {
    out.target = null;
    out.unit = null;
  }
  return out;
}

export async function createHabit(input: HabitInput): Promise<HabitDef> {
  let type = newType();
  while (await getHabitRow(type)) type = newType();
  const def = await insertHabitRow(type, {
    kind: 'fazer',
    freq: 'diario',
    daysOfWeek: [...ALL_DAYS],
    reminders: 'auto',
    measure: 'sim',
    scheduleTime: input.kind === 'parar' ? '21:00' : '08:00',
    ...normalize(input),
    title: input.title.trim(),
    createdDay: todayISO(),
  });
  reschedule();
  return def;
}

export async function updateHabit(type: string, patch: Partial<HabitInput>): Promise<HabitDef | null> {
  const def = await updateHabitRow(type, normalize(patch));
  reschedule();
  return def;
}

/** Apaga o hábito e o histórico dele. */
export async function deleteHabit(type: string): Promise<void> {
  await deleteHabitRow(type);
  reschedule();
}

export async function archiveHabit(type: string, archived = true): Promise<void> {
  await updateHabitRow(type, { archived });
  reschedule();
}

/** Calcula as pausas novas: pausar até `until` a partir de hoje, ou retomar (null). */
function pausesAfter(def: HabitDef, until: string | null, today: string): { pauses: [string, string][]; pausedUntil: string | null } {
  const yesterday = addDays(today, -1);
  // A pausa que cobre hoje (ou começa depois): encurta ou sai.
  const kept: [string, string][] = [];
  for (const [a, b] of def.pauses) {
    if (b < today) kept.push([a, b]);
    else if (a < today) kept.push([a, yesterday]);
    // começa hoje ou depois: some (é substituída)
  }
  if (until) {
    kept.push([today, until < today ? today : until]);
    return { pauses: kept, pausedUntil: until < today ? today : until };
  }
  return { pauses: kept, pausedUntil: null };
}

/** Pausa até `until` (yyyy-MM-dd, inclusive; '9999-12-31' = sem data). null = retomar hoje. */
export async function pauseHabit(type: string, until: string | null): Promise<void> {
  const def = await getHabitRow(type);
  if (!def) return;
  await updateHabitRow(type, pausesAfter(def, until, todayISO()));
  reschedule();
}

/** Modo férias: pausa (ou retoma, com null) todos os hábitos ativos. */
export async function pauseAllHabits(until: string | null): Promise<void> {
  const today = todayISO();
  for (const def of await listHabitRows()) {
    if (until && (!def.enabled || def.archived)) continue;
    if (!until && !(def.pausedUntil && def.pausedUntil >= today)) continue;
    await updateHabitRow(def.type, pausesAfter(def, until, today));
  }
  reschedule();
}

/** Copia as marcas de uma chave para outra (feito e não fiz), no banco. */
async function copyMarks(fromKey: string, toKey: string): Promise<void> {
  const d = await getDb();
  for (const suffix of ['', ':skip']) {
    await d.runAsync(
      `INSERT OR IGNORE INTO nudge_completions (nudge_type, date, completed_at)
       SELECT ?, date, completed_at FROM nudge_completions WHERE nudge_type = ?`,
      [`${toKey}${suffix}`, `${fromKey}${suffix}`],
    );
  }
}

/** Vira LEMBRETE (tabela medications): sai da formação, guarda o histórico. Devolve o id do lembrete. */
export async function convertHabitToReminder(type: string): Promise<number> {
  const def = await getHabitRow(type);
  if (!def) throw new Error('hábito não encontrado');
  const med = await createMedication({
    name: def.title,
    dosage: def.body || null,
    time: def.scheduleTime,
    emoji: def.emoji ?? '🔔',
    enabled: def.enabled && !def.archived,
    daysOfWeek: def.freq === 'dias' ? def.daysOfWeek : [...ALL_DAYS],
    strict: def.strict,
  });
  await copyMarks(type, `med:${med.id}`);
  const d = await getDb();
  await d.runAsync('UPDATE habit_events SET key = ? WHERE key = ?', [`med:${med.id}`, type]);
  await deleteHabitRow(type);
  reschedule();
  void scheduleAllMedications().catch(() => {});
  notifyLocalChange();
  return med.id;
}

/** O lembrete vira HÁBITO. Devolve o `type` novo. */
export async function convertReminderToHabit(medId: number): Promise<string> {
  const med = await getMedication(medId);
  if (!med) throw new Error('lembrete não encontrado');
  let type = `h-m${medId}`;
  if (await getHabitRow(type)) type = newType();
  const d = await getDb();
  const first = await d.getFirstAsync<{ first: string | null }>(
    'SELECT MIN(date) AS first FROM nudge_completions WHERE nudge_type = ? OR nudge_type = ?',
    [`med:${medId}`, `med:${medId}:skip`],
  );
  const days = med.daysOfWeek?.length ? med.daysOfWeek : [...ALL_DAYS];
  await insertHabitRow(type, {
    title: med.name,
    body: med.dosage ?? '',
    emoji: med.emoji,
    enabled: med.enabled,
    scheduleTime: med.time,
    strict: med.strict,
    kind: 'fazer',
    freq: days.length === 7 ? 'diario' : 'dias',
    daysOfWeek: days,
    reminders: 'auto',
    measure: 'sim',
    createdDay: first?.first ?? todayISO(),
  });
  await copyMarks(`med:${medId}`, type);
  await d.runAsync('UPDATE habit_events SET key = ? WHERE key = ?', [type, `med:${medId}`]);
  await deleteMedication(medId);
  reschedule();
  void scheduleAllMedications().catch(() => {});
  notifyLocalChange();
  return type;
}

// ————————————————— registrar —————————————————

/** Hoje, ou ontem (resposta tardia): o dia passa pela corrente de avisos. */
function isLiveDay(day: string): boolean {
  return logicalDay(day) === day;
}

async function milestoneFor(def: HabitDef, stats: HabitStats): Promise<number | null> {
  if (!MILESTONES.includes(stats.total)) return null;
  const k = `marco:${def.type}:${stats.total}`;
  if (await getKV(k).catch(() => null)) return null;
  await setKV(k, todayISO()).catch(() => {});
  return stats.total;
}

/** Todos os hábitos de hoje resolvidos como feitos (formados e cota da semana cumprida não contam). */
async function isPerfectDay(): Promise<boolean> {
  const list = (await getTodayHabits()).filter((h) => !h.stats.formed && !h.doneForWeek);
  return list.length > 0 && list.every((h) => h.stats.today === 'feito' || h.stats.today === 'minimo');
}

async function resultAfter(def: HabitDef, mark: HabitMark | 'valor', day: string): Promise<MarkResult> {
  const today = todayISO();
  const stats = await statsFor(def, today);
  const positive = mark === 'feito' || mark === 'minimo' || (mark === 'valor' && (stats.today === 'feito' || stats.today === 'minimo'));
  if (!positive || day !== today) return { milestone: null, perfectDay: false, comeback: false };
  return {
    milestone: await milestoneFor(def, stats),
    perfectDay: await isPerfectDay(),
    comeback: stats.missedYesterday,
  };
}

/**
 * Marca um dia (hoje, ou `opts.day` para corrigir o passado):
 *  - feito / minimo: conta como feito (minimo guarda que foi a versão mínima);
 *  - folga: dia neutro (doente, viagem, descanso) — exige motivo na tela;
 *  - nao: não fiz (num hábito de parar: deslize).
 * Encerra a insistência do dia e devolve o que comemorar.
 */
export async function markHabit(
  type: string,
  mark: HabitMark,
  opts: { day?: string; via?: ConfirmVia; reason?: string | null } = {},
): Promise<MarkResult> {
  const def = await getHabitRow(type);
  if (!def) throw new Error('hábito não encontrado');
  const day = opts.day ?? todayISO();
  const meta = { via: opts.via ?? ('home' as ConfirmVia), reason: opts.reason ?? null, day };

  if (isLiveDay(day)) {
    // Hoje (ou ontem, respondido tarde): passa pela corrente — para a insistência,
    // a vibração e a voz, e registra o evento.
    if (mark === 'feito' || mark === 'minimo') {
      await confirmNudge(type, meta, { minimum: mark === 'minimo' });
      if (def.measure === 'quantidade' && def.target && mark === 'feito') {
        const cur = (await getValuesOf(type, day))[day] ?? 0;
        if (cur < def.target) await setValueRow(type, day, def.target);
      }
    } else if (mark === 'folga') {
      await restNudgeToday(type, meta);
    } else {
      await skipNudgeToday(type, meta);
    }
  } else {
    // Dia passado: corrige o registro direto (sem corrente) e anota o evento no dia certo.
    await clearDayRows(type, day);
    if (mark === 'feito' || mark === 'minimo') {
      await setMark(type, '', day, true);
      if (mark === 'minimo') await setMark(type, ':min', day, true);
      if (def.measure === 'quantidade' && def.target && mark === 'feito') await setValueRow(type, day, def.target);
    } else if (mark === 'folga') {
      await setMark(type, ':folga', day, true);
    } else {
      await setMark(type, ':skip', day, true);
    }
    await addHabitEvent({
      key: type,
      date: day,
      status: mark === 'folga' ? 'rest' : mark === 'nao' ? 'not_done' : 'done',
      via: meta.via,
      k: null,
      technique: mark === 'minimo' ? 'versao-minima' : 'retroativo',
      latencyMin: null,
      reason: meta.reason?.trim() || null,
      evidence: null,
    }).catch(() => {});
    reschedule(); // a força mudou: a fase (e a escada de hoje) pode mudar
    notifyLocalChange();
  }
  return resultAfter(def, mark, day);
}

/** Hábito de quantidade: registra o valor do dia (atingiu a meta = feito). */
export async function setHabitValue(
  type: string,
  value: number,
  opts: { day?: string; via?: ConfirmVia } = {},
): Promise<MarkResult> {
  const def = await getHabitRow(type);
  if (!def) throw new Error('hábito não encontrado');
  const day = opts.day ?? todayISO();
  const v = Math.max(0, value);
  await setValueRow(type, day, v > 0 ? v : null);
  const reached = !!def.target && v >= def.target;
  const marks = (await getMarksOf(type, day))[day] ?? {};
  if (reached && !marks.done) {
    return markHabit(type, 'feito', { day, via: opts.via });
  }
  if (!reached && marks.done) {
    // Baixou da meta: volta a parcial (a corrente do dia, se houver, volta a valer).
    if (isLiveDay(day) && day === todayISO()) {
      await resetNudgeToday(type);
      if (v > 0) await setValueRow(type, day, v);
    } else {
      await setMark(type, '', day, false);
      await setMark(type, ':min', day, false);
    }
  }
  notifyLocalChange();
  return resultAfter(def, 'valor', day);
}

/** Desfaz o registro do dia (hoje, ou `day`) — volta a pendente/sem registro. */
export async function clearHabitDay(type: string, day?: string): Promise<void> {
  const d = day ?? todayISO();
  if (d === todayISO()) {
    await resetNudgeToday(type);
    return;
  }
  await clearDayRows(type, d);
  await addHabitEvent({
    key: type,
    date: d,
    status: 'undone',
    via: 'home',
    k: null,
    technique: 'retroativo',
    latencyMin: null,
    reason: null,
    evidence: null,
  }).catch(() => {});
  reschedule();
  notifyLocalChange();
}

type SlipCtx = { place?: string | null; emotion?: string | null; trigger?: string | null; note?: string | null };

/** Hábito de parar: registra um DESLIZE com o contexto (e marca o dia como 'nao'). */
export async function logSlip(type: string, ctx: SlipCtx): Promise<void> {
  await addSlipRow({
    key: type,
    at: new Date().toISOString(),
    place: ctx.place ?? null,
    emotion: ctx.emotion ?? null,
    trigger: ctx.trigger ?? null,
    note: ctx.note ?? null,
    resisted: false,
  });
  const reason = [ctx.emotion, ctx.place, ctx.trigger].filter(Boolean).join(' · ') || null;
  await markHabit(type, 'nao', { via: 'home', reason });
}

/**
 * O contexto de um deslize já registrado hoje (pela notificação "Escorreguei"):
 * completa o deslize sem marcar de novo.
 */
export async function addSlipContext(type: string, ctx: SlipCtx): Promise<void> {
  await addSlipRow({
    key: type,
    at: new Date().toISOString(),
    place: ctx.place ?? null,
    emotion: ctx.emotion ?? null,
    trigger: ctx.trigger ?? null,
    note: ctx.note ?? null,
    resisted: false,
  });
  await dismissSlipContext(type);
  notifyLocalChange();
}

const SLIP_CTX_PREFIX = 'slip_ctx:';

/**
 * "Escorreguei" tocado na notificação da noite: registra o deslize do dia e
 * deixa o contexto (onde, como estava) para a Home pedir depois, sem pressa.
 */
export async function markSlipFromNotification(type: string, meta: { via?: ConfirmVia; day?: string | null } = {}): Promise<void> {
  const day = logicalDay(meta.day);
  await skipNudgeToday(type, { via: meta.via ?? 'notification', day, technique: 'deslize' });
  await setKV(`${SLIP_CTX_PREFIX}${type}`, day).catch(() => {});
}

/** Hábitos de parar com um deslize de hoje (ou ontem) ainda sem contexto. */
export async function getPendingSlipContexts(): Promise<HabitDef[]> {
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const out: HabitDef[] = [];
  for (const def of await listHabitRows()) {
    if (def.kind !== 'parar') continue;
    const v = await getKV(`${SLIP_CTX_PREFIX}${def.type}`).catch(() => null);
    if (v === today || v === yesterday) out.push(def);
  }
  return out;
}

export async function dismissSlipContext(type: string): Promise<void> {
  await setKV(`${SLIP_CTX_PREFIX}${type}`, '').catch(() => {});
}

/** Hábito de parar: a vontade veio e passou (surfou a vontade) — sem deslize. */
export async function logUrgeResisted(type: string, ctx: SlipCtx = {}): Promise<void> {
  await addSlipRow({
    key: type,
    at: new Date().toISOString(),
    place: ctx.place ?? null,
    emotion: ctx.emotion ?? null,
    trigger: ctx.trigger ?? null,
    note: ctx.note ?? null,
    resisted: true,
  });
  void recordHabitEvent(type, 'done', { via: 'home', technique: 'vontade-superada' });
  notifyLocalChange();
}

export async function listSlips(type: string, sinceDays = 90): Promise<HabitSlip[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  return listSlipRows(type, since);
}

/**
 * As 4 perguntas de automaticidade (SRBAI, Gardner et al. 2012), cada uma de 1 a 7:
 * "é algo que eu faço automaticamente / sem precisar lembrar / sem pensar /
 * começo antes de perceber". Pode graduar (ou rebaixar) o hábito.
 */
export async function recordSrbai(
  type: string,
  items: [number, number, number, number],
  day?: string,
): Promise<{ graduated: boolean; regressed: boolean }> {
  const def = await getHabitRow(type);
  if (!def) return { graduated: false, regressed: false };
  await recordSrbaiRow(type, day ?? todayISO(), items);
  let name: string | null = null;
  try {
    name = (await getUserConfig()).name ?? null;
  } catch {
    /* sem nome */
  }
  const ev = await evaluateHabit(def, todayISO(), name);
  reschedule();
  notifyLocalChange();
  return { graduated: ev.justGraduated, regressed: ev.justRegressed };
}

export async function listSrbai(type: string): Promise<SrbaiEntry[]> {
  return listSrbaiRows(type);
}

/** Hábitos com as 4 perguntas pendentes (cada um no máximo a cada 14 dias). */
export async function getDueSrbai(): Promise<HabitDef[]> {
  const out: HabitDef[] = [];
  for (const def of await listHabitRows()) {
    try {
      if ((await statsFor(def)).srbaiDue) out.push(def);
    } catch {
      /* pula */
    }
  }
  return out;
}

/** Motivos registrados (não fiz / folga / deslize) nos últimos dias. */
export async function getHabitReasons(
  type: string,
  sinceDays = 30,
): Promise<{ date: string; status: string; reason: string }[]> {
  const today = todayISO();
  const events = await getHabitEventsBetween(addDays(today, -sinceDays), today);
  return events
    .filter((e) => e.key === type && e.reason)
    .map((e) => ({ date: e.date, status: e.status, reason: e.reason as string }))
    .reverse();
}

// ————————————————— cartões da Home —————————————————

export const MIGRATION_REVIEW_KV = 'habitos_v1_review';

/** A revisão da migração (o que virou hábito e o que ficou como lembrete), até ser dispensada. */
export async function getMigrationReview(): Promise<{ habits: string[]; reminders: number[] } | null> {
  try {
    const raw = await getKV(MIGRATION_REVIEW_KV);
    if (!raw) return null;
    const v = JSON.parse(raw) as { habits: string[]; reminders: number[]; dismissed?: boolean };
    if (v.dismissed) return null;
    // Só o que ainda existe.
    const habits: string[] = [];
    for (const t of v.habits ?? []) if (await getHabitRow(t)) habits.push(t);
    const reminders: number[] = [];
    for (const id of v.reminders ?? []) if (await getMedication(id)) reminders.push(id);
    if (!habits.length && !reminders.length) return null;
    return { habits, reminders };
  } catch {
    return null;
  }
}

export async function dismissMigrationReview(): Promise<void> {
  try {
    const raw = await getKV(MIGRATION_REVIEW_KV);
    const v = raw ? JSON.parse(raw) : { habits: [], reminders: [] };
    await setKV(MIGRATION_REVIEW_KV, JSON.stringify({ ...v, dismissed: true }));
  } catch {
    /* nada */
  }
}

const RECOMECO_KV = 'recomeco_dismissed';

/**
 * RECOMEÇO (efeito "fresh start"): na segunda-feira e no dia 1º, os hábitos que
 * falharam 2+ vezes nos últimos 7 dias — para ajustar a pista, a versão mínima…
 */
export async function getRecomeco(): Promise<{ reason: 'semana' | 'mes'; habits: HabitDef[] } | null> {
  const today = todayISO();
  const isMonth = today.endsWith('-01');
  const isMonday = dowOf(today) === 1;
  if (!isMonth && !isMonday) return null;
  if ((await getKV(RECOMECO_KV).catch(() => null)) === today) return null;
  const habits: HabitDef[] = [];
  for (const def of await listHabitRows()) {
    if (!def.enabled || def.kind !== 'fazer') continue;
    if (def.pausedUntil && def.pausedUntil >= today) continue;
    try {
      const st = await statsFor(def, today);
      if (st.formed) continue;
      // Os 7 dias antes de hoje no mapa de calor (o último caractere é hoje).
      const week = st.heat.slice(-8, -1);
      const misses = (week.match(/[NX.]/g) ?? []).length;
      if (misses >= 2) habits.push(def);
    } catch {
      /* pula */
    }
  }
  return habits.length ? { reason: isMonth ? 'mes' : 'semana', habits } : null;
}

export async function dismissRecomeco(): Promise<void> {
  await setKV(RECOMECO_KV, todayISO()).catch(() => {});
}

/** Comemoração pendente (marco atingido, hábito graduado), até ser vista. */
export async function getPendingCelebration(): Promise<{
  id: string;
  type: string;
  kind: 'marco' | 'graduado' | 'regressao';
  n: number | null;
  text: string;
} | null> {
  // Marcos atingidos fora da tela (pela notificação, pelo Mac): avalia agora.
  try {
    const name = (await getUserConfig().catch(() => null))?.name ?? null;
    for (const def of await listHabitRows()) {
      const stats = await statsFor(def);
      const reached = MILESTONES.filter((m) => m <= stats.total);
      const top = reached[reached.length - 1];
      if (!top) continue;
      const k = `marco:${def.type}:${top}`;
      if (await getKV(k).catch(() => null)) continue;
      await setKV(k, todayISO()).catch(() => {});
      // Só comemora o marco recém-cruzado (não os antigos, na primeira vez).
      if (stats.total - top <= 2) {
        await pushCelebration({
          id: `marco:${def.type}:${top}`,
          type: def.type,
          kind: 'marco',
          n: top,
          text: nudgePhrase('marco', { task: def.title, name, day: todayISO(), key: def.type, count: top }),
        });
      }
    }
  } catch {
    /* sem marcos */
  }
  const list = await readCelebrations();
  return list[0] ?? null;
}

export async function dismissCelebration(id: string): Promise<void> {
  await dropCelebration(id);
}

/** Os números da semana (segunda a domingo) para a revisão semanal. */
export async function getWeekSummary(weekStart?: string): Promise<WeekSummary> {
  const today = todayISO();
  // Na segunda, a revisão é da semana que acabou; nos outros dias, da corrente.
  const start = weekStart ?? (dowOf(today) === 1 ? addDays(weekStartOf(today), -7) : weekStartOf(today));
  const end = addDays(start, 6);
  const last = end < today ? end : today;
  const events = await getHabitEventsBetween(start, end);
  const slips = await listSlipRows(null, `${start}T00:00:00`);
  const habits: WeekHabitSummary[] = [];
  for (const def of await listHabitRows()) {
    if (!def.enabled) continue;
    const stats = await statsFor(def, today);
    const [marks, values] = await Promise.all([getMarksOf(def.type, start), getValuesOf(def.type, start)]);
    let done = 0;
    let expected = 0;
    for (let d = start; d <= last; d = addDays(d, 1)) {
      const st = dayStatusOf(def, d, marks[d], values[d], today);
      if (st === 'feito' || st === 'minimo') done += 1;
      if (st !== 'fora' && st !== 'folga' && st !== 'pendente') expected += 1;
    }
    if (def.freq === 'semana') expected = Math.max(1, Math.min(7, def.perWeek ?? 3));
    // A força no fim do dia anterior ao início e no último dia (a série termina hoje).
    const n = stats.series.length;
    const idxOf = (day: string) => n - 1 - Math.max(0, Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86_400_000));
    const iStart = idxOf(addDays(start, -1));
    const iEnd = idxOf(last);
    habits.push({
      habit: def,
      done,
      expected,
      strengthStart: iStart >= 0 ? stats.series[iStart] : 0,
      strengthEnd: iEnd >= 0 ? stats.series[iEnd] : stats.strength,
      reasons: events.filter((e) => e.key === def.type && e.reason).map((e) => ({ date: e.date, status: e.status, reason: e.reason as string })),
      slips: slips.filter((x) => x.key === def.type && !x.resisted && x.at.slice(0, 10) <= end).length,
      resisted: slips.filter((x) => x.key === def.type && x.resisted && x.at.slice(0, 10) <= end).length,
    });
  }
  return { weekStart: start, weekEnd: end, habits };
}

/** Uma pausa sem data (até retomar). */
export const PAUSE_FOREVER = FOREVER;
