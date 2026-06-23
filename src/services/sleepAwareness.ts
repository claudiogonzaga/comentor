// Notificações de conscientização sobre o sono — os "lembretes da Comentora".
//
// Ao longo do dia o app dispara pequenos lembretes — citações da base
// SLEEP_AWARENESS_CARDS. Quantos por dia é configurável
// (config.notificationsPerDay); a densidade DOBRA depois do pôr do sol
// (~18h), que é quando preparar o sono mais importa.
//
// Como notificações DATE disparam uma única vez, reagenda-se uma janela de
// alguns dias a cada abertura do app. O sorteio é determinístico por dia
// (semente = a data), então reabrir o app não gera notificações duplicadas.

import * as Notifications from 'expo-notifications';
import { getUserConfig } from './database';
import { ensureChannel, gatedSchedule } from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { SLEEP_AWARENESS_CARDS } from '../constants/sleepAwarenessCards';

const AWARENESS_TYPE = 'awareness';
const DAYS_AHEAD = 3;

/** Início do dia ativo e pôr do sol aproximado (o app não usa geolocalização). */
const DAY_START = 8 * 60;
const SUNSET = 18 * 60;

const MIN_PER_DAY = 1;
const MAX_PER_DAY = 12;

const TITLES = [
  '🦉 Sono é saúde',
  '🦉 Vale lembrar',
  '🦉 Ciência do sono',
  '🦉 Por que dormir importa',
  '🦉 Uma pausa pra pensar no sono',
];

// PRNG determinístico (mulberry32) — mesma semente, mesma sequência.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Minutos desde a meia-noite; trata horários de dormir após 00:00. */
function bedtimeMinutes(bedtime: string): number {
  const [h, m] = bedtime.split(':').map((n) => parseInt(n, 10));
  let mins = (Number.isFinite(h) ? h : 23) * 60 + (Number.isFinite(m) ? m : 0);
  if ((Number.isFinite(h) ? h : 23) < 6) mins += 24 * 60;
  return mins;
}

function dayMidnight(offsetDays: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

/** Sorteia `count` horários espalhados em [start,end], um por sub-intervalo. */
function spread(
  rng: () => number,
  start: number,
  end: number,
  count: number,
): number[] {
  if (count <= 0 || end <= start) return [];
  const step = (end - start) / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = start + i * step;
    out.push(randInt(rng, Math.round(a), Math.round(a + step)));
  }
  return out;
}

/**
 * Distribui `total` lembretes de um dia entre o período diurno e o noturno,
 * com a noite (após o pôr do sol) recebendo o DOBRO da densidade por hora.
 */
function daySlots(rng: () => number, total: number, bedtime: number): number[] {
  const windowEnd = bedtime - 20; // último lembrete 20 min antes de dormir
  if (windowEnd > DAY_START) {
    const dayEnd = Math.min(SUNSET, windowEnd);
    const eveStart = Math.max(SUNSET, DAY_START);
    const dayHours = Math.max(0, dayEnd - DAY_START) / 60;
    const eveHours = Math.max(0, windowEnd - eveStart) / 60;
    const weighted = dayHours + 2 * eveHours; // noite vale o dobro
    if (weighted > 0) {
      let nEve = Math.round((total * 2 * eveHours) / weighted);
      nEve = Math.min(total, Math.max(0, nEve));
      return [
        ...spread(rng, DAY_START, dayEnd, total - nEve),
        ...spread(rng, eveStart, windowEnd, nEve),
      ];
    }
  }
  // Janela inválida (hora de dormir muito cedo): concentra perto da noite.
  const start = Math.max(DAY_START, windowEnd - 180);
  return spread(rng, start, Math.max(start + 30, windowEnd), total);
}

export async function cancelSleepAwarenessNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === AWARENESS_TYPE) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Cancela e reagenda os lembretes da Comentora para os próximos dias.
 * Se a opção estiver desligada, apenas cancela. Idempotente.
 */
export async function scheduleSleepAwarenessNotifications(): Promise<void> {
  await cancelSleepAwarenessNotifications();

  let config;
  try {
    config = await getUserConfig();
  } catch {
    return;
  }
  if (!config.sleepAwarenessEnabled) return;
  if (SLEEP_AWARENESS_CARDS.length === 0) return;

  const perDay = Math.min(
    MAX_PER_DAY,
    Math.max(MIN_PER_DAY, Math.round(config.notificationsPerDay ?? 4)),
  );

  const channelId = await ensureChannel();
  const sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
  const now = Date.now();
  const bt = bedtimeMinutes(config.bedtime);

  for (let day = 0; day < DAYS_AHEAD; day++) {
    const midnight = dayMidnight(day);
    const seed =
      midnight.getFullYear() * 10000 +
      (midnight.getMonth() + 1) * 100 +
      midnight.getDate();
    const rng = makeRng(seed);

    const slots = daySlots(rng, perDay, bt);
    for (const slotMin of slots) {
      const fireAt = midnight.getTime() + slotMin * 60_000;
      // Card e título sorteados sempre (mantém o RNG sincronizado entre
      // reagendamentos, mesmo quando o horário já passou).
      const card = pick(rng, SLEEP_AWARENESS_CARDS);
      const title = pick(rng, TITLES);
      if (fireAt <= now + 60_000) continue; // horário já passou

      try {
        await gatedSchedule({
          content: {
            title,
            body: card.text,
            data: { type: AWARENESS_TYPE, author: card.author },
            sound,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(fireAt),
            channelId,
          },
        });
      } catch (err) {
        console.warn('failed to schedule awareness notification:', err);
      }
    }
  }
}
