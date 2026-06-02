import * as Notifications from 'expo-notifications';
import { getUserConfig } from './database';
import { ensureChannel } from './notifications';

/**
 * Nudge de "trabalho sentado": durante a janela de expediente que a pessoa
 * marca (dias + horário de início/fim), a Comentora lembra de levantar e mover
 * o corpo a cada `sedentaryIntervalMin` minutos. Implementado com gatilhos
 * WEEKLY do expo-notifications (um por dia × horário), espelhando a abordagem
 * dos medicamentos.
 */

const SEDENTARY_TYPE = 'sedentary';
/** Teto de segurança para não estourar o limite de notificações pendentes. */
const MAX_SEDENTARY = 140;

const MOVE_MESSAGES = [
  'Levanta um pouco. Estica as pernas, rola os ombros, dá uns passos.',
  'Pausa de movimento: fique de pé 1 minuto. Seu corpo agradece.',
  'Hora de mexer o corpo. Levanta, respira e caminha um pouco.',
  'Sentou demais? Levanta, alonga e volta com mais energia.',
];

/** Horários (h,m) de `start`+intervalo até `end`. O primeiro é após 1 intervalo. */
function slotsBetween(
  start: string,
  end: string,
  intervalMin: number,
): { h: number; m: number }[] {
  const [sh, sm] = start.split(':').map((n) => parseInt(n, 10));
  const [eh, em] = end.split(':').map((n) => parseInt(n, 10));
  if (![sh, sm, eh, em].every(Number.isFinite)) return [];
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const step = Math.max(30, intervalMin);
  const slots: { h: number; m: number }[] = [];
  for (let t = startMin + step; t <= endMin; t += step) {
    slots.push({ h: Math.floor(t / 60) % 24, m: t % 60 });
  }
  return slots;
}

/** Cancela todos os lembretes de "trabalho sentado" agendados. */
export async function cancelSedentaryNudges(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === SEDENTARY_TYPE) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Reagenda os lembretes de "trabalho sentado" a partir da config. Idempotente:
 * cancela os antigos e recria. Sem efeito (apenas cancela) se estiver desligado.
 */
export async function scheduleSedentaryNudges(): Promise<void> {
  await cancelSedentaryNudges();
  let config;
  try {
    config = await getUserConfig();
  } catch {
    return;
  }
  if (!config.sedentaryEnabled) return;

  const slots = slotsBetween(
    config.sedentaryStart,
    config.sedentaryEnd,
    config.sedentaryIntervalMin,
  );
  if (slots.length === 0) return;
  const days = config.sedentaryDays.length ? config.sedentaryDays : [1, 2, 3, 4, 5];

  const channelId = await ensureChannel(config.owlSpecies);
  let count = 0;
  let msgIdx = 0;
  for (const dow of days) {
    for (const slot of slots) {
      if (count >= MAX_SEDENTARY) return;
      const body = MOVE_MESSAGES[msgIdx % MOVE_MESSAGES.length];
      msgIdx++;
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Hora de levantar',
            body,
            data: { type: SEDENTARY_TYPE },
            sound: 'default',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: dow + 1, // expo: 1=domingo … 7=sábado
            hour: slot.h,
            minute: slot.m,
            channelId,
          },
        });
        count++;
      } catch (err) {
        console.warn('failed to schedule sedentary nudge:', err);
      }
    }
  }
}
