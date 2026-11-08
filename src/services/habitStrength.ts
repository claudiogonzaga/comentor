// FORÇA DO HÁBITO e as demais estatísticas — funções puras (sem banco).
//
// A força é a média exponencial do Loop Habit Tracker (iSoron/uhabits, Score.kt):
// cada dia feito fecha uma fração da distância até 100%, cada falta tira a mesma
// fração do valor atual. Com hábito diário, a meia-vida é de 13 dias: ~80% em 30
// dias perfeitos, 96% em 60, 99% em 90. Uma falta isolada num hábito forte tira
// pouco; faltas repetidas derrubam — exatamente o que a pesquisa diz (Lally et al.
// 2010: perder uma oportunidade não afeta a formação; faltas repetidas, sim).
//
// Dias que NÃO contam (a força fica como estava): folga, pausa, antes de o hábito
// existir, dia fora dos escolhidos (frequência 'dias') e hoje enquanto pendente.
// Num hábito FORMADO ou de PARAR, o dia sem registro também não conta: o formado
// já não é lembrado (cobrar o registro seria trazer a muleta de volta), e no de
// parar só o deslize registrado é falha.

import type { HabitDayStatus, HabitDef, HabitStats } from '../types/habits';
import { HEAT_CHAR, HEAT_DAYS } from '../types/habits';
import type { DayMarks } from './habitDb';

export interface StrengthInput {
  def: HabitDef;
  marks: Record<string, DayMarks>;
  values: Record<string, number>;
  /** SRBAI (data e média), em ordem cronológica. */
  srbai: { date: string; mean: number }[];
  formed: boolean;
  /** Dia de hoje (yyyy-MM-dd). */
  today: string;
}

export const MILESTONES = [7, 21, 30, 66, 100, 200, 365];
/** De quantos em quantos dias as 4 perguntas de automaticidade voltam. */
export const SRBAI_EVERY_DAYS = 14;

// ——— datas (dia local como string yyyy-MM-dd; contas em UTC para não sofrer com horário de verão) ———

function toUTC(day: string): number {
  const [y, m, d] = day.split('-').map((x) => parseInt(x, 10));
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

function fromUTC(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  return fromUTC(toUTC(day) + n * 86_400_000);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

/** 0 = domingo … 6 = sábado. */
export function dowOf(day: string): number {
  return new Date(toUTC(day)).getUTCDay();
}

/** Segunda-feira da semana do dia. */
export function weekStartOf(day: string): string {
  const dow = dowOf(day);
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function isPaused(def: Pick<HabitDef, 'pauses' | 'pausedUntil'>, day: string): boolean {
  for (const [a, b] of def.pauses) if (day >= a && day <= b) return true;
  return false;
}

/** O dia é do hábito? (independe do registro) */
export function isScheduledDay(def: HabitDef, day: string): boolean {
  if (day < def.createdDay) return false;
  if (isPaused(def, day)) return false;
  if (def.freq === 'dias') return def.daysOfWeek.includes(dowOf(day));
  return true;
}

/** Frequência em vezes por dia (1 = diário). */
export function frequencyOf(def: HabitDef): number {
  if (def.freq === 'dias') return Math.max(1, def.daysOfWeek.length) / 7;
  if (def.freq === 'semana') return Math.max(1, Math.min(7, def.perWeek ?? 3)) / 7;
  return 1;
}

/** Estado de um dia, a partir das marcas e da quantidade. */
export function dayStatusOf(def: HabitDef, day: string, marks: DayMarks | undefined, value: number | undefined, today: string): HabitDayStatus {
  if (day > today) return 'fora';
  if (!isScheduledDay(def, day)) return 'fora';
  const m = marks ?? {};
  if (m.folga && !m.done) return 'folga';
  if (m.done) return m.min ? 'minimo' : 'feito';
  if (def.measure === 'quantidade' && (value ?? 0) > 0 && def.target && (value ?? 0) < def.target) return 'parcial';
  if (m.skip) return 'nao';
  if (m.missed) return 'sem_resposta';
  return day === today ? 'pendente' : 'vazio';
}

/** Valor do dia para a força (null = não conta). */
function valueOf(def: HabitDef, st: HabitDayStatus, value: number | undefined, formed: boolean): number | null {
  switch (st) {
    case 'feito':
    case 'minimo':
      return 1;
    case 'parcial':
      return def.target ? Math.max(0, Math.min(1, (value ?? 0) / def.target)) : 0;
    case 'nao':
    case 'sem_resposta':
      return 0;
    case 'vazio':
      return formed || def.kind === 'parar' ? null : 0;
    default:
      return null; // fora, folga, pendente
  }
}

export interface ComputedStats extends Omit<HabitStats, 'stage' | 'srbaiDue'> {
  /** Dias desde o primeiro dia do hábito. */
  ageDays: number;
}

export function computeStats(input: StrengthInput): ComputedStats {
  const { def, marks, values, formed, today } = input;
  const start = def.createdDay <= today ? def.createdDay : today;
  const f = frequencyOf(def);
  const weekly = def.freq === 'semana';
  const perWeek = Math.max(1, Math.min(7, def.perWeek ?? 3));
  // Por evento (diário/dias): meia-vida de 13/√f dias corridos = 13·√f eventos.
  const mEvent = Math.pow(0.5, 1 / (13 * Math.sqrt(f)));
  // Por dia corrido (semana): a fórmula do Loop.
  const mDay = Math.pow(0.5, Math.sqrt(f) / 13);

  const heatFrom = addDays(today, -(HEAT_DAYS - 1));
  const heat: string[] = [];
  const series: number[] = [];
  const statuses: { day: string; st: HabitDayStatus; v: number | null }[] = [];

  let s = 0;
  // janela móvel de 14 dias de feitos (frequência 'semana')
  const doneWindow: number[] = [];
  let windowSum = 0;

  // Antes do primeiro dia do hábito, o mapa mostra "fora".
  for (let d = heatFrom; d < start && d <= today; d = addDays(d, 1)) {
    heat.push(HEAT_CHAR.fora);
    series.push(0);
  }

  for (let day = start; day <= today; day = addDays(day, 1)) {
    const st = dayStatusOf(def, day, marks[day], values[day], today);
    const v = valueOf(def, st, values[day], formed);
    statuses.push({ day, st, v });

    if (weekly) {
      const done = st === 'feito' || st === 'minimo' ? 1 : st === 'parcial' ? (v ?? 0) : 0;
      doneWindow.push(done);
      windowSum += done;
      if (doneWindow.length > 14) windowSum -= doneWindow.shift() as number;
      const skip = st === 'fora' || st === 'folga' || st === 'pendente' || (formed && st === 'vazio');
      if (!skip) {
        const w = Math.min(1, windowSum / (2 * perWeek));
        s = s * mDay + w * (1 - mDay);
      }
    } else if (v !== null) {
      s = s * mEvent + v * (1 - mEvent);
    }

    if (day >= heatFrom) {
      heat.push(HEAT_CHAR[st]);
      series.push(Math.round(s * 1000) / 1000);
    }
  }

  // ——— últimos 30 dias (sem hoje, se pendente) ———
  // Hoje pendente fica de fora: a janela são os 30 dias até ontem.
  const todayPending = statuses.length > 0 && statuses[statuses.length - 1].st === 'pendente';
  const from30 = addDays(today, todayPending ? -30 : -29);
  let done30 = 0;
  let total30 = 0;
  let counted30 = 0;
  for (const x of statuses) {
    if (x.day < from30) continue;
    if (x.st === 'feito' || x.st === 'minimo') done30 += 1;
    if (x.st === 'fora' || x.st === 'folga' || x.st === 'pendente') continue;
    counted30 += 1;
    if (x.v !== null) total30 += 1;
  }
  if (weekly) total30 = Math.max(done30, Math.round((perWeek * counted30) / 7));

  // ——— sequência "nunca falhe duas vezes" ———
  let streak = 0;
  let best = 0;
  if (weekly) {
    // Por semana (seg–dom): semana com a cota cumprida soma os feitos; duas
    // semanas seguidas sem a cota zeram. A semana corrente só soma.
    const curWeek = weekStartOf(today);
    const byWeek = new Map<string, { done: number; counted: number }>();
    for (const x of statuses) {
      const w = weekStartOf(x.day);
      const e = byWeek.get(w) ?? { done: 0, counted: 0 };
      if (x.st === 'feito' || x.st === 'minimo') e.done += 1;
      if (x.st !== 'fora' && x.st !== 'folga') e.counted += 1;
      byWeek.set(w, e);
    }
    let prevMiss = false;
    for (const [w, e] of Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      if (w === curWeek) {
        streak += e.done;
      } else if (e.counted === 0) {
        continue; // semana toda pausada/folga
      } else if (e.done >= Math.min(perWeek, e.counted)) {
        streak += e.done;
        prevMiss = false;
      } else if (prevMiss) {
        streak = 0;
      } else {
        prevMiss = true;
        streak += e.done;
      }
      best = Math.max(best, streak);
    }
  } else {
    let prevMiss = false;
    for (const x of statuses) {
      if (x.v === null) continue;
      if (x.v >= 0.5) {
        streak += 1;
        prevMiss = false;
      } else if (prevMiss) {
        streak = 0;
      } else {
        prevMiss = true;
      }
      best = Math.max(best, streak);
    }
  }

  const total = statuses.filter((x) => x.st === 'feito' || x.st === 'minimo').length;

  let weekDone: number | null = null;
  if (weekly) {
    const ws = weekStartOf(today);
    weekDone = statuses.filter((x) => x.day >= ws && (x.st === 'feito' || x.st === 'minimo')).length;
  }

  const yesterday = statuses.length >= 2 ? statuses[statuses.length - 2] : null;
  const missedYesterday =
    def.kind === 'fazer' &&
    !formed &&
    !weekly &&
    !!yesterday &&
    (yesterday.st === 'nao' || yesterday.st === 'sem_resposta' || yesterday.st === 'vazio');

  // Num hábito de parar: dias desde o último deslize (ou desde o início).
  let cleanDays: number | null = null;
  if (def.kind === 'parar') {
    let lastSlip: string | null = null;
    for (const x of statuses) if (x.st === 'nao') lastSlip = x.day;
    const todaySt = statuses[statuses.length - 1]?.st;
    if (todaySt === 'nao') cleanDays = 0;
    else {
      const from = lastSlip ? addDays(lastSlip, 1) : start;
      // Hoje entra só quando confirmado limpo.
      cleanDays = Math.max(0, daysBetween(from, today) + (todaySt === 'feito' || todaySt === 'minimo' ? 1 : 0));
    }
  }

  const todayEntry = statuses[statuses.length - 1];
  const lastSrbai = input.srbai.length ? input.srbai[input.srbai.length - 1] : null;

  return {
    type: def.type,
    strength: Math.max(0, Math.min(1, s)),
    formed,
    last30: { done: done30, total: total30 },
    streak,
    best,
    total,
    heat: heat.join('').slice(-HEAT_DAYS).padStart(HEAT_DAYS, HEAT_CHAR.fora),
    series: series.slice(-HEAT_DAYS),
    srbai: lastSrbai ? Math.round(lastSrbai.mean * 10) / 10 : null,
    srbaiAt: lastSrbai?.date ?? null,
    weekDone,
    missedYesterday,
    today: todayEntry?.st ?? 'fora',
    todayValue: values[today] ?? null,
    cleanDays,
    ageDays: daysBetween(start, today),
  };
}
