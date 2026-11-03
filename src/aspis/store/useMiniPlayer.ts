// O vídeo tocando em miniatura. Fica fora das abas: continua à vista ao navegar.
import { create } from 'zustand';

export interface MiniPlayerItem {
  videoId: string;
  title: string;
}

interface MiniPlayerState {
  item: MiniPlayerItem | null;
  /** Vídeos cujo dono não deixa tocar fora do YouTube: para estes, baixar é o caminho. */
  blocked: Record<string, true>;
  open: (item: MiniPlayerItem) => void;
  close: () => void;
  markBlocked: (videoId: string) => void;
}

export const useMiniPlayer = create<MiniPlayerState>((set, get) => ({
  item: null,
  blocked: {},
  open: (item) => set({ item }),
  close: () => set({ item: null }),
  markBlocked: (videoId) => set({ blocked: { ...get().blocked, [videoId]: true } }),
}));
