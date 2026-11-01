// Transcrição de vídeos sem legenda + refazer a triagem com o texto real.
//
// Por vídeo: legendas do YouTube (grátis, instantâneo) → senão baixa o áudio
// e transcreve NO CELULAR (Parakeet) → salva a transcrição → se a triagem
// tinha sido só por metadados, refaz score/pilar/síntese com a transcrição.
//
// Automática: depois de atualizar o feed (e ao abrir o app), percorre a fila
// do banco — vídeos triados só por metadados — um por vez, com um serviço em
// primeiro plano para não parar quando a tela apaga.
import { create } from 'zustand';

import { analyzeTranscript } from '../services/brain';
import { fetchTranscript } from '../services/captions';
import * as db from '../services/db';
import { findMedia } from '../services/media';
import {
  AUTO_MAX_MINUTES,
  cancelTranscription,
  canDownloadAudioNow,
  cancelModelDownload,
  deleteModel,
  downloadModel,
  durationMinutes,
  getAutoMode,
  isCanceled,
  keepAlive,
  modelStatus,
  onModelProgress,
  onTranscribeProgress,
  releaseModel,
  setAutoMode,
  transcribeFile,
  TRANSCRIPTION_SUPPORTED,
  type AutoMode,
} from '../services/transcription';
import type { Transcript, TranscriptSource, VideoMeta, VideoRecord } from '../types';
import { useAppStore } from './useAppStore';
import { useMediaStore } from './useMediaStore';

export type TranscribeStage = 'captions' | 'audio' | 'transcribing' | 'analyzing';

export interface TranscribeJob {
  stage: TranscribeStage;
  progress: number; // 0–1 (etapa atual)
  auto: boolean;
}

interface ModelState {
  installed: boolean;
  downloading: boolean;
  received: number;
  total: number;
  error: string | null;
}

interface TranscribeState {
  jobs: Record<string, TranscribeJob>; // por video_id
  errors: Record<string, string>; // erro da última tentativa MANUAL
  model: ModelState;
  autoMode: AutoMode;
  autoRunning: boolean;
  version: number; // bump → telas releem o vídeo do banco

  init: () => void;
  transcribe: (videoId: string) => Promise<boolean>;
  cancel: (videoId: string) => void;
  runAuto: () => Promise<void>;
  setAuto: (mode: AutoMode) => void;
  downloadModel: () => Promise<void>;
  cancelModelDownload: () => void;
  deleteModel: () => void;
}

export class ModelMissingError extends Error {
  constructor() {
    super('Baixe o modelo de transcrição (Configurações) para transcrever no celular.');
  }
}

let subscribed = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function metaOf(v: VideoRecord): VideoMeta {
  return {
    video_id: v.video_id,
    title: v.original_title,
    channel: v.channel,
    channel_id: v.channel_id,
    description: '',
    published_at: v.published_at,
    duration: v.duration,
    url: v.url,
    channel_thumb: v.channel_thumb,
  };
}

export const useTranscribeStore = create<TranscribeState>((set, get) => {
  const setJob = (videoId: string, job: TranscribeJob | null) => {
    const { [videoId]: _, ...rest } = get().jobs;
    set({ jobs: job ? { ...rest, [videoId]: job } : rest });
  };

  const refreshModel = () => {
    const s = modelStatus();
    set({
      model: {
        ...get().model,
        installed: s.installed,
        downloading: s.downloading,
        received: s.downloadedBytes,
        total: s.totalBytes,
      },
    });
  };

  // Pipeline de um vídeo. Lança erro (inclusive ModelMissingError).
  const pipeline = async (videoId: string, auto: boolean): Promise<void> => {
    const video = db.getVideo(videoId);
    if (!video) throw new Error('Vídeo não encontrado.');
    if ((video.transcript_text || '').trim()) return;

    // 1) legendas públicas do YouTube
    setJob(videoId, { stage: 'captions', progress: 0, auto });
    let transcript: Transcript | null = await fetchTranscript(videoId).catch(() => null);
    let source: TranscriptSource = 'youtube';

    // 2) sem legenda → áudio + Parakeet no celular
    if (!transcript?.available) {
      if (!modelStatus().installed) throw new ModelMissingError();
      setJob(videoId, { stage: 'audio', progress: 0, auto });
      if (!findMedia(videoId, 'audio')) {
        await useMediaStore.getState().ensure(video.url, videoId, 'audio');
      }
      const file = findMedia(videoId, 'audio');
      if (!file) throw new Error('Não consegui baixar o áudio do vídeo.');
      setJob(videoId, { stage: 'transcribing', progress: 0, auto });
      keepAlive.update(`Transcrevendo: ${video.neutral_title || video.original_title}`);
      transcript = await transcribeFile(file.uri, videoId);
      source = 'parakeet';
      if (!transcript.available) throw new Error('Não encontrei fala nesse áudio.');
    }

    db.setTranscript(videoId, transcript, source);

    // 3) triagem feita só por título/descrição → refaz com o conteúdo real
    const { geminiKey, model, pillars, rules, noteLang, learnedPrefs, bumpFeed } =
      useAppStore.getState();
    if (video.content_source === 'metadata' && geminiKey) {
      setJob(videoId, { stage: 'analyzing', progress: 0, auto });
      const analysis = await analyzeTranscript(metaOf(video), transcript, {
        apiKey: geminiKey, model, pillars, rules, noteLang, learnedPrefs,
      });
      db.updateAnalysis(videoId, analysis, source === 'youtube' ? 'captions' : 'transcript');
    }
    bumpFeed();
  };

  return {
    jobs: {},
    errors: {},
    model: { installed: false, downloading: false, received: 0, total: 0, error: null },
    autoMode: 'wifi',
    autoRunning: false,
    version: 0,

    init: () => {
      if (!TRANSCRIPTION_SUPPORTED) return;
      set({ autoMode: getAutoMode() });
      refreshModel();
      if (!subscribed) {
        subscribed = true;
        onModelProgress((received, total) =>
          set({ model: { ...get().model, downloading: true, received, total } }),
        );
        onTranscribeProgress((id, progress) => {
          const job = get().jobs[id];
          if (job?.stage === 'transcribing' && Math.abs(progress - job.progress) >= 0.01) {
            setJob(id, { ...job, progress });
          }
        });
      }
      get().runAuto();
    },

    // Botão "Transcrever". Tem prioridade: pausa o item automático em curso.
    transcribe: async (videoId) => {
      if (get().jobs[videoId]) return false;
      for (const [id, job] of Object.entries(get().jobs)) {
        if (job.auto) cancelTranscription(id);
      }
      const { [videoId]: _, ...errors } = get().errors;
      set({ errors });
      try {
        await pipeline(videoId, false);
        db.setAsrStatus(videoId, 'done');
        return true;
      } catch (e) {
        if (!isCanceled(e)) {
          set({ errors: { ...get().errors, [videoId]: e instanceof Error ? e.message : String(e) } });
        }
        return false;
      } finally {
        setJob(videoId, null);
        set({ version: get().version + 1 });
      }
    },

    cancel: (videoId) => {
      const job = get().jobs[videoId];
      if (!job) return;
      if (job.stage === 'audio') useMediaStore.getState().cancel(videoId, 'audio');
      cancelTranscription(videoId);
    },

    runAuto: async () => {
      if (!TRANSCRIPTION_SUPPORTED || get().autoRunning) return;
      set({ autoRunning: true });
      let started = false;
      const tried = new Set<string>();
      try {
        while (true) {
          const mode = get().autoMode;
          if (mode === 'off' || !modelStatus().installed) break;
          // pedido manual em andamento tem a vez
          if (Object.values(get().jobs).some((j) => !j.auto)) {
            await sleep(2000);
            continue;
          }
          const next = db
            .autoTranscribeCandidates()
            .find((v) => !tried.has(v.video_id) && !get().jobs[v.video_id]);
          if (!next) break;
          tried.add(next.video_id);

          const minutes = durationMinutes(next.duration);
          if (minutes != null && minutes > AUTO_MAX_MINUTES) {
            db.setAsrStatus(next.video_id, 'skipped', `longo demais (${minutes} min)`);
            continue;
          }
          // sem o áudio no celular e sem rede permitida → tenta mais tarde
          if (!findMedia(next.video_id, 'audio') && !canDownloadAudioNow(mode)) break;

          if (!started) {
            started = true;
            keepAlive.start('Preparando a transcrição automática…');
          }
          try {
            await pipeline(next.video_id, true);
            db.setAsrStatus(next.video_id, 'done');
          } catch (e) {
            if (e instanceof ModelMissingError) break;
            // cancelado (ex.: o usuário pediu outro vídeo) → volta para a fila
            if (!isCanceled(e)) {
              db.setAsrStatus(next.video_id, 'failed', e instanceof Error ? e.message : String(e));
            } else {
              tried.delete(next.video_id);
            }
          } finally {
            setJob(next.video_id, null);
            set({ version: get().version + 1 });
          }
        }
      } finally {
        if (started) {
          keepAlive.stop();
          releaseModel();
        }
        set({ autoRunning: false });
      }
    },

    setAuto: (mode) => {
      setAutoMode(mode);
      set({ autoMode: mode });
      if (mode !== 'off') get().runAuto();
    },

    downloadModel: async () => {
      set({ model: { ...get().model, downloading: true, error: null } });
      try {
        await downloadModel();
        refreshModel();
        get().runAuto();
      } catch (e) {
        set({
          model: {
            ...get().model,
            error: isCanceled(e) ? null : e instanceof Error ? e.message : String(e),
          },
        });
      } finally {
        set({ model: { ...get().model, downloading: false } });
        refreshModel();
      }
    },

    cancelModelDownload: () => cancelModelDownload(),

    deleteModel: () => {
      deleteModel();
      refreshModel();
    },
  };
});
