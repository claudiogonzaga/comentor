// Leitura das inscrições e dos vídeos novos via YouTube Data API v3 — port do
// pipeline de BAIXA QUOTA do youtube.py do desktop:
//   subscriptions (1u/página) → channels (1u/50) → playlistItems (1u) →
//   videos.list (1u/50). NUNCA usar search.list (100 unidades).

import type { VideoMeta, YtChannel } from '../types';
import { isoDurationToHuman } from '../utils/duration';

const API = 'https://www.googleapis.com/youtube/v3';

export class YouTubeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'YouTubeError';
    this.status = status;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function yt(
  path: string,
  params: Record<string, string | number | undefined>,
  token: string,
): Promise<Record<string, any>> {
  const resp = await fetch(`${API}/${path}?${qs(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let message = `YouTube API HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      if (err?.error?.message) message = err.error.message;
    } catch {
      // mantém genérica
    }
    throw new YouTubeError(message, resp.status);
  }
  return resp.json();
}

function chunks<T>(seq: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < seq.length; i += n) out.push(seq.slice(i, i + n));
  return out;
}

function thumbUrl(snippet: Record<string, any>): string {
  const thumbs = snippet?.thumbnails || {};
  return (thumbs.default || thumbs.medium || {}).url || '';
}

// Canal do YouTube da conta logada (o "selecionado") — title + avatar, como o
// desktop mostra no topo. mine=true devolve o canal padrão da conta.
export async function getMyChannel(token: string): Promise<YtChannel | null> {
  const resp = await yt('channels', { part: 'snippet', mine: 'true', maxResults: 1 }, token);
  const item = (resp.items || [])[0];
  if (!item) return null;
  const sn = item.snippet || {};
  const handle = sn.customUrl ? String(sn.customUrl) : '';
  return { id: item.id, title: sn.title || '', thumb: thumbUrl(sn), handle };
}

// channel_ids das inscrições do usuário (paginado).
export async function getSubscriptions(token: string): Promise<string[]> {
  const channelIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const resp = await yt(
      'subscriptions',
      { part: 'snippet', mine: 'true', maxResults: 50, pageToken },
      token,
    );
    for (const item of resp.items || []) {
      const cid = item?.snippet?.resourceId?.channelId;
      if (cid) channelIds.push(cid);
    }
    pageToken = resp.nextPageToken;
  } while (pageToken);
  return channelIds;
}

// channel_id → uploads playlist + channel_id → avatar. Lotes de 50.
export async function getUploadsAndThumbs(
  token: string,
  channelIds: string[],
): Promise<{ uploads: Record<string, string>; thumbs: Record<string, string> }> {
  const uploads: Record<string, string> = {};
  const thumbs: Record<string, string> = {};
  for (const batch of chunks(channelIds, 50)) {
    const resp = await yt(
      'channels',
      { part: 'contentDetails,snippet', id: batch.join(','), maxResults: 50 },
      token,
    );
    for (const item of resp.items || []) {
      const up = item?.contentDetails?.relatedPlaylists?.uploads;
      if (up) uploads[item.id] = up;
      const url = thumbUrl(item?.snippet || {});
      if (url) thumbs[item.id] = url;
    }
  }
  return { uploads, thumbs };
}

// IDs publicados depois de `sinceIso` numa uploads playlist (ordem decrescente
// de data → para na primeira mais antiga, como no desktop).
export async function getNewVideoIds(
  token: string,
  playlistId: string,
  sinceIso: string,
  maxVideos: number,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (true) {
    let resp: Record<string, any>;
    try {
      resp = await yt(
        'playlistItems',
        {
          part: 'snippet,contentDetails',
          playlistId,
          maxResults: maxVideos ? Math.min(50, maxVideos) : 50,
          pageToken,
        },
        token,
      );
    } catch (e) {
      // playlist vazia/canal sem uploads devolve 404 — ignora o canal
      if (e instanceof YouTubeError && e.status === 404) return ids;
      throw e;
    }
    let stop = false;
    for (const item of resp.items || []) {
      const published = item?.snippet?.publishedAt;
      const vid = item?.contentDetails?.videoId;
      if (!published || !vid) continue;
      if (published > sinceIso) ids.push(vid);
      else stop = true;
      if (maxVideos && ids.length >= maxVideos) {
        stop = true;
        break;
      }
    }
    pageToken = resp.nextPageToken;
    if (stop || !pageToken) break;
  }
  return ids;
}

// videos.list em lotes de 50 → metadados prontos para o brain.
export async function hydrate(token: string, videoIds: string[]): Promise<VideoMeta[]> {
  const out: VideoMeta[] = [];
  for (const batch of chunks(videoIds, 50)) {
    const resp = await yt(
      'videos',
      { part: 'snippet,contentDetails,statistics', id: batch.join(',') },
      token,
    );
    for (const item of resp.items || []) {
      const sn = item?.snippet || {};
      const cd = item?.contentDetails || {};
      out.push({
        video_id: item.id,
        title: sn.title || '',
        channel: sn.channelTitle || '',
        channel_id: sn.channelId || '',
        description: sn.description || '',
        published_at: sn.publishedAt || '',
        duration: isoDurationToHuman(cd.duration || ''),
        url: `https://www.youtube.com/watch?v=${item.id}`,
        channel_thumb: '',
      });
    }
  }
  return out;
}

export async function getVideoDetails(token: string, videoId: string): Promise<VideoMeta | null> {
  const list = await hydrate(token, [videoId]);
  return list[0] ?? null;
}
