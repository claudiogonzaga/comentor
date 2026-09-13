// Check-in da MANHÃ SEGUINTE. Quando a pessoa marca "Vou dormir", agendamos uma
// pergunta para ~8 h depois: "Você deitou 1h40 depois do horário. Como está se
// sentindo agora?" — dois botões rápidos (Bem / Mal) e um campo de texto.
//
// A resposta vai para daily_log (morning_feeling + notes) da NOITE em questão.
// É daí que o coach tira as citações do "eu passado": a pessoa que acordou mal
// falando com a pessoa que está prestes a dormir tarde de novo.
//
// Só existe check-in para noites que o app conhece (marcadas como dormidas). Se
// a pessoa nunca marca, não há noite a que atribuir a manhã — e tudo bem: o
// ciclo é sobre consequências que o app consegue ligar à causa.

import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';
import {
  ensureChannel,
  ensureNotificationCategories,
  MORNING_BAD_ACTION,
  MORNING_CATEGORY,
  MORNING_GOOD_ACTION,
  MORNING_TEXT_ACTION,
} from './notifications';
import { getLogsWithMorningFeedback, recordMorningCheckin } from './database';
import { minutesLateOf } from './habitFormation';
import { captureHealthDaily } from './health';
import type { DailyLog } from '../types';

export const MORNING_TYPE = 'morning-checkin';

/** Horas de sono presumidas entre "Vou dormir" e o check-in. */
const SLEEP_HOURS = 8;
/** Janela em que o check-in pode cair; fora dela é empurrado para dentro. */
const EARLIEST = { h: 6, m: 30 };
const LATEST = { h: 11, m: 30 };

export interface MorningData {
  type?: string;
  habitId?: number;
  logDate?: string;
  lateMinutes?: number;
}

export function formatLate(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export async function cancelMorningCheckins(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === MORNING_TYPE) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

function clampToWindow(d: Date): Date {
  const out = new Date(d);
  const minutes = out.getHours() * 60 + out.getMinutes();
  const lo = EARLIEST.h * 60 + EARLIEST.m;
  const hi = LATEST.h * 60 + LATEST.m;
  if (minutes < lo) out.setHours(EARLIEST.h, EARLIEST.m, 0, 0);
  else if (minutes > hi) {
    // Marcou "dormir" já de manhã/tarde: o check-in fica para a manhã seguinte.
    out.setDate(out.getDate() + 1);
    out.setHours(EARLIEST.h + 2, 0, 0, 0);
  }
  return out;
}

/**
 * Agenda o check-in da manhã seguinte à noite `logDate`, com o corpo já
 * personalizado pelo atraso — é o momento em que o app SABE o quanto a pessoa
 * passou do horário, então a pergunta pode ser específica.
 */
export async function scheduleMorningCheckin(
  habitId: number,
  logDate: string,
  lateMinutes: number,
): Promise<string | null> {
  try {
    const channelId = await ensureChannel();
    await ensureNotificationCategories();
    await cancelMorningCheckins();

    const fireAt = clampToWindow(new Date(Date.now() + SLEEP_HOURS * 3_600_000));
    const late = Math.max(0, Math.round(lateMinutes));
    const body =
      late > 15
        ? `Ontem você deitou ${formatLate(late)} depois do horário. Como está se sentindo agora?`
        : 'Ontem você deitou no horário. Como acordou hoje?';

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '🦉 Bom dia. Como você acordou?',
        body,
        data: { type: MORNING_TYPE, habitId, logDate, lateMinutes: late },
        categoryIdentifier: MORNING_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
        channelId,
      },
    });
  } catch (err) {
    console.warn('[morning] schedule failed:', err);
    return null;
  }
}

/**
 * Trata a resposta ao check-in. "Bem" e "Mal" viram uma nota aproximada
 * (8 e 3) para o histórico ser comparável; o texto livre vai para as notas.
 */
export async function handleMorningResponse(
  data: MorningData,
  action: string,
  userText: string | undefined,
): Promise<void> {
  if (typeof data.habitId !== 'number' || !data.logDate) return;
  let feeling: number | null = null;
  let text: string | null = null;
  if (action === MORNING_GOOD_ACTION) feeling = 8;
  else if (action === MORNING_BAD_ACTION) feeling = 3;
  else if (action === MORNING_TEXT_ACTION) text = (userText ?? '').trim() || null;
  else return; // toque no corpo: nada a registrar
  if (feeling === null && !text) return;
  try {
    await recordMorningCheckin(data.habitId, data.logDate, feeling, text);
  } catch (err) {
    console.warn('[morning] record failed:', err);
  }
  // Bom momento para o instantâneo de saúde: a noite já foi sincronizada.
  void captureHealthDaily().catch(() => {});
}

/** Data ISO (yyyy-MM-dd) de hoje — para os chamadores que precisam da noite "de hoje". */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ————————————— O eu-passado —————————————

function formatDateBR(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

/**
 * As piores manhãs depois de noites tarde, na voz da própria pessoa. Ordena
 * pelo atraso (maior primeiro) e depois pela nota (pior primeiro); no máximo
 * três, para o prompt não virar um diário. Usado pelo coach (chat) e pelo
 * gerador de cobranças — a mesma memória nos dois lugares.
 */
export function formatPastSelfQuotes(logs: DailyLog[]): string {
  const scored = logs
    .map((l) => ({ l, late: minutesLateOf(l.targetTime, l.actualTime) ?? 0 }))
    .filter((x) => (x.l.notes && x.l.notes.trim()) || x.l.morningFeeling !== null)
    .filter((x) => x.late > 15 || (x.l.morningFeeling !== null && x.l.morningFeeling <= 4))
    .sort((a, b) => b.late - a.late || (a.l.morningFeeling ?? 10) - (b.l.morningFeeling ?? 10))
    .slice(0, 3);
  if (scored.length === 0) return '';
  return scored
    .map(({ l, late }) => {
      const parts = [
        `- ${formatDateBR(l.date)}: deitou ${late > 0 ? `${formatLate(late)} depois do horário` : 'no horário'}`,
      ];
      if (l.morningFeeling !== null) parts.push(`acordou nota ${l.morningFeeling}/10`);
      if (l.notes?.trim()) parts.push(`escreveu: "${l.notes.replace(/\s+/g, ' ').trim().slice(0, 180)}"`);
      return parts.join('; ');
    })
    .join('\n');
}

/** Busca e formata as citações do eu-passado do hábito de sono. Nunca lança. */
export async function getPastSelfQuotesText(sleepHabitId: number): Promise<string> {
  try {
    return formatPastSelfQuotes(await getLogsWithMorningFeedback(sleepHabitId, 30));
  } catch {
    return '';
  }
}
