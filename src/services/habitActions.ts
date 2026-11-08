// HÁBITO COM AÇÃO NO APP (v1.130): o hábito "Respiração", "Ioga Nidra", "Zazen" ou
// "Leia para mim" se marca sozinho quando a pessoa termina a prática no próprio
// app. Registro sem atrito é metade do automonitoramento (Harkin et al. 2016).

import { format } from 'date-fns';
import { getDoneNudgeTypes } from './database';
import { logicalDay } from './habitEvents';
import { listHabitRows } from './habitDb';
import { isScheduledDay } from './habitStrength';
import { confirmNudge } from './nudges';
import type { HabitAction } from '../types/habits';

/**
 * Confirma os hábitos com esta ação que ainda não estão feitos no dia (hoje, ou
 * ontem se a prática atravessou a meia-noite). Nunca lança. Devolve os títulos.
 */
export async function confirmHabitsByAction(
  action: HabitAction,
  opts: { evidence: string; startedAt?: number; occurredAt?: number },
): Promise<string[]> {
  try {
    const started = opts.startedAt ?? Date.now();
    const date = format(new Date(started), 'yyyy-MM-dd');
    const day = logicalDay(date);
    if (day !== date) return [];
    const done = new Set(await getDoneNudgeTypes(day));
    const out: string[] = [];
    for (const h of await listHabitRows()) {
      if (h.action !== action || !h.enabled || h.archived) continue;
      if (done.has(h.type) || !isScheduledDay(h, day)) continue;
      await confirmNudge(h.type, { via: 'sensor', evidence: opts.evidence, occurredAt: opts.occurredAt, day });
      out.push(h.title);
    }
    return out;
  } catch (err) {
    console.warn('[habitActions] falhou:', err);
    return [];
  }
}
