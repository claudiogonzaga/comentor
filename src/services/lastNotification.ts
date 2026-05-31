import * as Notifications from 'expo-notifications';
import { getKV, setKV } from './database';

/**
 * Persiste a ÚLTIMA notificação que o app exibiu, para que a tela inicial
 * mostre exatamente o mesmo conteúdo do último lembrete recebido (em vez de
 * um texto fixo). Guardado em `app_kv` como JSON.
 */

const KEY = 'last_notification';

export interface LastNotification {
  title: string;
  body: string;
  /** ISO timestamp de quando foi recebida/exibida. */
  at: string;
  /** data.type da notificação (ex.: 'nudge:bluelight', 'med:3', 'sleep-reminder'). */
  type?: string;
}

/**
 * Extrai título/corpo de uma notificação recebida e persiste como "última".
 * Best-effort — nunca lança (a falha não deve quebrar o listener).
 */
export async function saveLastNotification(
  notification: Notifications.Notification,
): Promise<void> {
  try {
    const content = notification.request.content;
    const title = (content.title ?? '').trim();
    const body = (content.body ?? '').trim();
    if (!title && !body) return;
    const data = content.data as { type?: string } | undefined;
    const payload: LastNotification = {
      title,
      body,
      at: new Date().toISOString(),
      type: typeof data?.type === 'string' ? data.type : undefined,
    };
    await setKV(KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('failed to save last notification:', err);
  }
}

/** Normaliza o `date` de uma notificação (alguns devices entregam em s, outros em ms). */
function normalizeNotifDate(date: number | undefined): number {
  if (!date || !Number.isFinite(date)) return Date.now();
  return date < 1e12 ? date * 1000 : date;
}

/**
 * O listener de "recebida" só dispara com o app em primeiro plano. Os lembretes
 * noturnos chegam com o app fechado, então ao abrir a Home varremos a bandeja
 * (notificações ainda visíveis) e guardamos a mais recente — se for mais nova
 * que a registrada. Best-effort.
 */
export async function syncLastNotificationFromTray(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    if (!presented.length) return;

    let newest = presented[0];
    for (const p of presented) {
      if (normalizeNotifDate(p.date) > normalizeNotifDate(newest.date)) newest = p;
    }

    const content = newest.request.content;
    const title = (content.title ?? '').trim();
    const body = (content.body ?? '').trim();
    if (!title && !body) return;

    const newestMs = normalizeNotifDate(newest.date);
    const existing = await getLastNotification();
    if (existing) {
      const existingMs = new Date(existing.at).getTime();
      if (Number.isFinite(existingMs) && existingMs >= newestMs) return;
    }

    const data = content.data as { type?: string } | undefined;
    const payload: LastNotification = {
      title,
      body,
      at: new Date(newestMs).toISOString(),
      type: typeof data?.type === 'string' ? data.type : undefined,
    };
    await setKV(KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('failed to sync last notification from tray:', err);
  }
}

/** Lê a última notificação exibida, ou null se nenhuma foi registrada ainda. */
export async function getLastNotification(): Promise<LastNotification | null> {
  try {
    const raw = await getKV(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastNotification>;
    if (!parsed || (!parsed.title && !parsed.body)) return null;
    return {
      title: parsed.title ?? '',
      body: parsed.body ?? '',
      at: parsed.at ?? new Date().toISOString(),
      type: parsed.type,
    };
  } catch (err) {
    console.warn('failed to read last notification:', err);
    return null;
  }
}
