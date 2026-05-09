import { create } from 'zustand';
import type { UserConfig } from '../types';
import { getUserConfig, updateUserConfig } from '../services/database';
import { getApiKey, saveApiKey } from '../services/secureStore';

interface AppState {
  ready: boolean;
  config: UserConfig | null;
  hasApiKey: boolean;
  init: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  setConfig: (patch: Partial<UserConfig>) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  config: null,
  hasApiKey: false,
  init: async () => {
    const config = await getUserConfig();
    const apiKey = await getApiKey();
    const hasApiKey = !!apiKey;
    set({ config: { ...config, hasApiKey }, hasApiKey, ready: true });
  },
  refreshConfig: async () => {
    const config = await getUserConfig();
    const apiKey = await getApiKey();
    const hasApiKey = !!apiKey;
    set({ config: { ...config, hasApiKey }, hasApiKey });
  },
  setConfig: async (patch) => {
    const updated = await updateUserConfig(patch);
    const apiKey = await getApiKey();
    set({ config: { ...updated, hasApiKey: !!apiKey }, hasApiKey: !!apiKey });
  },
  setApiKey: async (key) => {
    await saveApiKey(key);
    await updateUserConfig({ hasApiKey: true });
    const config = await getUserConfig();
    set({ config: { ...config, hasApiKey: true }, hasApiKey: true });
  },
}));
