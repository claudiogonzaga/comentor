// PRÁTICAS FEITAS NO APP (respiração, Ioga Nidra) como EVIDÊNCIA.
//
// Até aqui a Comentora cobrava "fez a respiração?" mesmo depois de a pessoa
// fazer os 16 minutos DENTRO do próprio app. Agora cada sessão é registrada em
// mindful_sessions e, se foi de verdade (terminou, ou durou o bastante),
// confirma sozinha o hábito correspondente — via 'sensor', com a evidência
// anotada, para a exportação separar "a pessoa disse" de "o app viu".

import { Platform, ToastAndroid } from 'react-native';
import { format } from 'date-fns';
import { addMindfulSession, getDoneNudgeTypes, listNudges } from './database';
import { confirmNudge } from './nudges';

export type MindfulKind = 'breathing' | 'nidra';

const KIND_LABEL: Record<MindfulKind, string> = {
  breathing: 'Respiração',
  nidra: 'Ioga Nidra',
};

/** Hábito que esta prática cumpre: o nudge 'breathing' ou um título que fale dela. */
function matches(kind: MindfulKind, n: { type: string; title: string }): boolean {
  const title = n.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (kind === 'breathing') return n.type === 'breathing' || /respira/.test(title);
  return /nidra|medita/.test(title);
}

/**
 * Valeu como prática? Terminou sozinha (fim do áudio/tempo) OU durou pelo
 * menos 80% do previsto — e nunca menos de 5 min (abrir e fechar não conta).
 */
function qualifies(minutes: number, plannedMinutes: number | null, completed: boolean): boolean {
  if (minutes < 1) return false;
  if (completed) return true;
  const floor = Math.max(5, (plannedMinutes ?? 0) * 0.8);
  return minutes >= floor;
}

function fmtMin(minutes: number): string {
  return `${Math.round(minutes)} min`;
}

/**
 * Registra uma sessão e, se ela valeu, confirma os hábitos correspondentes que
 * ainda não estão feitos hoje. Nunca lança. Devolve os títulos confirmados.
 */
export async function recordMindfulSession(opts: {
  kind: MindfulKind;
  startedAt: number;
  endedAt: number;
  /** Minutos efetivamente praticados (sem as pausas); padrão: fim − início. */
  playedMinutes?: number;
  plannedMinutes: number | null;
  completed: boolean;
}): Promise<string[]> {
  try {
    const minutes =
      opts.playedMinutes ?? Math.max(0, (opts.endedAt - opts.startedAt) / 60_000);
    if (minutes < 1) return []; // toque acidental: nem registra
    const date = format(new Date(opts.startedAt), 'yyyy-MM-dd');
    await addMindfulSession({
      kind: opts.kind,
      date,
      startedAt: new Date(opts.startedAt).toISOString(),
      endedAt: new Date(opts.endedAt).toISOString(),
      minutes: Math.round(minutes * 10) / 10,
      plannedMinutes: opts.plannedMinutes,
      completed: opts.completed,
    });
    if (!qualifies(minutes, opts.plannedMinutes, opts.completed)) return [];

    // Só sessões que COMEÇARAM hoje confirmam: uma que atravessou a meia-noite
    // pertence a ontem (registrada, mas não fecha o hábito de hoje).
    const today = format(new Date(), 'yyyy-MM-dd');
    if (date !== today) return [];
    const done = new Set(await getDoneNudgeTypes(today));
    const evidence = `${KIND_LABEL[opts.kind]} no app · ${fmtMin(minutes)}${opts.completed ? ' (completa)' : ''}`;
    const confirmed: string[] = [];
    for (const n of await listNudges()) {
      if (!n.enabled || done.has(n.type) || !matches(opts.kind, n)) continue;
      await confirmNudge(n.type, { via: 'sensor', evidence, occurredAt: opts.endedAt });
      confirmed.push(n.title);
    }
    if (confirmed.length && Platform.OS === 'android') {
      ToastAndroid.show(`✓ ${confirmed.join(', ')} — marcado como feito`, ToastAndroid.LONG);
    }
    return confirmed;
  } catch (err) {
    console.warn('[mindfulness] falhou:', err);
    return [];
  }
}
