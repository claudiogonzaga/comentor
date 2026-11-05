// Transcrição nova → banco → triagem refeita. Um caminho só para as três
// origens: a legenda do YouTube achada depois, a transcrição no celular
// (Parakeet) e a que veio do Mac pelo Drive (desktopTranscripts.ts).
//
// Salva o texto, tira o vídeo da fila do celular e, se a nota era a provisória
// (só título/descrição), refaz score/pilar/síntese com o conteúdo real. A falha
// da IA não desfaz nada: o vídeo fica com a transcrição e a nota provisória, e
// retriagePending tenta de novo numa próxima passada.
import { claudeForTask } from '../../services/aiTasks';
import { useAppStore } from '../store/useAppStore';
import type { ContentSource, Transcript, TranscriptSource, VideoMeta, VideoRecord } from '../types';
import { analyzeTranscript, type BrainOptions } from './brain';
import * as db from './db';

export function metaOf(v: VideoRecord): VideoMeta {
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

/** Como a análise feita com essa transcrição se registra (content_source). */
export function contentSourceOf(source: TranscriptSource): ContentSource {
  return source === 'youtube' ? 'captions' : 'transcript';
}

/** As opções da IA do feed; null se não há chave (nem a do Gemini nem o Claude do feed). */
async function brainOptions(): Promise<BrainOptions | null> {
  const s = useAppStore.getState();
  if (!s.geminiKey && !(await claudeForTask('aspisFeed'))) return null;
  return {
    apiKey: s.geminiKey,
    model: s.model,
    pillars: s.pillars,
    rules: s.rules,
    noteLang: s.noteLang,
    learnedPrefs: s.learnedPrefs,
  };
}

/**
 * Refaz a triagem provisória de um vídeo com a transcrição. true = refeita;
 * false = não era provisória ou não há chave. Lança o erro da IA.
 */
export async function retriage(
  video: VideoRecord,
  transcript: Transcript,
  source: TranscriptSource,
  onAnalyzing?: () => void,
): Promise<boolean> {
  if (video.content_source !== 'metadata') return false;
  const opts = await brainOptions();
  if (!opts) return false;
  onAnalyzing?.();
  const analysis = await analyzeTranscript(metaOf(video), transcript, opts);
  // outra triagem pode ter chegado nesse meio-tempo
  if (db.getVideo(video.video_id)?.content_source !== 'metadata') return false;
  db.updateAnalysis(video.video_id, analysis, contentSourceOf(source));
  return true;
}

export interface ApplyOptions {
  /** false = só salva; a triagem fica para retriagePending (cota de chamadas por passada). */
  retriage?: boolean;
  /** Chamado quando a IA começa a refazer a triagem. */
  onAnalyzing?: () => void;
}

/**
 * Salva a transcrição do vídeo, marca a fila do celular como resolvida e refaz a
 * triagem se ela era a provisória. Nunca lança por causa da IA. true = triagem refeita.
 */
export async function applyTranscript(
  videoId: string,
  transcript: Transcript,
  source: TranscriptSource,
  options: ApplyOptions = {},
): Promise<boolean> {
  db.setTranscript(videoId, transcript, source);
  db.setAsrStatus(videoId, 'done');
  const video = db.getVideo(videoId);
  if (!video || options.retriage === false) return false;
  try {
    return await retriage(video, transcript, source, options.onAnalyzing);
  } catch (e) {
    console.warn('[aspis] refazer a triagem com a transcrição:', e);
    return false;
  }
}

// Tentativas por vídeo nesta sessão do app: um vídeo que a IA recusa sempre não
// gasta chamada a cada 15 min.
const tries = new Map<string, number>();
const MAX_TRIES = 2;
let sweeping = false;

/**
 * Vídeos que já têm transcrição mas ficaram com a nota provisória (a IA falhou
 * ou não havia chave quando a transcrição chegou): refaz até `limit` por passada.
 */
export async function retriagePending(limit = 5): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  let done = 0;
  try {
    if (!(await brainOptions())) return 0;
    const candidates = db
      .retriageCandidates(limit + tries.size)
      .filter((v) => (tries.get(v.video_id) ?? 0) < MAX_TRIES)
      .slice(0, limit);
    for (const v of candidates) {
      tries.set(v.video_id, (tries.get(v.video_id) ?? 0) + 1);
      const transcript: Transcript = {
        available: true,
        text: v.transcript_text || '',
        segments: db.getTranscriptSegments(v),
      };
      try {
        if (await retriage(v, transcript, v.transcript_source ?? 'youtube')) done++;
      } catch (e) {
        console.warn('[aspis] refazer a triagem pendente:', e);
      }
    }
    if (done) useAppStore.getState().bumpFeed();
    return done;
  } finally {
    sweeping = false;
  }
}
