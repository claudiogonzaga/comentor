// Transcrição de vídeos sem legenda + refazer a triagem com o texto real.
//
// Por vídeo: legendas do YouTube (grátis, instantâneo) → senão baixa o áudio
// e transcreve NO CELULAR (Parakeet) → salva a transcrição → se a triagem
// tinha sido só por metadados, refaz score/pilar/síntese com a transcrição
// (retriage.ts — o mesmo caminho das transcrições que chegam do Mac).
//
// Automática: depois de atualizar o feed (e ao abrir o app), percorre a fila
// do banco — vídeos triados só por metadados — um por vez, com um serviço em
// primeiro plano para não parar quando a tela apaga. Só os BEM RANQUEADOS
// (nota ajustada pela rede local ≥ o limiar de estrelas, a maior primeiro) e,
// se o Mac está transcrevendo (desktopTranscripts.ts), só depois de dar a ele
// MAC_WAIT_MS de vantagem — o celular fica com o que o Mac não trouxe.
import { AppState } from 'react-native';
import { create } from 'zustand';

import { starsToThreshold } from '../constants/defaults';
import { fetchTranscript } from '../services/captions';
import * as db from '../services/db';
import { macActive, onDesktopSync } from '../services/desktopTranscripts';
import { findMedia } from '../services/media';
import { alignedScore } from '../services/neural';
import { applyTranscript } from '../services/retriage';
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
import type { Transcript, TranscriptSource, VideoRecord } from '../types';
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

/** Por que a fila automática parou com vídeos esperando (null = não parou por isso). */
export type AutoBlock = 'model' | 'network' | null;

interface TranscribeState {
  jobs: Record<string, TranscribeJob>; // por video_id
  errors: Record<string, string>; // erro da última tentativa MANUAL
  model: ModelState;
  autoMode: AutoMode;
  autoRunning: boolean;
  autoBlocked: AutoBlock;
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

/** O áudio não tem fala reconhecível: não adianta tentar de novo. */
class NoSpeechError extends Error {
  constructor() {
    super('Não encontrei fala nesse áudio.');
  }
}

const canceledError = () =>
  Object.assign(new Error('Transcrição cancelada.'), { code: 'E_CANCELED' });

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).trim().slice(0, 300);

// Depois de analisado, o vídeo bem ranqueado espera isso pelo Mac antes de o
// celular baixar o áudio e transcrever por conta própria.
export const MAC_WAIT_MS = 3 * 3600 * 1000;

export interface AutoQueue {
  ready: VideoRecord[]; // a vez do celular, maior nota primeiro
  waitingMac: VideoRecord[]; // analisados há pouco: o Mac tem a vez
  below: number; // abaixo do limiar: só pelo botão Transcrever
}

/** A fila automática: bem ranqueados (como no feed), na ordem da nota ajustada. */
export function autoQueue(now = Date.now()): AutoQueue {
  const threshold = starsToThreshold(useAppStore.getState().minStars);
  const mac = macActive(now);
  const ranked = db
    .autoTranscribeCandidates()
    .map((v) => ({ v, aligned: alignedScore(v) }))
    .sort((a, b) => b.aligned - a.aligned || (b.v.published_at > a.v.published_at ? 1 : -1));
  const queue: AutoQueue = { ready: [], waitingMac: [], below: 0 };
  for (const { v, aligned } of ranked) {
    if (aligned < threshold) {
      queue.below++;
      continue;
    }
    const analyzedAt = Date.parse(v.fetched_at || '');
    if (mac && Number.isFinite(analyzedAt) && now - analyzedAt < MAC_WAIT_MS) queue.waitingMac.push(v);
    else queue.ready.push(v);
  }
  return queue;
}

let subscribed = false;
// Pedidos de parar: o pipeline confere entre as etapas (o cancelamento nativo só
// alcança a transcrição em si, e a etapa seguinte zerava o pedido).
const aborted = new Set<string>();
// Itens automáticos que você parou pelo botão: não voltam sozinhos nesta sessão.
const stopped = new Set<string>();
// O serviço em primeiro plano é um só para a fila e para o botão.
let holds = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function holdKeepAlive(text: string): void {
  if (holds++ === 0) keepAlive.start(text);
  else keepAlive.update(text);
}

function releaseKeepAlive(): void {
  if (holds === 0) return;
  holds -= 1;
  if (holds === 0) {
    keepAlive.stop();
    releaseModel(); // devolve ~1 GB de RAM do modelo
  }
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

  // Para um item em andamento. `media`: cancela também o download do áudio (um
  // pedido manual que só passa à frente deixa o download terminar — serve depois).
  const abortJob = (videoId: string, media: boolean) => {
    const job = get().jobs[videoId];
    if (!job) return;
    aborted.add(videoId);
    if (media && job.stage === 'audio') useMediaStore.getState().cancel(videoId, 'audio');
    cancelTranscription(videoId);
  };

  // Pipeline de um vídeo. Lança erro (inclusive ModelMissingError). `onHeavy`:
  // chamado quando começa a parte longa (baixar o áudio e transcrever).
  const pipeline = async (videoId: string, auto: boolean, onHeavy?: () => void): Promise<void> => {
    aborted.delete(videoId);
    const checkAbort = () => {
      if (aborted.has(videoId)) throw canceledError();
    };
    const video = db.getVideo(videoId);
    if (!video) throw new Error('Vídeo não encontrado.');
    if ((video.transcript_text || '').trim()) return;

    // 1) legendas públicas do YouTube
    setJob(videoId, { stage: 'captions', progress: 0, auto });
    let transcript: Transcript | null = await fetchTranscript(videoId).catch(() => null);
    let source: TranscriptSource = 'youtube';
    checkAbort();

    // 2) sem legenda → áudio + Parakeet no celular
    if (!transcript?.available) {
      if (!modelStatus().installed) throw new ModelMissingError();
      onHeavy?.();
      setJob(videoId, { stage: 'audio', progress: 0, auto });
      // na fila automática, a regra de rede (Só no Wi-Fi) vale também no meio do download
      const allowed = auto ? () => canDownloadAudioNow(get().autoMode) : undefined;
      await useMediaStore.getState().ensure(video.url, videoId, 'audio', allowed);
      const file = findMedia(videoId, 'audio');
      if (!file) throw new Error('Não consegui baixar o áudio do vídeo.');
      checkAbort();
      setJob(videoId, { stage: 'transcribing', progress: 0, auto });
      keepAlive.update(`Transcrevendo: ${video.neutral_title || video.original_title}`);
      transcript = await transcribeFile(file.uri, videoId);
      source = 'parakeet';
      if (!transcript.available) throw new NoSpeechError();
    }

    // o Mac pode ter entregue a transcrição enquanto esta rodava
    if (db.transcriptState(videoId) === 'has') return;

    // 3) salva e, se a triagem foi só por título/descrição, refaz com o conteúdo real
    await applyTranscript(videoId, transcript, source, {
      onAnalyzing: () => setJob(videoId, { stage: 'analyzing', progress: 0, auto }),
    });
    useAppStore.getState().bumpFeed();
  };

  return {
    jobs: {},
    errors: {},
    model: { installed: false, downloading: false, received: 0, total: 0, error: null },
    autoMode: 'wifi',
    autoRunning: false,
    autoBlocked: null,
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
        // Transcrições do Mac: o item automático do mesmo vídeo para (o Mac chegou
        // antes) e a fila confere de novo — passadas as 3 h, a vez é do celular.
        onDesktopSync((ids) => {
          for (const id of ids) if (get().jobs[id]?.auto) abortJob(id, true);
          if (ids.length) set({ version: get().version + 1 });
          get().runAuto();
        });
      }
      get().runAuto();
    },

    // Botão "Transcrever". Tem prioridade: pausa o item automático em curso.
    transcribe: async (videoId) => {
      if (get().jobs[videoId]) return false;
      for (const [id, job] of Object.entries(get().jobs)) {
        if (job.auto) abortJob(id, false);
      }
      stopped.delete(videoId);
      const { [videoId]: _, ...errors } = get().errors;
      set({ errors });
      // o serviço em primeiro plano também aqui: sair do app no meio do áudio ou
      // da transcrição não congela o trabalho
      let held = false;
      try {
        await pipeline(videoId, false, () => {
          if (held) return;
          held = true;
          holdKeepAlive('Transcrevendo…');
        });
        db.setAsrStatus(videoId, 'done');
        return true;
      } catch (e) {
        if (!isCanceled(e)) set({ errors: { ...get().errors, [videoId]: errorText(e) } });
        return false;
      } finally {
        setJob(videoId, null);
        set({ version: get().version + 1 });
        if (held) releaseKeepAlive();
      }
    },

    // Botão "toque para parar/cancelar".
    cancel: (videoId) => {
      const job = get().jobs[videoId];
      if (!job) return;
      if (job.auto) stopped.add(videoId);
      abortJob(videoId, true);
    },

    runAuto: async () => {
      if (!TRANSCRIPTION_SUPPORTED || get().autoRunning) return;
      // Só começa com o app à vista: na tarefa de segundo plano o Android não deixa
      // ligar o serviço que mantém a fila viva (e o processo morreria no meio).
      // Depois de começar, o serviço a segura com a tela apagada.
      if (AppState.currentState !== 'active') return;
      set({ autoRunning: true, autoBlocked: null });
      let started = false;
      const tried = new Set<string>();
      try {
        while (true) {
          const mode = get().autoMode;
          if (mode === 'off') break;
          // pedido manual em andamento tem a vez
          if (Object.values(get().jobs).some((j) => !j.auto)) {
            await sleep(2000);
            continue;
          }
          const next = autoQueue().ready.find(
            (v) => !tried.has(v.video_id) && !stopped.has(v.video_id) && !get().jobs[v.video_id],
          );
          if (!next) break;
          if (!modelStatus().installed) {
            set({ autoBlocked: 'model' });
            break;
          }
          tried.add(next.video_id);

          const minutes = durationMinutes(next.duration);
          if (minutes != null && minutes > AUTO_MAX_MINUTES) {
            db.setAsrStatus(next.video_id, 'skipped', `longo demais (${minutes} min)`);
            continue;
          }
          // sem o áudio no celular e sem rede permitida → tenta mais tarde
          if (!findMedia(next.video_id, 'audio') && !canDownloadAudioNow(mode)) {
            set({ autoBlocked: 'network' });
            break;
          }

          if (!started) {
            started = true;
            holdKeepAlive('Preparando a transcrição automática…');
          }
          try {
            await pipeline(next.video_id, true);
            db.setAsrStatus(next.video_id, 'done');
          } catch (e) {
            if (e instanceof ModelMissingError) {
              set({ autoBlocked: 'model' });
              break;
            }
            if (isCanceled(e)) {
              // um pedido manual passou à frente → volta para a fila; parado por
              // você, pela rede ou porque o Mac entregou → não insiste nesta rodada
              const preempted = Object.values(get().jobs).some((j) => !j.auto);
              if (preempted && !stopped.has(next.video_id)) tried.delete(next.video_id);
            } else if (e instanceof NoSpeechError) {
              db.setAsrStatus(next.video_id, 'skipped', e.message);
            } else {
              // volta à fila depois de algumas horas (db.ASR_RETRY_MS), até db.ASR_MAX_TRIES
              db.setAsrStatus(next.video_id, 'failed', errorText(e));
              console.warn('[aspis] transcrição automática:', next.video_id, e);
            }
          } finally {
            setJob(next.video_id, null);
            set({ version: get().version + 1 });
          }
        }
      } finally {
        if (started) releaseKeepAlive();
        set({ autoRunning: false });
      }
    },

    setAuto: (mode) => {
      setAutoMode(mode);
      set({ autoMode: mode, autoBlocked: null });
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
            error: isCanceled(e) ? null : errorText(e),
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
