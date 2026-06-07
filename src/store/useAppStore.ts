import { create } from 'zustand';
import type { UserConfig } from '../types';
import { getUserConfig, updateUserConfig } from '../services/database';
import { getApiKey, saveApiKey } from '../services/secureStore';
import { setActiveVoice, setActiveVoiceProvider } from '../services/voice';
import { scheduleAllNudges } from '../services/nudges';
import { scheduleAllMedications } from '../services/medications';
import { scheduleSedentaryNudges } from '../services/sedentary';
import { scheduleSleepAwarenessNotifications } from '../services/sleepAwareness';
import { scheduleInspirationNotifications } from '../services/inspiration';
import { setSpokenHeadphonesOnly } from '../services/spokenNudges';

interface AppState {
  ready: boolean;
  config: UserConfig | null;
  hasApiKey: boolean;
  init: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  setConfig: (patch: Partial<UserConfig>) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
}

function syncVoiceFromConfig(config: UserConfig) {
  setActiveVoice(config.voiceId ?? null, config.voiceLanguage ?? null);
  setActiveVoiceProvider(config.voiceProvider, config.geminiVoiceName);
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  config: null,
  hasApiKey: false,
  init: async () => {
    const config = await getUserConfig();
    const apiKey = await getApiKey();
    const hasApiKey = !!apiKey;
    syncVoiceFromConfig(config);
    // Espelha a preferência "só falar com fone" pro nativo (que a lê no disparo).
    setSpokenHeadphonesOnly(config.spokenHeadphonesOnly);
    set({ config: { ...config, hasApiKey }, hasApiKey, ready: true });
    // Ensure daily nudges (bluelight, breathing) are scheduled
    // — seeded on first run, re-scheduled on every cold start so the
    // Android alarm queue stays consistent across reboots / OTA upgrades.
    scheduleAllNudges().catch((err) =>
      console.warn('scheduleAllNudges on init failed:', err),
    );
    // Re-arm the user's medication/supplement reminders (verify-until-taken).
    scheduleAllMedications().catch((err) =>
      console.warn('scheduleAllMedications on init failed:', err),
    );
    // Re-arm the "sitting at work" move nudges (no-op when disabled).
    scheduleSedentaryNudges().catch((err) =>
      console.warn('scheduleSedentaryNudges on init failed:', err),
    );
    // Re-arm the daytime sleep-awareness nudges (random times per day).
    scheduleSleepAwarenessNotifications().catch((err) =>
      console.warn('scheduleSleepAwarenessNotifications on init failed:', err),
    );
    // Re-arm the hourly inspiration alerts (no-op when the mode is off).
    scheduleInspirationNotifications().catch((err) =>
      console.warn('scheduleInspirationNotifications on init failed:', err),
    );
  },
  refreshConfig: async () => {
    const config = await getUserConfig();
    const apiKey = await getApiKey();
    const hasApiKey = !!apiKey;
    syncVoiceFromConfig(config);
    set({ config: { ...config, hasApiKey }, hasApiKey });
  },
  setConfig: async (patch) => {
    const updated = await updateUserConfig(patch);
    const apiKey = await getApiKey();
    syncVoiceFromConfig(updated);
    set({ config: { ...updated, hasApiKey: !!apiKey }, hasApiKey: !!apiKey });
  },
  setApiKey: async (key) => {
    await saveApiKey(key);
    await updateUserConfig({ hasApiKey: true });
    const config = await getUserConfig();
    syncVoiceFromConfig(config);
    set({ config: { ...config, hasApiKey: true }, hasApiKey: true });
  },
}));
