// HÁBITOS RIGOROSOS: no horário, o celular vibra em pulsos — vibra, para, vibra…
// — até a pessoa responder: Fiz, Mais tempo ou Não vou fazer.
//
// Quem insiste é o NATIVO (módulo SpokenNudges: alarme exato + serviço em
// primeiro plano + vibração), para seguir com a tela apagada e o app fechado.
// Daqui vão para lá:
//  - a lista dos hábitos rigorosos de cada fonte (horário, dias, título, frases,
//    dia já respondido, adiamento em curso) — a cada passada de scheduleAllNudges
//    e scheduleAllMedications;
//  - a janela de sono, em que não vibra;
//  - as respostas dadas no app (Home, outra notificação, voz, Mac): calam a
//    insistência na hora.
// As respostas dadas na notificação rigorosa fazem o caminho inverso: ficam numa
// fila no nativo e strictAnswers.ts as aplica (marca feito, adia, pula).
//
// A chave de cada hábito é a mesma de done:<dia>:<tarefa> na sincronização com
// o Mac: o tipo do nudge, ou "med:<id>".

import { Alert, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { getUserConfig } from './database';
import { deriveSleepPeriod, hhmmToMin, loadSleepQuiet } from './quietHours';
import { isExactAlarmAllowed, openExactAlarmSettings } from './spokenNudges';
import type { Tone } from '../types';

interface StrictNative {
  /** Ausentes em builds nativos anteriores (o JS pode chegar antes). */
  setStrictHabits?(source: string, json: string): Promise<void>;
  setStrictSleepWindows?(json: string): void;
  stopStrict?(key: string, day: string): void;
  snoozeStrict?(key: string, untilEpochMs: number): void;
  takeStrictAnswers?(): string;
  addListener?(event: 'onStrictAnswer', listener: () => void): { remove(): void };
}

let native: StrictNative | null = null;
try {
  if (Platform.OS === 'android') native = requireNativeModule<StrictNative>('SpokenNudges');
} catch {
  native = null; // Expo Go / web / build sem o módulo: recurso indisponível
}

/** Este build sabe insistir com vibração? */
export function strictAvailable(): boolean {
  return !!native?.setStrictHabits;
}

/**
 * Antes de LIGAR o modo rigoroso de um hábito: confere o que ele precisa para
 * vibrar na hora certa com o app fechado. false = este build não sabe insistir
 * (não liga). Sem "Alarmes e lembretes", liga mas avisa que pode atrasar.
 */
export function checkStrictPrereqs(): boolean {
  if (!strictAvailable()) {
    Alert.alert(
      'Atualize o app',
      'O modo rigoroso precisa da versão nova do aplicativo (instale o APK mais recente).',
    );
    return false;
  }
  if (!isExactAlarmAllowed()) {
    Alert.alert(
      'Permitir alarmes',
      'Para vibrar na hora certa com a tela apagada, permita “Alarmes e lembretes” para o app. Sem isso, o Android pode atrasar a insistência.',
      [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Abrir ajustes', onPress: () => openExactAlarmSettings() },
      ],
    );
  }
  return true;
}

export type StrictSource = 'nudge' | 'med';

/** Chave do hábito rigoroso de um remédio/hábito do usuário (a mesma do "feito hoje"). */
export function strictMedKey(medId: number): string {
  return `med:${medId}`;
}

/** Um hábito rigoroso como o agendamento o vê. */
export interface StrictHabitItem {
  /** Tipo do nudge ou "med:<id>". */
  key: string;
  /** O MESMO título da notificação comum: o nativo tira a duplicata da bandeja por ele. */
  title: string;
  /** Texto da primeira rodada (o do lembrete). */
  body: string;
  /** Nome do hábito, para as frases. */
  name: string;
  hour: number;
  minute: number;
  /** Dias ativos (bit d = dia d, 0 = domingo); 127 = todos. */
  days: number;
  /** Dia (yyyy-MM-dd) já respondido — feito, pulado ou dado como perdido. "" = pendente. */
  skipDay: string;
  /** Fim do "Me dê mais tempo" em curso (epoch ms); 0 = nenhum. */
  resumeAt: number;
}

/** Bitmask de dias a partir da lista 0–6 (vazia = todos). */
export function daysMask(days: number[] | null | undefined): number {
  if (!days || days.length === 0) return 127;
  return days.reduce((m, d) => (d >= 0 && d <= 6 ? m | (1 << d) : m), 0) || 127;
}

/**
 * As frases que se revezam a cada rodada de pulsos: curtas, firmes, gentis — no
 * tom escolhido para a Comentora. A primeira rodada mostra o próprio lembrete.
 */
export function strictLines(name: string, userName: string | null | undefined, tone: Tone): string[] {
  const n = `“${name}”`;
  const u = userName?.trim();
  // Com o nome: "Ana, ainda estou aqui."; sem: "Ainda estou aqui."
  const lead = (s: string) => (u ? `${u}, ${s}` : s.charAt(0).toUpperCase() + s.slice(1));
  const byTone: Record<Tone, string[]> = {
    gentle: [
      lead(`ainda estou aqui. ${n} cabe agora?`),
      `Um passo pequeno já conta. Que tal começar ${n}?`,
      `Sem pressa, mas sem esquecer: ${n}.`,
      `Fez, precisa de mais tempo ou hoje não? Qualquer resposta me acalma.`,
      `Daqui a pouco você vai gostar de ter feito ${n}.`,
    ],
    firm: [
      lead(`${n}, agora. Depois você me agradece.`),
      `Eu sigo vibrando até você responder.`,
      `Dois minutos para começar. Vai.`,
      `Fiz, mais tempo ou não vou fazer: escolha uma.`,
      `Você marcou ${n} como rigoroso por um bom motivo.`,
    ],
    brutal: [
      lead(`${n}. Agora.`),
      `Ignorar não é responder.`,
      `Eu não canso. Você decide quando isto para.`,
      `Desculpa não vibra. ${n} sim.`,
      `Levanta e faz ${n}.`,
    ],
  };
  return byTone[tone] ?? byTone.firm;
}

/**
 * Espelha no nativo a janela de sono em que a insistência não vibra: do horário
 * de dormir até as 6h (a regra das notificações e do feed — ver isSleepWindow em
 * aspis/bootstrap e NIGHT_END_HOUR em notifications.ts), mais o período de sono
 * da Comentora (horário de dormir + N horas), se ligado.
 */
async function mirrorSleepWindows(bedtime: string): Promise<void> {
  if (!native?.setStrictSleepWindows) return;
  const windows = [{ start: hhmmToMin(bedtime, 23 * 60), end: 6 * 60 }];
  try {
    const sleep = await loadSleepQuiet();
    if (sleep.enabled) {
      const p = deriveSleepPeriod(bedtime, sleep.hours);
      windows.push({ start: hhmmToMin(p.start), end: hhmmToMin(p.end) });
    }
  } catch {
    /* fica só a janela do horário de dormir */
  }
  try {
    native.setStrictSleepWindows(JSON.stringify(windows));
  } catch {
    /* best-effort: fica o último espelho */
  }
}

/**
 * Entrega ao nativo a lista dos hábitos rigorosos de uma fonte. Hábito que saiu
 * da lista (desligado, excluído, deixou de ser rigoroso) para de insistir na
 * hora. Modo silencioso (volume zerado na Home): "sem som nem vibração" vale
 * aqui também — a lista vai vazia e a insistência fica com as notificações comuns.
 */
export async function syncStrictHabits(source: StrictSource, items: StrictHabitItem[]): Promise<void> {
  if (!native?.setStrictHabits) return;
  let tone: Tone = 'firm';
  let userName: string | null = null;
  let silent = false;
  let bedtime = '23:00';
  try {
    const c = await getUserConfig();
    tone = c.tone ?? 'firm';
    userName = c.name;
    silent = !!c.silentMode;
    bedtime = c.bedtime || '23:00';
  } catch {
    /* padrões */
  }
  await mirrorSleepWindows(bedtime);
  const list = silent
    ? []
    : items.map((it) => ({
        key: it.key,
        title: it.title,
        body: it.body,
        lines: strictLines(it.name, userName, tone),
        hour: it.hour,
        minute: it.minute,
        days: it.days,
        skipDay: it.skipDay,
        resumeAt: it.resumeAt,
      }));
  try {
    await native.setStrictHabits(source, JSON.stringify(list));
  } catch (err) {
    console.warn('[strict] sincronização falhou:', err);
  }
}

/**
 * O hábito foi respondido no app (feito ou "não vou fazer") para o dia `day`:
 * para de vibrar já. Chamado por confirm/skip de nudges.ts e medications.ts —
 * que cobrem Home, outra notificação, voz, fechamento do dia e o Mac.
 */
export function stopStrictInsistence(key: string, day: string): void {
  try {
    native?.stopStrict?.(key, day);
  } catch {
    /* best-effort: a próxima sincronização também resolve */
  }
}

/** "Me dê mais tempo" num hábito rigoroso: para agora e volta a insistir em `untilMs`. */
export function snoozeStrictInsistence(key: string, untilMs: number): void {
  try {
    native?.snoozeStrict?.(key, untilMs);
  } catch {
    /* best-effort */
  }
}

/** Uma resposta tocada na notificação rigorosa, à espera de ser aplicada. */
export interface StrictAnswer {
  key: string;
  action: 'done' | 'skip' | 'snooze';
  /** Quando a pessoa tocou (epoch ms). */
  at: number;
  /** Dia (yyyy-MM-dd) do lembrete respondido. */
  day: string;
  /** "Mais tempo": até quando (epoch ms). */
  until?: number;
  /** "Não vou fazer": o motivo escolhido ou escrito. */
  reason?: string;
}

/** Entrega e esvazia a fila de respostas do nativo. */
export function takeStrictAnswers(): StrictAnswer[] {
  if (!native?.takeStrictAnswers) return [];
  try {
    const arr = JSON.parse(native.takeStrictAnswers() || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (a): a is StrictAnswer =>
        !!a &&
        typeof a.key === 'string' &&
        (a.action === 'done' || a.action === 'skip' || a.action === 'snooze') &&
        typeof a.at === 'number' &&
        typeof a.day === 'string',
    );
  } catch {
    return [];
  }
}

/** Avisa quando o nativo põe resposta na fila (com o JS vivo). Devolve o "desligar". */
export function onStrictAnswer(listener: () => void): () => void {
  try {
    const sub = native?.addListener?.('onStrictAnswer', listener);
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}
