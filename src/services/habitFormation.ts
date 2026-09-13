// HÁBITO FORMADO → a coruja se cala. E confere de vez em quando.
//
// Máquina de estados por hábito (tabela habit_state):
//
//   formando ──(14 dos últimos 16 dias feitos)──► formado
//   formado ──(a cada 6 dias)──► amostrando: uma pergunta de um toque,
//                                "ainda fazendo isso?" Sim / Não
//   amostrando ──(Sim)──► formado, contador de falhas zerado
//   amostrando ──(Não, 2 vezes)──► formando de novo, com REGRESSÃO nomeada:
//                                "você tinha isso na mão por N semanas. O que mudou?"
//
// Enquanto formado, não há lembrete diário nem corrente de insistências para
// aquele hábito, e ele some da lista da Home. O silêncio de uma coruja que
// sempre falou é um evento — e a volta dela é outro. O efeito colateral é o mais
// importante: menos ruído devolve atenção ao que ainda não está formado.
//
// O sono tem tratamento próprio (isSleepHabitFormed): não usa nudge_completions
// e sim daily_log, e "formado" encurta a corrente noturna em vez de zerá-la.

import { format } from 'date-fns';
import {
  countNudgeDoneDays,
  getHabitState,
  getKV,
  getRecentLogs,
  markNudgeDone,
  setHabitState,
  setKV,
  type HabitState,
} from './database';

export const FORMED_WINDOW_DAYS = 16;
export const FORMED_MIN_DONE = 14;
export const SAMPLE_EVERY_DAYS = 6;
export const REGRESSION_MISSES = 2;
/** Por quantos dias a âncora nomeia a regressão depois de ela acontecer. */
const REGRESSION_NOTE_DAYS = 3;

export interface FormationDecision {
  state: HabitState;
  /** O que agendar hoje: tudo (formando), nada (formado) ou só a amostra. */
  schedule: 'normal' | 'none' | 'sample';
  /** Acabou de virar formado nesta avaliação — merece um anúncio. */
  justFormed: boolean;
  doneDays: number;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${toISO}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Avalia o estado do hábito para hoje e devolve o que agendar. Idempotente
 * dentro do mesmo dia: rodar de novo não re-anuncia nem re-agenda amostra.
 */
export async function evaluateFormation(nudgeType: string, todayISO: string): Promise<FormationDecision> {
  const s = await getHabitState(nudgeType);
  const doneDays = await countNudgeDoneDays(nudgeType, FORMED_WINDOW_DAYS);

  if (s.state === 'forming') {
    if (doneDays >= FORMED_MIN_DONE) {
      const next: HabitState = {
        ...s,
        state: 'formed',
        formedAt: todayISO,
        lastSampleAt: todayISO,
        sampleMisses: 0,
      };
      await setHabitState(next);
      return { state: next, schedule: 'none', justFormed: true, doneDays };
    }
    return { state: s, schedule: 'normal', justFormed: false, doneDays };
  }

  // formado ou amostrando
  const since = s.lastSampleAt ? daysBetween(s.lastSampleAt, todayISO) : SAMPLE_EVERY_DAYS;
  if (since >= SAMPLE_EVERY_DAYS) {
    const next: HabitState = { ...s, state: 'sampling', lastSampleAt: todayISO };
    await setHabitState(next);
    return { state: next, schedule: 'sample', justFormed: false, doneDays };
  }
  // Amostra já agendada hoje (mesmo dia): mantém.
  if (s.state === 'sampling' && since === 0) {
    return { state: s, schedule: 'sample', justFormed: false, doneDays };
  }
  return { state: s, schedule: 'none', justFormed: false, doneDays };
}

/**
 * Resposta à amostra. "Sim" conta como feito e zera as falhas; "Não" acumula —
 * na segunda, o hábito volta a "formando" e a regressão fica registrada para a
 * próxima âncora nomeá-la.
 */
export async function recordSampleAnswer(
  nudgeType: string,
  yes: boolean,
  todayISO: string,
): Promise<{ regressed: boolean }> {
  const s = await getHabitState(nudgeType);
  if (yes) {
    await markNudgeDone(nudgeType, todayISO).catch(() => {});
    await setHabitState({ ...s, state: 'formed', sampleMisses: 0, lastSampleAt: todayISO });
    return { regressed: false };
  }
  await markNudgeDone(`${nudgeType}:sample-no`, todayISO).catch(() => {});
  const misses = s.sampleMisses + 1;
  if (misses >= REGRESSION_MISSES) {
    const weeks = s.formedAt ? Math.max(1, Math.round(daysBetween(s.formedAt, todayISO) / 7)) : 0;
    await setHabitState({ ...s, state: 'forming', formedAt: null, sampleMisses: 0, lastSampleAt: todayISO });
    await setKV(`regression:${nudgeType}`, JSON.stringify({ date: todayISO, weeks })).catch(() => {});
    return { regressed: true };
  }
  await setHabitState({ ...s, state: 'formed', sampleMisses: misses, lastSampleAt: todayISO });
  return { regressed: false };
}

/** Texto para a âncora nomear a regressão, nos dias seguintes a ela; null fora disso. */
export async function getRegressionNote(nudgeType: string, todayISO: string, title: string): Promise<string | null> {
  try {
    const raw = await getKV(`regression:${nudgeType}`);
    if (!raw) return null;
    const { date, weeks } = JSON.parse(raw) as { date: string; weeks: number };
    if (daysBetween(date, todayISO) > REGRESSION_NOTE_DAYS) return null;
    const span = weeks >= 1 ? `por ${weeks} semana${weeks > 1 ? 's' : ''}` : 'por um bom tempo';
    return `Você tinha “${title}” na mão ${span}. O que mudou? Vamos retomar de onde parou.`;
  } catch {
    return null;
  }
}

/** Texto do anúncio quando o hábito acaba de ser dado como formado. */
export function formedAnnouncement(title: string, doneDays: number): string {
  return `${doneDays} dos últimos ${FORMED_WINDOW_DAYS} dias. “${title}” já é seu. Vou parar de cobrar — e conferir de vez em quando.`;
}

// ————————————————— Sono —————————————————

function toMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Minutos de atraso de `actual` em relação a `target`, tratando a virada da meia-noite. */
export function minutesLateOf(target: string, actual: string | null): number | null {
  if (!actual) return null;
  const t = toMinutes(target);
  let a = toMinutes(actual);
  if (t === null || a === null) return null;
  if (a < t - 720) a += 1440; // 00:30 depois de um alvo 23:00 é +90, não −1350
  return a - t;
}

export interface SleepFormation {
  formed: boolean;
  onTime: number;
  total: number;
}

/** Sono "formado": 14 das últimas 16 noites registradas no horário (tolerância de 15 min). */
export async function isSleepHabitFormed(habitId: number): Promise<SleepFormation> {
  try {
    const logs = await getRecentLogs(habitId, FORMED_WINDOW_DAYS);
    const onTime = logs.filter((l) => {
      if (!l.completed) return false;
      const late = minutesLateOf(l.targetTime, l.actualTime);
      return late !== null && late <= 15;
    }).length;
    return { formed: logs.length >= FORMED_WINDOW_DAYS && onTime >= FORMED_MIN_DONE, onTime, total: logs.length };
  } catch {
    return { formed: false, onTime: 0, total: 0 };
  }
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
