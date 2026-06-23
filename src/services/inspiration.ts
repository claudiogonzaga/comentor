import * as Notifications from 'expo-notifications';
import { getUserConfig, listActiveInspirationCards } from './database';
import { ensureChannel, gatedSchedule } from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { syncSpokenInspirations } from './spokenNudges';
import { COMENTORA_MESSAGES } from '../constants/inspirationDefaults';
import type { InspirationCard } from '../types';

/**
 * Modo "inspiração": quando ligado, a Comentora dispara um alerta a cada hora
 * cheia dentro de uma janela diurna, com mensagens curtas de otimismo,
 * persistência e inspiração. São lembretes locais DIÁRIOS (um por hora), então
 * funcionam mesmo com o app fechado, e se repetem todo dia até o usuário
 * desligar o modo.
 *
 * Por que uma janela diurna e não 24h: alertas de madrugada brigariam com o
 * propósito do app (ajudar a dormir). A janela vai de INSPIRATION_START_HOUR
 * até INSPIRATION_END_HOUR (inclusive).
 */
const INSPIRATION_START_HOUR = 8;
const INSPIRATION_END_HOUR = 21;

/** data.type das notificações deste modo — usado para cancelar só elas. */
const INSPIRATION_TYPE = 'inspiration';

interface InspirationMessage {
  title: string;
  body: string;
  /** Texto lido em voz alta (sem aspas decorativas). */
  speak: string;
}

/**
 * Converte um card da biblioteca em mensagem de notificação. Citação ganha
 * título "✨ Inspiração"; fato histórico, "📜 Aconteceu um dia". O autor entra
 * como assinatura quando ainda não estiver embutido no texto.
 */
function cardToMessage(c: InspirationCard): InspirationMessage {
  const text = c.text.trim();
  const hasAuthorInText =
    !c.author || text.toLowerCase().includes(c.author.trim().toLowerCase());
  const body = c.author && !hasAuthorInText ? `${text}\n— ${c.author}` : text;
  // a fala remove aspas tipográficas das pontas (a voz não "fala" aspas)
  const speak = body.replace(/^[“"']+/, '').replace(/[”"']+$/, '');
  return {
    title: c.type === 'fact' ? '📜 Aconteceu um dia' : '✨ Inspiração',
    body,
    speak,
  };
}

/**
 * Mensagens padrão da Comentora (fallback se a biblioteca estiver vazia — ex.:
 * todos os packs desligados). Mantém o app sempre com algo a dizer.
 */
const FALLBACK_MESSAGES: InspirationMessage[] = COMENTORA_MESSAGES.map((m) => ({
  title: m.title,
  body: m.body,
  speak: m.body,
}));

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Cancela apenas as notificações do modo inspiração. */
export async function cancelInspirationNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === INSPIRATION_TYPE) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Reagenda o modo inspiração. Se o modo estiver desligado, apenas cancela.
 * Se ligado, agenda um alerta DIÁRIO em cada hora cheia da janela diurna,
 * cada um com uma mensagem distinta (embaralhada). Idempotente — seguro
 * chamar a cada save / ao abrir o app.
 */
export async function scheduleInspirationNotifications(): Promise<void> {
  await cancelInspirationNotifications();

  let enabled = false;
  let sound: string = 'default';
  let perDay = 6;
  try {
    const config = await getUserConfig();
    enabled = !!config.inspirationModeEnabled;
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
    perDay = config.inspirationPerDay ?? 6;
  } catch {
    /* sem config legível → trata como desligado */
  }
  if (!enabled) {
    // limpa também os alarmes FALADOS de inspiração (se houver)
    void syncSpokenInspirations([]).catch(() => {});
    return;
  }

  const channelId = await ensureChannel();
  // Monta a fila a partir da BIBLIOTECA (packs habilitados, cards não excluídos);
  // se estiver vazia, cai nas frases padrão da Comentora.
  let pool: InspirationMessage[];
  try {
    const cards = await listActiveInspirationCards();
    pool = cards.length ? cards.map(cardToMessage) : FALLBACK_MESSAGES;
  } catch {
    pool = FALLBACK_MESSAGES;
  }
  const messages = shuffled(pool);
  // coletados para, ao final, agendar as versões FALADAS (se o recurso estiver on)
  const spokenItems: { text: string; hour: number; minute: number }[] = [];

  // Espalha `perDay` mensagens na janela diurna [START, END]. Antes era uma
  // por hora fixa; agora o usuário escolhe quantas quer.
  const n = Math.max(1, Math.min(14, Math.round(perDay)));
  const startMin = INSPIRATION_START_HOUR * 60;
  const endMin = INSPIRATION_END_HOUR * 60;
  const span = endMin - startMin;

  for (let i = 0; i < n; i++) {
    const t =
      n === 1 ? Math.round(startMin + span / 2) : Math.round(startMin + (span * i) / (n - 1));
    const hour = Math.floor(t / 60);
    const minute = t % 60;
    const msg = messages[i % messages.length];
    // a versão falada lê o texto limpo (sem aspas; o título é decorativo)
    spokenItems.push({ text: msg.speak, hour, minute });
    try {
      await gatedSchedule({
        content: {
          title: msg.title,
          body: msg.body,
          data: { type: INSPIRATION_TYPE, hour },
          sound,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId,
        },
      });
    } catch (err) {
      console.warn(`failed to schedule inspiration alert @${hour}:${minute}:`, err);
    }
  }

  // Agenda as versões FALADAS em background (pré-renderiza a voz Gemini e arma
  // os alarmes nativos). Best-effort e fora do caminho crítico do agendamento.
  void syncSpokenInspirations(spokenItems).catch(() => {});
}
