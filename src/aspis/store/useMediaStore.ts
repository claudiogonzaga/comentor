// Estado dos downloads de áudio/vídeo. Fica fora das telas para o progresso
// sobreviver à navegação (sair do feed e voltar mostra o mesmo download).
//
// Dois caminhos:
// - start(): o usuário tocou em Ouvir/Assistir → baixa já.
// - prefetch(): o usuário abriu um vídeo → o áudio entra numa FILA de pré-download
//   (um por vez, o vídeo aberto mais recente na frente), para já estar pronto se ele
//   decidir ouvir.
import { create } from 'zustand';

import {
  canPrefetchNow,
  cancelDownload,
  DEFAULT_RETENTION_HOURS,
  deleteAllMedia,
  deleteMedia,
  downloadMedia,
  findMedia,
  getPrefetchMode,
  getRetentionHours,
  isCanceled,
  mediaBase,
  onDownloadProgress,
  purgeExpired,
  setPrefetchMode,
  setRetentionHours,
  updateEngine,
  type MediaKind,
  type PrefetchMode,
} from '../services/media';

export interface DownloadState {
  status: 'downloading' | 'error';
  progress: number; // 0–100
  background: boolean; // pré-download (ninguém pediu ainda)
  error?: string;
}

interface Job {
  url: string;
  videoId: string;
  kind: MediaKind;
}

interface MediaState {
  downloads: Record<string, DownloadState>; // chave: "<videoId>.<kind>"
  queue: Job[]; // pré-downloads ainda não iniciados
  retentionHours: number;
  prefetchMode: PrefetchMode;
  version: number; // bump → telas releem os arquivos do disco

  init: () => void;
  refresh: () => void;
  start: (url: string, videoId: string, kind: MediaKind) => Promise<boolean>;
  prefetch: (url: string, videoId: string) => void;
  ensure: (url: string, videoId: string, kind: MediaKind, allowed?: () => boolean) => Promise<void>;
  cancel: (videoId: string, kind: MediaKind) => void;
  remove: (videoId: string, kind?: MediaKind) => void;
  removeAll: () => void;
  setRetention: (hours: number) => void;
  setPrefetch: (mode: PrefetchMode) => void;
}

// Até 3 vídeos esperando na fila; abrir outros descarta os mais antigos.
const MAX_QUEUE = 6;

let unsubscribe: (() => void) | null = null;
let pumping = false;
// Pré-downloads que falharam nesta sessão: não insiste sozinho (o toque do
// usuário ainda tenta de novo).
const failedPrefetch = new Set<string>();
// Downloads pedidos pela transcrição (ensure): a regra de rede é a da transcrição
// (o `allowed` de quem pediu), não a do pré-download — antes, com o pré-download
// "Desligado" ou "Só no Wi-Fi" fora do Wi-Fi, o áudio da transcrição era
// cancelado logo no primeiro progresso e a transcrição falhava sempre.
const guards = new Map<string, () => boolean>();
// Como terminou o último download de cada arquivo que ninguém está vendo
// (pré-download/transcrição): 'canceled' ou a mensagem do yt-dlp.
const outcomes = new Map<string, string>();

export const useMediaStore = create<MediaState>((set, get) => {
  const setDownload = (base: string, d: DownloadState | null) => {
    const { [base]: _, ...rest } = get().downloads;
    set({ downloads: d ? { ...rest, [base]: d } : rest });
  };

  const run = async (job: Job, background: boolean): Promise<boolean> => {
    const base = mediaBase(job.videoId, job.kind);
    setDownload(base, { status: 'downloading', progress: 0, background });
    try {
      await downloadMedia(job.url, job.videoId, job.kind);
      // Um único set: o botão vê "sem download" e "arquivo pronto" juntos.
      const { [base]: _, ...rest } = get().downloads;
      set({ downloads: rest, version: get().version + 1 });
      outcomes.delete(base);
      return true;
    } catch (e) {
      outcomes.set(base, isCanceled(e) ? 'canceled' : e instanceof Error ? e.message : String(e));
      // Se o usuário pediu durante o pré-download, o erro passa a ser dele.
      const wasBackground = get().downloads[base]?.background ?? background;
      if (isCanceled(e)) {
        setDownload(base, null);
      } else if (wasBackground) {
        failedPrefetch.add(base);
        setDownload(base, null);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setDownload(base, { status: 'error', progress: 0, background: false, error: msg });
      }
      return false;
    }
  };

  // Processa a fila de pré-download, um arquivo por vez.
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (get().queue.length > 0) {
        // Saiu do Wi-Fi (ou desligou o pré-download)? Para e esvazia a fila.
        if (!canPrefetchNow(get().prefetchMode)) {
          set({ queue: [] });
          break;
        }
        const [job, ...rest] = get().queue;
        set({ queue: rest });
        const base = mediaBase(job.videoId, job.kind);
        if (get().downloads[base] || findMedia(job.videoId, job.kind)) continue;
        await run(job, true);
      }
    } finally {
      pumping = false;
    }
  };

  return {
    downloads: {},
    queue: [],
    retentionHours: DEFAULT_RETENTION_HOURS,
    prefetchMode: 'wifi',
    version: 0,

    // Na abertura: apaga o que venceu, escuta o progresso nativo e atualiza o
    // yt-dlp em segundo plano (1×/dia).
    init: () => {
      try {
        purgeExpired();
        set({ retentionHours: getRetentionHours(), prefetchMode: getPrefetchMode() });
      } catch (e) {
        console.warn('media init failed', e);
      }
      if (!unsubscribe) {
        let lastNetCheck = 0;
        unsubscribe = onDownloadProgress((base, progress) => {
          const cur = get().downloads[base];
          if (!cur || cur.status !== 'downloading') return;
          // Pré-download "só no Wi-Fi" não continua se o celular caiu para
          // dados móveis no meio (checa a rede a cada ~5 s). O áudio pedido pela
          // transcrição segue a regra dela (guards), não a do pré-download.
          const guard = guards.get(base);
          if ((guard || cur.background) && Date.now() - lastNetCheck > 5000) {
            lastNetCheck = Date.now();
            if (!(guard ? guard() : canPrefetchNow(get().prefetchMode))) {
              const [videoId, kind] = base.split('.') as [string, MediaKind];
              if (!guard) set({ queue: [] });
              cancelDownload(videoId, kind);
              return;
            }
          }
          if (Math.floor(progress) === Math.floor(cur.progress)) return;
          setDownload(base, { ...cur, progress });
        });
      }
      updateEngine(false).catch(() => {});
    },

    refresh: () => {
      purgeExpired();
      set({ version: get().version + 1 });
    },

    // true = arquivo pronto; false = cancelado ou erro (erro fica no estado).
    start: async (url, videoId, kind) => {
      const base = mediaBase(videoId, kind);
      const cur = get().downloads[base];
      if (cur?.status === 'downloading') {
        // Já está pré-baixando: agora é um pedido do usuário (sem regra de rede).
        guards.delete(base);
        if (cur.background) setDownload(base, { ...cur, background: false });
        return false;
      }
      set({ queue: get().queue.filter((j) => mediaBase(j.videoId, j.kind) !== base) });
      failedPrefetch.delete(base);
      return run({ url, videoId, kind }, false);
    },

    prefetch: (url, videoId) => {
      if (!canPrefetchNow(get().prefetchMode)) return;
      // Só o áudio: o vídeo agora toca em miniatura, sem arquivo.
      const jobs: Job[] = (['audio'] as MediaKind[])
        .filter((kind) => {
          const base = mediaBase(videoId, kind);
          return !get().downloads[base] && !failedPrefetch.has(base) && !findMedia(videoId, kind);
        })
        .map((kind) => ({ url, videoId, kind }));
      if (jobs.length === 0) return;
      const others = get().queue.filter((j) => j.videoId !== videoId);
      set({ queue: [...jobs, ...others].slice(0, MAX_QUEUE) });
      pump();
    },

    // Garante o arquivo no celular (para a transcrição): usa o que já existe,
    // espera um download em andamento ou baixa em segundo plano. `allowed` é a
    // regra de rede de quem pediu (sem ela, baixa em qualquer rede). Lança com o
    // motivo do yt-dlp, ou com code E_CANCELED se o download foi cancelado.
    ensure: async (url, videoId, kind, allowed) => {
      if (findMedia(videoId, kind)) return;
      const base = mediaBase(videoId, kind);
      const cur = get().downloads[base];
      // o download que você pediu (Ouvir) não passa a obedecer a regra da fila
      if (!(cur?.status === 'downloading' && !cur.background)) guards.set(base, allowed ?? (() => true));
      outcomes.delete(base);
      try {
        if (get().downloads[base]?.status === 'downloading') {
          await new Promise<void>((resolve) => {
            const unsub = useMediaStore.subscribe((s) => {
              if (s.downloads[base]?.status !== 'downloading') {
                unsub();
                resolve();
              }
            });
          });
        } else {
          set({ queue: get().queue.filter((j) => mediaBase(j.videoId, j.kind) !== base) });
          await run({ url, videoId, kind }, true);
        }
      } finally {
        guards.delete(base);
      }
      if (findMedia(videoId, kind)) return;
      const outcome = outcomes.get(base) ?? get().downloads[base]?.error;
      if (outcome === 'canceled') {
        throw Object.assign(new Error('Download do áudio cancelado.'), { code: 'E_CANCELED' });
      }
      throw new Error(
        outcome ? `Não consegui baixar o áudio: ${outcome}` : 'Não consegui baixar o áudio do vídeo.',
      );
    },

    cancel: (videoId, kind) => {
      const base = mediaBase(videoId, kind);
      set({ queue: get().queue.filter((j) => mediaBase(j.videoId, j.kind) !== base) });
      cancelDownload(videoId, kind);
    },

    remove: (videoId, kind) => {
      set({
        queue: get().queue.filter((j) => j.videoId !== videoId || (kind && j.kind !== kind)),
      });
      deleteMedia(videoId, kind);
      set({ version: get().version + 1 });
    },

    removeAll: () => {
      set({ queue: [] });
      deleteAllMedia();
      set({ version: get().version + 1 });
    },

    setRetention: (hours) => {
      setRetentionHours(hours);
      set({ retentionHours: hours, version: get().version + 1 });
    },

    setPrefetch: (mode) => {
      setPrefetchMode(mode);
      set({ prefetchMode: mode, ...(mode === 'off' ? { queue: [] } : {}) });
    },
  };
});
