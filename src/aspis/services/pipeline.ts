// Pipeline do feed (botão Atualizar / pull-to-refresh): inscrições → uploads
// playlists → vídeos novos do período → análise IA → banco. Vídeos já
// analisados não são reprocessados (cache por video_id, como o desktop).

import {
  MAX_LOOKBACK_HOURS,
  MAX_VIDEOS_PER_CHANNEL,
  MAX_VIDEOS_PER_RUN,
  PERIODS,
  starsToThreshold,
} from '../constants/defaults';
import type { Period } from '../types';
import { analyze, type BrainOptions, GeminiError, NoGeminiKeyError } from './brain';
import * as db from './db';
import {
  getNewVideoIds,
  getSubscriptions,
  getUploadsAndThumbs,
  hydrate,
} from './youtube';

export interface RefreshProgress {
  stage: 'subs' | 'playlists' | 'analyzing';
  done: number;
  total: number;
}

export interface RefreshResult {
  processed: number;
  errors: number;
  above: number; // acima do limiar de estrelas atual
  skippedCached: number; // já estavam no banco
  capped: number; // ficaram para a próxima execução (limite por rodada)
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function refreshFeed(
  token: string,
  brain: BrainOptions,
  period: Period,
  minStars: number,
  onProgress?: (p: RefreshProgress) => void,
): Promise<RefreshResult> {
  // Janela de busca = o período OU desde a última execução, o que for maior:
  // se o app ficou dias fechado com o período "Dia", os vídeos desses dias
  // não podem ser pulados para sempre (cache por video_id evita reprocessar).
  const lastRun = Date.parse(db.getMeta('last_run') || '');
  const lookbackMs = Math.min(
    MAX_LOOKBACK_HOURS * 3600 * 1000,
    Math.max(PERIODS[period] * 3600 * 1000, Number.isFinite(lastRun) ? Date.now() - lastRun : 0),
  );
  const sinceIso = new Date(Date.now() - lookbackMs).toISOString();

  onProgress?.({ stage: 'subs', done: 0, total: 0 });
  const channelIds = await getSubscriptions(token);
  const { uploads, thumbs } = await getUploadsAndThumbs(token, channelIds);

  // canais silenciados (L1) nem são consultados — economiza quota e some do feed
  const muted = new Set(db.mutedChannelIds());
  const playlists = Object.entries(uploads)
    .filter(([channelId]) => !muted.has(channelId))
    .map(([, playlistId]) => playlistId);
  let listed = 0;
  const idLists = await mapLimit(playlists, 5, async (playlistId) => {
    const ids = await getNewVideoIds(token, playlistId, sinceIso, MAX_VIDEOS_PER_CHANNEL);
    onProgress?.({ stage: 'playlists', done: ++listed, total: playlists.length });
    return ids;
  });

  // dedup preservando ordem
  const seen = new Set<string>();
  const newIds = idLists.flat().filter((id) => !seen.has(id) && (seen.add(id), true));

  const fresh = newIds.filter((id) => !db.hasVideo(id));
  const skippedCached = newIds.length - fresh.length;
  const toProcess = fresh.slice(0, MAX_VIDEOS_PER_RUN);
  const capped = fresh.length - toProcess.length;

  const videos = await hydrate(token, toProcess);
  const threshold = starsToThreshold(minStars);

  let processed = 0;
  let errors = 0;
  let above = 0;
  let done = 0;
  let abort: unknown = null;

  await mapLimit(videos, 2, async (video) => {
    if (abort) return;
    try {
      const meta = { ...video, channel_thumb: thumbs[video.channel_id] || '' };
      // mesmo caminho do desktop: transcrição → metadados (sem fileUri no
      // feed — analisar ~25 vídeos "assistindo" cada um seria lento demais)
      const r = await analyze(meta, brain, false);
      db.upsertVideo({
        ...meta,
        ...r.analysis,
        original_title: meta.title,
        transcript_available: r.transcript?.available ? 1 : 0,
        content_source: r.source,
        transcript_text: r.transcript?.text ?? null,
      });
      processed++;
      if (r.analysis.score >= threshold) above++;
    } catch (e) {
      // sem chave (ou chave inválida) não adianta continuar a rodada
      if (e instanceof NoGeminiKeyError || (e instanceof GeminiError && e.isKeyError)) {
        abort = e;
        return;
      }
      errors++;
    } finally {
      onProgress?.({ stage: 'analyzing', done: ++done, total: videos.length });
    }
  });
  if (abort) throw abort;

  db.setMeta('last_run', db.nowIso());
  return { processed, errors, above, skippedCached, capped };
}
