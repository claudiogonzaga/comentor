import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Fila de mídia: toca uma lista de faixas EM SEQUÊNCIA, com áudio em segundo
// plano (continua com a tela apagada, igual ao "Leia para mim"). Cada item toca
// até o fim natural (didJustFinish) ou, no caso da respiração (loop + duração),
// até `stopAfterMs`. Avança sozinho. Player em nível de MÓDULO para sobreviver à
// navegação entre telas. Usado pela Ioga Nidra (1 item) e pela Sequência (N).

export interface QueueItem {
  label: string;
  source: number | { uri: string };
  /** Respiração: toca em loop até stopAfterMs. Demais: false (toca até o fim). */
  loop?: boolean;
  /** Duração fixa (ms) — para a respiração. */
  stopAfterMs?: number | null;
}

interface MediaQueueState {
  status: 'idle' | 'playing' | 'paused';
  items: QueueItem[];
  index: number;
  start: (items: QueueItem[]) => Promise<void>;
  toggle: () => void;
  skip: () => void;
  stop: () => void;
}

let player: AudioPlayer | null = null;
let sub: { remove(): void } | null = null;
let bgReady = false;
let endAt = 0; // wall-clock (ms) do fim do item atual (0 = sem limite)
let pausedRemaining = 0; // ms restantes guardados ao pausar um item com duração

async function ensureBg(): Promise<void> {
  if (bgReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
    bgReady = true;
  } catch {
    /* toca em primeiro plano mesmo */
  }
}

function clearSub() {
  if (sub) {
    try {
      sub.remove();
    } catch {
      /* já removido */
    }
    sub = null;
  }
}

function release() {
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {
      /* já liberado */
    }
    player = null;
  }
}

export const useMediaQueue = create<MediaQueueState>((set, get) => {
  const playAt = (i: number) => {
    clearSub();
    release();
    const item = get().items[i];
    if (!item) {
      release();
      set({ status: 'idle', items: [], index: 0 });
      return;
    }
    set({ index: i, status: 'playing' });
    try {
      const p = createAudioPlayer(item.source);
      player = p;
      p.loop = !!item.loop;
      endAt = item.stopAfterMs && item.stopAfterMs > 0 ? Date.now() + item.stopAfterMs : 0;
      pausedRemaining = 0;
      sub = p.addListener('playbackStatusUpdate', (st) => {
        if (get().status !== 'playing') return;
        if (endAt && Date.now() >= endAt) {
          playAt(get().index + 1);
          return;
        }
        if (!item.loop && (st as { didJustFinish?: boolean })?.didJustFinish) {
          playAt(get().index + 1);
        }
      });
      p.play();
    } catch {
      // se um item falhar, pula para o próximo em vez de travar a fila
      playAt(i + 1);
    }
  };

  return {
    status: 'idle',
    items: [],
    index: 0,
    start: async (items) => {
      await ensureBg();
      clearSub();
      release();
      set({ items, index: 0, status: 'idle' });
      if (items.length) playAt(0);
    },
    toggle: () => {
      const p = player;
      if (!p) return;
      const st = get().status;
      try {
        if (st === 'playing') {
          if (endAt) pausedRemaining = Math.max(0, endAt - Date.now());
          p.pause();
          set({ status: 'paused' });
        } else if (st === 'paused') {
          if (pausedRemaining) {
            endAt = Date.now() + pausedRemaining;
            pausedRemaining = 0;
          }
          p.play();
          set({ status: 'playing' });
        }
      } catch {
        /* ignore */
      }
    },
    skip: () => {
      if (get().status === 'idle') return;
      playAt(get().index + 1);
    },
    stop: () => {
      clearSub();
      release();
      endAt = 0;
      pausedRemaining = 0;
      set({ status: 'idle', items: [], index: 0 });
    },
  };
});
