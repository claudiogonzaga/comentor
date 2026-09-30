import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { registerPlayer, claimPlayback } from '../services/playerBus';

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
  /**
   * Chamado UMA vez quando o item sai de cena: `completed` = chegou ao fim
   * natural (fim do áudio ou do tempo); false = pulado/parado antes.
   * `playedMs` desconta as pausas. `durationMs` = duração do áudio, se conhecida.
   */
  onEnd?: (info: { completed: boolean; playedMs: number; startedAt: number; durationMs: number | null }) => void;
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
// Tempo efetivamente tocado do item atual (para o onEnd).
let curItem: QueueItem | null = null;
let curStartedAt = 0;
let curPausedAt = 0;
let curPausedTotal = 0;

/** Informa o fim do item atual (uma vez só) a quem pediu (onEnd). */
function reportEnd(completed: boolean) {
  const item = curItem;
  if (!item) return;
  curItem = null;
  const now = Date.now();
  const paused = curPausedTotal + (curPausedAt ? now - curPausedAt : 0);
  let playedMs = Math.max(0, now - curStartedAt - paused);
  let durationMs: number | null = null;
  try {
    const d = player?.duration;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0) durationMs = Math.round(d * 1000);
    // Faixa sem loop: a POSIÇÃO do player é a verdade — outro app pode ter
    // pausado o áudio (perda de foco) sem a fila saber.
    const pos = player?.currentTime;
    if (!item.loop && typeof pos === 'number' && Number.isFinite(pos) && pos >= 0) {
      // No fim natural a posição pode já ter voltado a 0: vale a duração.
      playedMs = completed ? (durationMs ?? playedMs) : Math.round(pos * 1000);
    }
  } catch {
    /* sem duração/posição */
  }
  // Em loop (respiração), a duração é de UMA volta da trilha: não limita.
  if (durationMs && !item.loop) playedMs = Math.min(playedMs, durationMs);
  try {
    item.onEnd?.({ completed, playedMs, startedAt: curStartedAt, durationMs });
  } catch {
    /* callback do chamador não derruba a fila */
  }
}

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
      curItem = item;
      curStartedAt = Date.now();
      curPausedAt = 0;
      curPausedTotal = 0;
      sub = p.addListener('playbackStatusUpdate', (st) => {
        if (get().status !== 'playing') return;
        if (endAt && Date.now() >= endAt) {
          reportEnd(true);
          playAt(get().index + 1);
          return;
        }
        if (!item.loop && (st as { didJustFinish?: boolean })?.didJustFinish) {
          reportEnd(true);
          playAt(get().index + 1);
        }
      });
      p.play();
    } catch {
      // se um item falhar, pula para o próximo em vez de travar a fila
      curItem = null;
      playAt(i + 1);
    }
  };

  return {
    status: 'idle',
    items: [],
    index: 0,
    start: async (items) => {
      claimPlayback('sequence'); // player único: para o Leia para mim antes
      await ensureBg();
      reportEnd(false); // a fila anterior foi substituída
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
          curPausedAt = Date.now();
          set({ status: 'paused' });
        } else if (st === 'paused') {
          if (pausedRemaining) {
            endAt = Date.now() + pausedRemaining;
            pausedRemaining = 0;
          }
          p.play();
          if (curPausedAt) {
            curPausedTotal += Date.now() - curPausedAt;
            curPausedAt = 0;
          }
          set({ status: 'playing' });
        }
      } catch {
        /* ignore */
      }
    },
    skip: () => {
      if (get().status === 'idle') return;
      reportEnd(false);
      playAt(get().index + 1);
    },
    stop: () => {
      reportEnd(false);
      clearSub();
      release();
      endAt = 0;
      pausedRemaining = 0;
      set({ status: 'idle', items: [], index: 0 });
    },
  };
});

// Player único: quando OUTRO player (ex.: Leia para mim) assume, a Sequência para.
registerPlayer('sequence', () => {
  useMediaQueue.getState().stop();
});
