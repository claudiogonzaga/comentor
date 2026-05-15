// Notificações de conscientização sobre o sono.
//
// Ao longo do dia o app dispara pequenos "nudges" informativos — citações da
// base SLEEP_AWARENESS_CARDS — lembrando o usuário da importância do sono.
// São 4 por dia em horários aleatórios: 1 de manhã, 1 de tarde e 2 à noite
// (estas se aproximam da hora de dormir). O card de cada notificação também
// é sorteado.
//
// Como notificações DATE disparam uma única vez, reagenda-se uma janela de
// alguns dias a cada abertura do app. Para que reabrir o app não gere
// notificações duplicadas, o sorteio é determinístico por dia (semente =
// a data), então cancelar e reagendar o mesmo dia produz os mesmos horários.

import * as Notifications from 'expo-notifications';
import { getUserConfig } from './database';
import { ensureChannel } from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { SLEEP_AWARENESS_CARDS } from '../constants/sleepAwarenessCards';

const AWARENESS_TYPE = 'awareness';
const DAYS_AHEAD = 3;

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
 * Cancela e reagenda as notificações de conscientização para os próximos
 * dias. Se a opção estiver desligada, apenas cancela. Idempotente.
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

    // Manhã e tarde.
    const morning = randInt(rng, 8 * 60, 11 * 60);
    const afternoon = randInt(rng, 13 * 60, 17 * 60);

    // Noite: dois lembretes que se aproximam da hora de dormir.
    const evEnd = bt - 20;
    let evStart = Math.max(18 * 60, bt - 240);
    if (evStart > evEnd - 60) evStart = Math.max(17 * 60, evEnd - 120);
    const evMid = Math.floor((evStart + evEnd) / 2);
    const evening1 = randInt(rng, evStart, evMid);
    const evening2 = randInt(rng, evMid, evEnd);

    const slots = [morning, afternoon, evening1, evening2];
    for (const slotMin of slots) {
      const fireAt = midnight.getTime() + slotMin * 60_000;
      // Card e título sorteados sempre (mantém o RNG sincronizado entre
      // reagendamentos, mesmo quando o horário já passou).
      const card = pick(rng, SLEEP_AWARENESS_CARDS);
      const title = pick(rng, TITLES);
      if (fireAt <= now + 60_000) continue; // horário já passou hoje

      try {
        await Notifications.scheduleNotificationAsync({
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
