// FASE DO HÁBITO, GRADUAÇÃO e a ESCADA DE AVISOS que diminui (v1.130).
//
// O que a pesquisa sustenta (síntese no app de hábitos, nov/2026):
//  - lembretes garantem a repetição, mas atrapalham a automaticidade e criam
//    dependência (Stawarz, Cox & Blandford 2015; Renfree et al. 2016), e o efeito
//    de uma notificação se desgasta em ~4 semanas (HeartSteps, Klasnja et al. 2019).
//    Então a coruja se RETIRA aos poucos conforme o hábito se forma;
//  - "formado" é automaticidade, não contagem de dias: leva meses e varia muito
//    (Lally et al. 2010: mediana 66 dias, 18–254). A graduação exige a força alta
//    (consistência) E as 4 perguntas do SRBAI (Gardner et al. 2012) altas.
//
// Fases (modo 'auto'):
//   aprendendo (força < 50%)  → aviso antes + na hora + pergunta + cobranças
//   firmando   (50–80%)       → na hora + pergunta + no máximo 2 cobranças
//   quase      (≥ 80%, ou SRBAI ≥ 5 com força ≥ 65%) → só o aviso na hora
//   formado    (graduado)     → silêncio; a cada 14 dias, as 4 perguntas

import { format } from 'date-fns';
import { getHabitState, getKV, setHabitState, setKV } from './database';
import { getMarksOf, getValuesOf, listSrbaiRows } from './habitDb';
import { computeStats, daysBetween, SRBAI_EVERY_DAYS, type ComputedStats } from './habitStrength';
import { nudgePhrase } from './nudgePhrases';
import type { HabitDef, HabitStage, HabitStats } from '../types/habits';

export const GRADUATE_STRENGTH = 0.9;
export const GRADUATE_SRBAI = 5.5;
export const GRADUATE_MIN_AGE = 21;
/** O SRBAI que conta para graduar tem de ser recente. */
export const GRADUATE_SRBAI_MAX_AGE = 21;
export const REGRESS_SRBAI = 4.5;
export const REGRESS_STRENGTH = 0.7;
/** Idade mínima para as primeiras 4 perguntas. */
const SRBAI_FIRST_AGE = 14;

export function stageOf(strength: number, srbai: number | null, formed: boolean): HabitStage {
  if (formed) return 'formado';
  if (strength >= 0.8 || (srbai !== null && srbai >= 5 && strength >= 0.65)) return 'quase';
  if (strength >= 0.5) return 'firmando';
  return 'aprendendo';
}

function srbaiDueOf(def: HabitDef, c: ComputedStats, today: string): boolean {
  if (def.archived || !def.enabled) return false;
  if (def.pausedUntil && def.pausedUntil >= today) return false;
  if (c.ageDays < SRBAI_FIRST_AGE) return false;
  if (!c.srbaiAt) return true;
  return daysBetween(c.srbaiAt, today) >= SRBAI_EVERY_DAYS;
}

/** Estatísticas completas (com fase) de um hábito, sem mudar nada. */
export async function statsFor(def: HabitDef, today = format(new Date(), 'yyyy-MM-dd')): Promise<HabitStats> {
  const [marks, values, srbai, state] = await Promise.all([
    getMarksOf(def.type),
    getValuesOf(def.type),
    listSrbaiRows(def.type),
    getHabitState(def.type),
  ]);
  const formed = state.state !== 'forming';
  const c = computeStats({ def, marks, values, srbai, formed, today });
  const { ageDays: _age, ...rest } = c;
  return { ...rest, stage: stageOf(c.strength, c.srbai, formed), srbaiDue: srbaiDueOf(def, c, today) };
}

// ——— comemorações pendentes (marcos, graduação, regressão) ———

export interface Celebration {
  id: string;
  type: string;
  kind: 'marco' | 'graduado' | 'regressao';
  n: number | null;
  text: string;
}

const CELEBRATIONS_KV = 'habit_celebrations_v1';

export async function readCelebrations(): Promise<Celebration[]> {
  try {
    const raw = await getKV(CELEBRATIONS_KV);
    const list = raw ? (JSON.parse(raw) as Celebration[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function pushCelebration(c: Celebration): Promise<void> {
  const list = await readCelebrations();
  if (list.some((x) => x.id === c.id)) return;
  list.push(c);
  await setKV(CELEBRATIONS_KV, JSON.stringify(list.slice(-10))).catch(() => {});
}

export async function dropCelebration(id: string): Promise<void> {
  const list = (await readCelebrations()).filter((x) => x.id !== id);
  await setKV(CELEBRATIONS_KV, JSON.stringify(list)).catch(() => {});
}

export interface HabitEvaluation {
  stats: HabitStats;
  justGraduated: boolean;
  justRegressed: boolean;
}

/**
 * Avalia o hábito hoje: gradua (força ≥ 90% + SRBAI recente ≥ 5,5 + 21 dias de
 * idade) ou rebaixa (formado com SRBAI < 4,5 ou força < 70%). Idempotente.
 */
export async function evaluateHabit(def: HabitDef, today = format(new Date(), 'yyyy-MM-dd'), name: string | null = null): Promise<HabitEvaluation> {
  const state = await getHabitState(def.type);
  let stats = await statsFor(def, today);
  let justGraduated = false;
  let justRegressed = false;

  if (!stats.formed) {
    const srbaiFresh = stats.srbaiAt !== null && daysBetween(stats.srbaiAt, today) <= GRADUATE_SRBAI_MAX_AGE;
    const age = daysBetween(def.createdDay, today);
    if (
      stats.strength >= GRADUATE_STRENGTH &&
      srbaiFresh &&
      (stats.srbai ?? 0) >= GRADUATE_SRBAI &&
      age >= GRADUATE_MIN_AGE
    ) {
      await setHabitState({ ...state, state: 'formed', formedAt: today, lastSampleAt: today, sampleMisses: 0 });
      justGraduated = true;
      await pushCelebration({
        id: `graduado:${def.type}:${today}`,
        type: def.type,
        kind: 'graduado',
        n: null,
        text: nudgePhrase('graduado', { task: def.title, name, day: today, key: def.type }),
      });
    }
  } else {
    // A regressão pelo SRBAI só vale para uma resposta DEPOIS da graduação.
    const srbaiLow = stats.srbai !== null && stats.srbaiAt !== null && stats.srbaiAt >= (state.formedAt ?? '') && stats.srbai < REGRESS_SRBAI;
    if (srbaiLow || stats.strength < REGRESS_STRENGTH) {
      const weeks = state.formedAt ? Math.max(1, Math.round(daysBetween(state.formedAt, today) / 7)) : 0;
      await setHabitState({ ...state, state: 'forming', formedAt: null, sampleMisses: 0, lastSampleAt: today });
      await setKV(`regression:${def.type}`, JSON.stringify({ date: today, weeks })).catch(() => {});
      justRegressed = true;
      await pushCelebration({
        id: `regressao:${def.type}:${today}`,
        type: def.type,
        kind: 'regressao',
        n: null,
        text: `“${def.title}” escorregou um pouco do automático. Sem drama: a coruja volta a lembrar por um tempo, até firmar de novo.`,
      });
    }
  }
  if (justGraduated || justRegressed) stats = await statsFor(def, today);
  return { stats, justGraduated, justRegressed };
}

// ——— a escada de avisos ———

export interface ReminderPlan {
  /** Aviso gentil 10 min antes. */
  pre: boolean;
  /** Aviso na hora. */
  anchor: boolean;
  /** Pergunta (+30 min) e cobranças. */
  ask: boolean;
  /** Teto de batidas da corrente (pergunta + cobranças + fechamento). */
  maxChain: number;
  /** Formado com as 4 perguntas pendentes: um aviso único no horário. */
  srbaiCheck: boolean;
}

const NONE: ReminderPlan = { pre: false, anchor: false, ask: false, maxChain: 0, srbaiCheck: false };

/** O que agendar hoje para este hábito. `maxInsist` é o teto global (Lembretes). */
export function reminderPlanOf(def: HabitDef, stats: HabitStats, maxInsist: number): ReminderPlan {
  if (!def.enabled || def.archived) return NONE;
  const full: ReminderPlan = { pre: true, anchor: true, ask: maxInsist > 0, maxChain: maxInsist, srbaiCheck: false };
  if (def.reminders === 'nenhum') return { ...NONE, srbaiCheck: stats.formed && stats.srbaiDue };
  if (def.reminders === 'completo') return full;
  if (def.kind === 'parar') {
    // Um aviso só, à noite: "como foi hoje?". Formado: silêncio (e as 4 perguntas).
    if (stats.formed) return { ...NONE, srbaiCheck: stats.srbaiDue };
    return { pre: false, anchor: true, ask: false, maxChain: 0, srbaiCheck: false };
  }
  if (def.reminders === 'hora') {
    return { pre: false, anchor: true, ask: false, maxChain: 0, srbaiCheck: stats.formed && stats.srbaiDue };
  }
  switch (stats.stage) {
    case 'aprendendo':
      return full;
    case 'firmando':
      return { pre: false, anchor: true, ask: maxInsist > 0, maxChain: Math.min(maxInsist, 3), srbaiCheck: false };
    case 'quase':
      return { pre: false, anchor: true, ask: false, maxChain: 0, srbaiCheck: false };
    case 'formado':
    default:
      return { ...NONE, srbaiCheck: stats.srbaiDue };
  }
}

/** Rótulo e explicação da fase, para as telas. */
export const STAGE_INFO: Record<HabitStage, { label: string; reminders: string }> = {
  aprendendo: { label: 'Aprendendo', reminders: 'A coruja lembra antes, na hora e pergunta depois.' },
  firmando: { label: 'Firmando', reminders: 'Lembra na hora e pergunta uma vez; menos cobranças.' },
  quase: { label: 'Quase automático', reminders: 'Só um aviso na hora, se você ainda não fez.' },
  formado: { label: 'Formado', reminders: 'Sem lembretes. A cada duas semanas, quatro perguntas para conferir.' },
};
