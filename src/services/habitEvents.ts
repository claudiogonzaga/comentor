// EVENTOS DE HÁBITO: o histórico do COMO.
//
// nudge_completions guarda o estado do dia (feito / :skip / :missed). Isto aqui
// guarda cada resposta com metadados: por onde veio (notificação, Home, voz,
// fechamento do dia, automático), em qual cobrança (k), com qual técnica, com
// quanto atraso em relação ao horário e, se não fez, o motivo.
//
// É a matéria-prima da análise externa: "as cobranças 1 e 2 resolvem 80% dos
// casos", "a técnica eu-futuro converte de manhã e não à noite", "não fiz por
// falta de tempo nas terças". Sem isto, a exportação só diria feito/não feito.

import { format } from 'date-fns';
import { addHabitEvent, type HabitEventStatus } from './database';

export type ConfirmVia = 'notification' | 'home' | 'voice' | 'review' | 'auto';

export interface ConfirmMeta {
  via?: ConfirmVia;
  /** k-ésima cobrança que a pessoa respondeu (undefined = âncora / fora de cobrança). */
  k?: number;
  technique?: string;
  reason?: string | null;
}

function minutesSince(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const at = new Date();
  at.setHours(h, m, 0, 0);
  const diff = Math.round((Date.now() - at.getTime()) / 60_000);
  // Respondeu antes do horário (ex.: pela Home de manhã): atraso zero.
  return diff < 0 ? 0 : diff;
}

/**
 * Registra uma resposta. Nunca lança — é telemetria, não fluxo principal.
 * `scheduledHHMM` é o horário programado do item, para calcular o atraso.
 */
export async function recordHabitEvent(
  key: string,
  status: HabitEventStatus,
  meta: ConfirmMeta = {},
  scheduledHHMM?: string | null,
): Promise<void> {
  try {
    await addHabitEvent({
      key,
      date: format(new Date(), 'yyyy-MM-dd'),
      status,
      via: meta.via ?? null,
      k: meta.k ?? null,
      technique: meta.technique ?? null,
      latencyMin: scheduledHHMM ? minutesSince(scheduledHHMM) : null,
      reason: meta.reason?.trim() || null,
    });
  } catch (err) {
    console.warn('[habitEvents] falhou:', err);
  }
}
