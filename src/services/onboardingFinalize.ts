// Finaliza o setup do app: cria o habit de sono, agenda notificações, e
// marca onboarding como concluído. Usado tanto pelo fluxo de chave de API
// quanto pelo fluxo de modelo local após o download terminar.

import { ensureSleepHabit } from './coach';
import {
  ensureChannel,
  ensurePermissions,
  scheduleNightReminders,
} from './notifications';
import { useAppStore } from '../store/useAppStore';

export async function activateApp(): Promise<void> {
  const store = useAppStore.getState();
  const config = store.config;
  if (!config) throw new Error('Config not loaded');

  await store.setConfig({ onboardingDone: true });

  const habit = await ensureSleepHabit(config.bedtime);
  const granted = await ensurePermissions();
  if (granted) {
    await ensureChannel();
    await scheduleNightReminders({
      bedtime: config.bedtime,
      intervalMinutes: config.reminderIntervalMinutes,
      maxReminders: 12,
      habitId: habit.id,
      prepRemindersEnabled: config.prepRemindersEnabled,
    });
  }
}
