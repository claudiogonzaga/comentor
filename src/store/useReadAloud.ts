import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { prepareReadAloudAudio, speakLongText, stopSpeaking } from '../services/voice';
import { startReadAloudKeepAlive, stopReadAloudKeepAlive } from '../services/readAloudKeepAlive';

export type ReadAloudStatus = 'idle' | 'generating' | 'playing' | 'paused';

export interface ReadAloudStartOpts {
  provider: 'system' | 'gemini';
  geminiVoiceName?: string;
  voiceId?: string | null;
  language?: string | null;
  paused?: boolean;
  rate?: number;
}

interface ReadAloudState {
  status: ReadAloudStatus;
  /** Progresso da geração do áudio Gemini (só na 1ª vez). */
  gen: { done: number; total: number } | null;
  currentTime: number;
  duration: number;
  /** Rótulo curto do que está tocando (1ª linha do texto). */
  title: string;
  /** Voz Gemini (tem arquivo → scrubber). Sistema = sem barra. */
  isGemini: boolean;
  error: string | null;
  /** Incrementa a cada término NATURAL (para encadear respiração, etc.). */
  finishedTick: number;

  startGemini: (text: string, title: string, opts: ReadAloudStartOpts) => Promise<void>;
  startSystem: (text: string, title: string, opts: ReadAloudStartOpts) => void;
  playSavedUri: (uri: string, title: string, rate: number) => Promise<void>;
  toggle: () => void;
  stop: () => void;
  seek: (fraction: number) => void;
  /** Volta `seconds` no áudio (ex.: 30s). Não passa de 0. */
  skipBack: (seconds: number) => void;
  setRate: (rate: number) => void;
  clearError: () => void;
}

// Player e assinatura em nível de MÓDULO (não de componente): a leitura continua
// mesmo que o usuário saia da tela "Leia para mim".
let player: AudioPlayer | null = null;
let sub: { remove: () => void } | null = null;
// Token de geração/reprodução: cada start/stop o incrementa; trabalho de uma
// geração antiga (que ainda estava gerando) é descartado quando o token muda.
let token = 0;

function teardownPlayer() {
  try {
    sub?.remove();
  } catch {
    /* ignore */
  }
  sub = null;
  // PAUSAR antes de remover: no expo-audio, `remove()` libera o objeto mas NÃO
  // garante que o som pare na hora — sem o pause, tocar outro arquivo deixava os
  // dois soando juntos e o botão ■ "não parava" nada. Pausa silencia já.
  try {
    player?.pause();
  } catch {
    /* ignore */
  }
  try {
    player?.remove();
  } catch {
    /* ignore */
  }
  player = null;
}

function formatErr(e: unknown): string {
  const daily = !!(e as { dailyQuota?: boolean })?.dailyQuota;
  if (daily) {
    return 'cota DIÁRIA da API esgotada (≈100 leituras/dia). Reseta à meia-noite no Pacífico (~4-5h no Brasil). Tente a voz do sistema em “Sons e Vozes”.';
  }
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const low = raw.toLowerCase();
  if (low.includes('429') || low.includes('quota') || low.includes('rate')) {
    return 'limite POR MINUTO da API atingido — aguarde um pouquinho e tente de novo.';
  }
  if (low.includes('chave') || low.includes('api key') || low.includes('api_key')) {
    return 'problema com a chave da API.';
  }
  return raw || 'não consegui gerar o áudio.';
}

export const useReadAloud = create<ReadAloudState>((set, get) => {
  const attachAndPlay = async (uri: string, rate: number, mine: number) => {
    // Modo de áudio da REPRODUÇÃO: toca em background + duca outras mídias.
    // Setado DIRETO (não pelo ensureBackgroundAudio guardado) para sempre
    // sobrescrever o 'mixWithOthers' que o keep-alive da geração deixou.
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      });
    } catch {
      /* segue tocando em primeiro plano se falhar */
    }
    if (mine !== token) return; // um start mais novo assumiu durante o await
    teardownPlayer();
    const p = createAudioPlayer({ uri });
    player = p;
    try {
      p.loop = false; // NUNCA repetir ao chegar no fim (sem loop)
      p.shouldCorrectPitch = true;
      if (rate && Math.abs(rate - 1) > 0.001) p.setPlaybackRate(rate, 'high');
    } catch {
      /* nem todo device aplica rate */
    }
    sub = p.addListener('playbackStatusUpdate', (st) => {
      if (player !== p) return; // status de um player já substituído
      const cur = st?.currentTime ?? 0;
      const dur = st?.duration ?? 0;
      if (st?.didJustFinish) {
        // PAUSA antes de voltar pro início — senão o seekTo(0) reinicia a fala
        // (a intenção de tocar persiste) e vira LOOP infinito.
        try {
          p.pause();
        } catch {
          /* ignore */
        }
        try {
          p.seekTo(0);
        } catch {
          /* ignore */
        }
        set((s) => ({
          status: 'paused',
          currentTime: 0,
          duration: dur,
          finishedTick: s.finishedTick + 1,
        }));
        return;
      }
      set({ currentTime: cur, duration: dur, status: st?.playing ? 'playing' : 'paused' });
    });
    set({ currentTime: 0, status: 'playing' });
    try {
      p.play();
    } catch {
      /* ignore */
    }
  };

  return {
    status: 'idle',
    gen: null,
    currentTime: 0,
    duration: 0,
    title: '',
    isGemini: false,
    error: null,
    finishedTick: 0,

    // Voz GEMINI: gera o áudio COMPLETO (pode levar minutos) e toca. Roda em
    // nível de módulo → o usuário pode sair da tela; a leitura começa quando
    // ficar pronta, em qualquer tela.
    startGemini: async (text, title, opts) => {
      const t = text.trim();
      if (!t) return;
      const mine = ++token;
      await stopSpeaking();
      teardownPlayer();
      set({
        status: 'generating',
        isGemini: true,
        title,
        gen: { done: 0, total: 1 },
        currentTime: 0,
        duration: 0,
        error: null,
      });
      // Mantém o app VIVO durante a geração — senão, ao SAIR do app, o Android
      // congela o JS e a geração para no meio (ex.: travou em 2/13).
      void startReadAloudKeepAlive();
      try {
        const uri = await prepareReadAloudAudio(t, {
          geminiVoiceName: opts.geminiVoiceName,
          paused: opts.paused,
          onProgress: (done, total) => {
            if (mine === token) set({ gen: { done, total } });
          },
        });
        if (mine !== token) {
          stopReadAloudKeepAlive();
          return; // parado/superado no meio
        }
        set({ gen: null });
        stopReadAloudKeepAlive(); // para o silêncio antes de tocar o áudio real
        if (uri) await attachAndPlay(uri, opts.rate ?? 1, mine);
        else set({ status: 'idle' });
      } catch (e) {
        stopReadAloudKeepAlive();
        if (mine !== token) return;
        set({ status: 'idle', gen: null, error: formatErr(e) });
      }
    },

    // Voz do SISTEMA: lê direto (expo-speech; também continua entre telas). Sem
    // arquivo/scrubber.
    startSystem: (text, title, opts) => {
      const t = text.trim();
      if (!t) return;
      const mine = ++token;
      stopSpeaking();
      teardownPlayer();
      set({
        status: 'playing',
        isGemini: false,
        title,
        gen: null,
        currentTime: 0,
        duration: 0,
        error: null,
      });
      speakLongText(t, {
        provider: 'system',
        voiceId: opts.voiceId,
        language: opts.language,
        rate: opts.rate,
        paused: opts.paused,
        onDone: () => {
          if (mine === token) set((s) => ({ status: 'idle', finishedTick: s.finishedTick + 1 }));
        },
        onError: () => {
          if (mine === token) set({ status: 'idle', error: 'não consegui ler o texto.' });
        },
      });
    },

    // Texto SALVO com áudio pronto → toca direto (instantâneo).
    playSavedUri: async (uri, title, rate) => {
      const mine = ++token;
      await stopSpeaking();
      teardownPlayer();
      if (mine !== token) return;
      set({
        status: 'generating',
        isGemini: true,
        title,
        gen: null,
        currentTime: 0,
        duration: 0,
        error: null,
      });
      await attachAndPlay(uri, rate, mine);
    },

    toggle: () => {
      const p = player;
      if (!p) return;
      try {
        if (get().status === 'playing') {
          p.pause();
          set({ status: 'paused' });
        } else {
          // Se está no fim, recomeça do início ao dar play (replay).
          const { currentTime, duration } = get();
          if (duration > 0 && currentTime >= duration - 0.25) {
            try {
              p.seekTo(0);
            } catch {
              /* ignore */
            }
          }
          p.play();
          set({ status: 'playing' });
        }
      } catch {
        /* ignore */
      }
    },

    stop: () => {
      token++;
      stopSpeaking();
      stopReadAloudKeepAlive();
      teardownPlayer();
      set({ status: 'idle', gen: null, currentTime: 0, duration: 0, title: '' });
    },

    // Arrastar a barra: pula no tempo SEM mudar play/pause (arrastar pausado
    // continua pausado).
    seek: (fraction) => {
      const p = player;
      const { duration } = get();
      if (!p || duration <= 0) return;
      try {
        p.seekTo(Math.max(0, Math.min(1, fraction)) * duration);
      } catch {
        /* ignore */
      }
    },

    skipBack: (seconds) => {
      const p = player;
      const { currentTime } = get();
      if (!p) return;
      try {
        const target = Math.max(0, currentTime - Math.abs(seconds));
        p.seekTo(target);
        set({ currentTime: target });
      } catch {
        /* ignore */
      }
    },

    setRate: (rate) => {
      const p = player;
      if (!p) return;
      try {
        p.shouldCorrectPitch = true;
        p.setPlaybackRate(rate && rate > 0 ? rate : 1, 'high');
      } catch {
        /* ignore */
      }
    },

    clearError: () => set({ error: null }),
  };
});
