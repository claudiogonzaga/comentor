// Estado global (zustand): preferências, pilares, chave Gemini e sessão
// Google. Chave SEMPRE no SecureStore (Keystore do Android); o resto em
// AsyncStorage. Pilares/regras seguem o mesmo modelo editável do desktop
// (~/.aspis/pilares.json / prefs.json).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore as useRootStore } from '../../store/useAppStore';
import { deleteApiKey, getApiKey } from '../../services/secureStore';
import { claudeForTask } from '../../services/aiTasks';
import { create } from 'zustand';

import {
  DEFAULT_MIN_STARS,
  DEFAULT_MODEL,
  DEFAULT_PERIOD,
  DEFAULT_PILLARS,
  DEFAULT_RULES,
  LEGACY_DEFAULT_RULES,
} from '../constants/defaults';
import { DEFAULT_GEMINI_VOICE, isValidVoice } from '../services/geminiTTS';
import {
  configureGoogle,
  getAccessToken,
  restoreSignIn,
  signIn,
  signOutGoogle,
} from '../services/auth';
import { getMyChannel } from '../services/youtube';
import { distillPreferences } from '../services/brain';
import * as db from '../services/db';
import type { GoogleUser, NoteLang, Period, Pillar, YtChannel } from '../types';

const K = {
  model: 'aspis:model',
  pillars: 'aspis:pillars',
  rules: 'aspis:rules',
  minStars: 'aspis:minStars',
  period: 'aspis:period',
  showRead: 'aspis:showRead',
  ttsVoice: 'aspis:ttsVoice',
  noteLang: 'aspis:noteLang',
  channel: 'aspis:channel',
  learnedPrefs: 'aspis:learnedPrefs',
  defaultsV2: 'aspis:defaultsV2',
  pillarsV2: 'aspis:pillarsV2',
} as const;

interface AppState {
  ready: boolean;
  geminiKey: string;
  model: string;
  pillars: Pillar[];
  rules: string;
  minStars: number;
  period: Period;
  showRead: boolean;
  ttsVoice: string; // voz do Gemini para a leitura em voz alta
  noteLang: NoteLang; // idioma das notas geradas
  learnedPrefs: string; // L2: perfil aprendido do feedback (injetado no score)
  user: GoogleUser | null;
  channel: YtChannel | null; // canal do YouTube selecionado (com avatar)
  feedVersion: number; // bump → telas releem o SQLite

  init: () => Promise<void>;
  setGeminiKey: (key: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setPillars: (pillars: Pillar[]) => Promise<void>;
  setRules: (rules: string) => Promise<void>;
  setMinStars: (n: number) => Promise<void>;
  setPeriod: (p: Period) => Promise<void>;
  setShowRead: (v: boolean) => Promise<void>;
  setTtsVoice: (v: string) => Promise<void>;
  setNoteLang: (v: NoteLang) => Promise<void>;
  setLearnedPrefs: (v: string) => Promise<void>;
  runLearning: () => Promise<string>; // destila o feedback → perfil aprendido
  googleSignIn: () => Promise<GoogleUser | null>;
  googleSignOut: () => Promise<void>;
  refreshChannel: () => Promise<void>;
  bumpFeed: () => void;
}

function normalizePillars(raw: unknown): Pillar[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_PILLARS;
  return raw.map((p) => ({
    id: String(p.id || ''),
    nome: String(p.nome || ''),
    descricao: String(p.descricao || ''),
    quero: Array.isArray(p.quero) ? p.quero.map(String) : [],
    nao_quero: Array.isArray(p.nao_quero) ? p.nao_quero.map(String) : [],
    peso: Math.max(1, Math.min(5, Number(p.peso) || 3)),
    mocName: String(p.mocName || p.nome || ''),
  }));
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  geminiKey: '',
  model: DEFAULT_MODEL,
  pillars: DEFAULT_PILLARS,
  rules: DEFAULT_RULES,
  minStars: DEFAULT_MIN_STARS,
  period: DEFAULT_PERIOD,
  showRead: false,
  ttsVoice: DEFAULT_GEMINI_VOICE,
  noteLang: 'pt-BR',
  learnedPrefs: '',
  user: null,
  channel: null,
  feedVersion: 0,

  init: async () => {
    db.init();
    configureGoogle();

    const [key, stored] = await Promise.all([
      getApiKey().catch(() => null),
      AsyncStorage.multiGet(Object.values(K)).catch(() => [] as [string, string | null][]),
    ]);
    const map = new Map(stored);

    let pillars = DEFAULT_PILLARS;
    try {
      const raw = map.get(K.pillars);
      if (raw) pillars = normalizePillars(JSON.parse(raw));
    } catch {
      // mantém defaults
    }

    // Migração única: pilares salvos ganham o pilar amplo "aprendizado" (se o
    // usuário apagá-lo depois, não volta).
    if (!map.get(K.pillarsV2)) {
      const extra = DEFAULT_PILLARS.find((p) => p.id === 'aprendizado');
      if (map.get(K.pillars) && extra && !pillars.some((p) => p.id === extra.id)) {
        pillars = [...pillars, extra];
        AsyncStorage.setItem(K.pillars, JSON.stringify(pillars)).catch(() => {});
      }
      AsyncStorage.setItem(K.pillarsV2, '1').catch(() => {});
    }

    // Regras: quem tinha as regras default antigas (nunca editou) passa a usar
    // as novas — e deixa de gravá-las, para seguir futuras atualizações.
    if (map.get(K.rules) === LEGACY_DEFAULT_RULES) {
      map.delete(K.rules);
      AsyncStorage.removeItem(K.rules).catch(() => {});
    }

    // Migração única: quem ainda estava nos defaults antigos (Dia + nível 2),
    // que deixavam o feed quase vazio, passa para os novos (Semana + nível 1).
    if (!map.get(K.defaultsV2)) {
      if (map.get(K.period) === 'day' && map.get(K.minStars) === '2') {
        map.set(K.period, DEFAULT_PERIOD);
        map.set(K.minStars, String(DEFAULT_MIN_STARS));
        AsyncStorage.multiSet([
          [K.period, DEFAULT_PERIOD],
          [K.minStars, String(DEFAULT_MIN_STARS)],
        ]).catch(() => {});
      }
      AsyncStorage.setItem(K.defaultsV2, '1').catch(() => {});
    }

    set({
      geminiKey: key || '',
      model: map.get(K.model) || DEFAULT_MODEL,
      pillars,
      rules: map.get(K.rules) || DEFAULT_RULES,
      minStars:
        map.get(K.minStars) != null
          ? Math.max(0, Math.min(4, Number(map.get(K.minStars))))
          : DEFAULT_MIN_STARS,
      period: (map.get(K.period) as Period) || DEFAULT_PERIOD,
      showRead: map.get(K.showRead) === '1',
      ttsVoice: isValidVoice(map.get(K.ttsVoice) || '')
        ? (map.get(K.ttsVoice) as string)
        : DEFAULT_GEMINI_VOICE,
      noteLang: map.get(K.noteLang) === 'original' ? 'original' : 'pt-BR',
      learnedPrefs: map.get(K.learnedPrefs) || '',
    });

    // canal do YT persistido (mostra na hora; revalida em segundo plano)
    try {
      const raw = map.get(K.channel);
      if (raw) set({ channel: JSON.parse(raw) as YtChannel });
    } catch {
      // ignora cache inválido
    }

    const user = await restoreSignIn();
    set({ user, ready: true });
    if (user) get().refreshChannel();
  },

  setGeminiKey: async (key: string) => {
    const trimmed = key.trim();
    // A chave do Gemini é uma só no Áskesis: gravar aqui é o mesmo que em Cérebro e Voz.
    if (trimmed) await useRootStore.getState().setApiKey(trimmed);
    else {
      await deleteApiKey();
      await useRootStore.getState().setConfig({ hasApiKey: false });
    }
    set({ geminiKey: trimmed });
  },

  setModel: async (model: string) => {
    set({ model });
    await AsyncStorage.setItem(K.model, model);
  },

  setPillars: async (pillars: Pillar[]) => {
    const normalized = normalizePillars(pillars);
    set({ pillars: normalized });
    await AsyncStorage.setItem(K.pillars, JSON.stringify(normalized));
  },

  setRules: async (rules: string) => {
    const value = rules.trim() || DEFAULT_RULES;
    set({ rules: value });
    await AsyncStorage.setItem(K.rules, value);
  },

  setMinStars: async (n: number) => {
    const v = Math.max(0, Math.min(4, Math.round(n)));
    set({ minStars: v });
    await AsyncStorage.setItem(K.minStars, String(v));
  },

  setPeriod: async (p: Period) => {
    set({ period: p });
    await AsyncStorage.setItem(K.period, p);
  },

  setShowRead: async (v: boolean) => {
    set({ showRead: v });
    await AsyncStorage.setItem(K.showRead, v ? '1' : '0');
  },

  setTtsVoice: async (v: string) => {
    const voice = isValidVoice(v) ? v : DEFAULT_GEMINI_VOICE;
    set({ ttsVoice: voice });
    await AsyncStorage.setItem(K.ttsVoice, voice);
  },

  setNoteLang: async (v: NoteLang) => {
    set({ noteLang: v });
    await AsyncStorage.setItem(K.noteLang, v);
  },

  setLearnedPrefs: async (v: string) => {
    set({ learnedPrefs: v });
    await AsyncStorage.setItem(K.learnedPrefs, v);
  },

  // L2: destila os vídeos pulados (negativos) e salvos/destacados (positivos)
  // num perfil que passa a ajustar a pontuação dos próximos vídeos.
  runLearning: async () => {
    const { geminiKey, model } = get();
    if (!geminiKey && !(await claudeForTask('aspisSimple'))) {
      throw new Error('Configure a chave do Gemini ou do Claude para aprender com o feedback.');
    }
    const { negatives, positives } = db.getFeedbackExamples(40);
    if (negatives.length + positives.length < 3) {
      throw new Error('Poucos sinais ainda — pule ou salve mais alguns vídeos primeiro.');
    }
    const prefs = await distillPreferences(negatives, positives, { apiKey: geminiKey, model });
    set({ learnedPrefs: prefs });
    await AsyncStorage.setItem(K.learnedPrefs, prefs);
    return prefs;
  },

  googleSignIn: async () => {
    const user = await signIn();
    if (user) {
      set({ user });
      get().refreshChannel();
    }
    return user;
  },

  googleSignOut: async () => {
    await signOutGoogle();
    set({ user: null, channel: null });
    await AsyncStorage.removeItem(K.channel);
  },

  // Busca o canal do YouTube da conta (title + avatar) e persiste. Silencioso:
  // falha de rede/escopo não quebra o app.
  refreshChannel: async () => {
    try {
      const token = await getAccessToken();
      const ch = await getMyChannel(token);
      if (ch) {
        set({ channel: ch });
        await AsyncStorage.setItem(K.channel, JSON.stringify(ch));
      }
    } catch {
      // sem rede / sem permissão → mantém o cache
    }
  },

  bumpFeed: () => set({ feedVersion: get().feedVersion + 1 }),
}));
