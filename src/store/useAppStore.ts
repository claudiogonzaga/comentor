import { create } from 'zustand';
import type { UserConfig } from '../types';
import { getUserConfig, updateUserConfig } from '../services/database';
import { getApiKey, saveApiKey } from '../services/secureStore';
import { setActiveVoice } from '../services/voice';

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
    set({ config: { ...config, hasApiKey }, hasApiKey, ready: true });
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
