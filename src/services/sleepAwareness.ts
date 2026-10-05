// ANTIGOS "lembretes do Askeo" sobre o sono — agora INSPIRAÇÃO.
//
// Eram citações e fatos da ciência do sono, mas chegavam como "lembretes" (type
// 'awareness'), separados do modo inspiração. Lembrete é algo para FAZER (hábito,
// remédio, tarefa); citação e fato histórico é inspiração. Aquele conteúdo agora é
// o baralho embutido "Ciência do sono" da biblioteca de inspiração (database.ts) e
// sai pelo modo inspiração, com 👍/👎, voz e card na Home.
//
// Este módulo ficou só para (1) cancelar o que a versão antiga já tinha agendado e
// (2) migrar a configuração de quem usava os lembretes antigos.

import * as Notifications from 'expo-notifications';
import { getKV, getUserConfig, setKV, updateUserConfig } from './database';

const AWARENESS_TYPE = 'awareness';
const MIGRATED_KEY = 'awareness_merged_into_inspiration_v1';

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
 * Não agenda mais nada: só remove as notificações 'awareness' que a versão antiga
 * deixou programadas. Mantido com o mesmo nome para os chamadores existentes.
 */
export async function scheduleSleepAwarenessNotifications(): Promise<void> {
  await cancelSleepAwarenessNotifications().catch(() => {});
}

/**
 * Uma vez: quem recebia os lembretes de sono passa a receber o equivalente pelo
 * modo inspiração (liga o modo e soma as frases por dia, no máximo 14). Chamar
 * ANTES de ler a configuração no boot. Devolve true se mudou algo.
 */
export async function migrateAwarenessToInspiration(): Promise<boolean> {
  try {
    if (await getKV(MIGRATED_KEY)) return false;
    const c = await getUserConfig();
    let changed = false;
    if (c.sleepAwarenessEnabled) {
      const perDay = Math.max(1, Math.round(c.notificationsPerDay ?? 4));
      const total = c.inspirationModeEnabled ? (c.inspirationPerDay ?? 6) + perDay : perDay;
      await updateUserConfig({
        inspirationModeEnabled: true,
        inspirationPerDay: Math.min(14, total),
        sleepAwarenessEnabled: false,
      });
      changed = true;
    }
    await setKV(MIGRATED_KEY, new Date().toISOString());
    await cancelSleepAwarenessNotifications().catch(() => {});
    return changed;
  } catch (err) {
    console.warn('[sleepAwareness] migração falhou:', err);
    return false;
  }
}
