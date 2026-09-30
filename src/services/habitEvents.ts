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

/**
 * Por onde veio a resposta. 'auto' = a corrente venceu sem resposta (registrado
 * pela própria coruja); 'sensor' = confirmação AUTOMÁTICA por evidência (treino
 * gravado no relógio, respiração/Ioga Nidra feita no app). São coisas opostas e
 * a exportação as separa.
 */
export type ConfirmVia = 'notification' | 'home' | 'voice' | 'review' | 'auto' | 'sensor';

export interface ConfirmMeta {
  via?: ConfirmVia;
  /** k-ésima cobrança que a pessoa respondeu (undefined = âncora / fora de cobrança). */
  k?: number;
  technique?: string;
  reason?: string | null;
  /** Confirmação automática: a evidência ("relógio · Health Sync · 42 min"). */
  evidence?: string | null;
  /**
   * Quando o comportamento ACONTECEU (epoch ms), se for diferente de agora —
   * ex.: o fim do treino gravado no relógio, lido horas depois. A latência é
   * calculada a partir daqui, não do momento em que o app percebeu.
   */
  occurredAt?: number;
}

function minutesSince(hhmm: string, occurredAt: number, via: ConfirmVia | undefined): number | null {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const at = new Date(occurredAt);
  at.setHours(h, m, 0, 0);
  // NEGATIVO = fez ANTES do horário programado (ex.: marcou pela Home de manhã
  // um hábito das 18h). Antes isso era zerado — e era justamente o sinal mais
  // útil de automaticidade: o hábito acontecendo sem a coruja precisar chamar.
  let diff = Math.round((occurredAt - at.getTime()) / 60_000);
  // Resposta a uma notificação da corrente de ONTEM depois da meia-noite (ex.:
  // hábito das 22h respondido à 00:30): o horário de referência é o de ontem.
  // Pela notificação, nunca se responde antes de ela tocar.
  if ((via === 'notification' || via === 'voice') && diff < -12 * 60) diff += 24 * 60;
  return diff;
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
      latencyMin: scheduledHHMM ? minutesSince(scheduledHHMM, meta.occurredAt ?? Date.now(), meta.via) : null,
      reason: meta.reason?.trim() || null,
      evidence: meta.evidence?.trim() || null,
    });
  } catch (err) {
    console.warn('[habitEvents] falhou:', err);
  }
}
