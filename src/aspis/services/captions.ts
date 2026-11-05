// Legendas públicas do YouTube (timedtext) sem API key. É a camada (b) da
// análise e o primeiro passo da transcrição — se falhar por qualquer motivo,
// devolve null e o brain cai para a camada de metadados.
//
// O YouTube passou a exigir um token de prova de origem (pot) nas faixas que a
// página do vídeo lista para o navegador: elas vêm com exp=xpe e o timedtext
// responde 200 com o corpo VAZIO. Com isso, quase todo vídeo caía na nota
// provisória e dependia do áudio + Parakeet. O player do InnerTube com o
// cliente do app Android (o caminho do youtube-transcript-api) devolve as
// faixas sem essa exigência; a página fica como reserva.

import type { Transcript } from '../types';
import { msToTimestamp } from '../utils/duration';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PLAYER = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const CLIENTS = [
  {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  },
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)',
  },
];

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string; // "asr" = gerada automaticamente
  vssId?: string;
}

// Faixas de um jeito de perguntar: null = esse jeito não funcionou (tente o
// próximo); [] = o vídeo não tem legenda. `spoken`: o idioma do áudio original,
// quando o player diz (vídeo dublado tem uma legenda automática por áudio).
type TrackSource = { tracks: CaptionTrack[] | null; userAgent: string; spoken?: string };

// Extrai um array JSON balanceado a partir de um índice (respeitando strings
// e escapes) — regex não-gulosa quebra com arrays aninhados dentro de "name".
function extractJsonArray(html: string, startIdx: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = startIdx; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++; // pula o caractere escapado
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return html.slice(startIdx, i + 1);
    }
  }
  return null;
}

const lang = (t: CaptionTrack) => (t.languageCode || '').split('-')[0].toLowerCase();

// A legenda humana no idioma FALADO; senão a automática dele; senão a primeira
// humana. (A primeira humana da lista costuma ser uma tradução, e o vídeo dublado
// traz a automática do áudio dublado antes da do original.)
function pickTrack(tracks: CaptionTrack[], spokenHint?: string): CaptionTrack | null {
  if (!tracks.length) return null;
  const asrs = tracks.filter((t) => t.kind === 'asr');
  const human = tracks.filter((t) => t.kind !== 'asr');
  const spoken = spokenHint || (asrs[0] ? lang(asrs[0]) : '');
  return (
    (spoken && human.find((t) => lang(t) === spoken)) ||
    (spoken && asrs.find((t) => lang(t) === spoken)) ||
    asrs[0] ||
    human[0] ||
    tracks[0]
  );
}

// "pt-BR.4" (o id da faixa de áudio padrão = a original) → "pt".
function spokenLanguage(renderer: {
  audioTracks?: { audioTrackId?: string }[];
  defaultAudioTrackIndex?: number;
}): string | undefined {
  const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0];
  const id = audio?.audioTrackId?.split('.')[0];
  return id ? id.split('-')[0].toLowerCase() : undefined;
}

async function tracksFromPlayer(
  videoId: string,
  client: (typeof CLIENTS)[number],
): Promise<TrackSource> {
  try {
    const resp = await fetch(PLAYER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': client.userAgent },
      body: JSON.stringify({
        context: { client: { clientName: client.clientName, clientVersion: client.clientVersion, hl: 'en' } },
        videoId,
      }),
    });
    if (!resp.ok) return { tracks: null, userAgent: client.userAgent };
    const data = await resp.json();
    if (data?.playabilityStatus?.status !== 'OK') return { tracks: null, userAgent: client.userAgent };
    const renderer = data?.captions?.playerCaptionsTracklistRenderer;
    const tracks = renderer?.captionTracks;
    return {
      tracks: Array.isArray(tracks) ? tracks : [],
      userAgent: client.userAgent,
      spoken: spokenLanguage(renderer),
    };
  } catch {
    return { tracks: null, userAgent: client.userAgent };
  }
}

async function tracksFromPage(videoId: string): Promise<TrackSource> {
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!page.ok) return { tracks: null, userAgent: UA };
    const html = await page.text();
    const marker = '"captionTracks":';
    const idx = html.indexOf(marker);
    if (idx === -1) return { tracks: [], userAgent: UA };
    const arrText = extractJsonArray(html, idx + marker.length);
    return { tracks: arrText ? (JSON.parse(arrText) as CaptionTrack[]) : null, userAgent: UA };
  } catch {
    return { tracks: null, userAgent: UA };
  }
}

interface Json3Event {
  tStartMs?: number;
  segs?: { utf8?: string }[];
}

async function download(track: CaptionTrack, userAgent: string): Promise<Transcript | null> {
  try {
    const base = track.baseUrl.replace(/([?&])fmt=[^&]*&?/, '$1').replace(/[?&]$/, '');
    const sep = base.includes('?') ? '&' : '?';
    const resp = await fetch(`${base}${sep}fmt=json3`, { headers: { 'User-Agent': userAgent } });
    if (!resp.ok) return null;
    const body = await resp.text();
    if (!body.trim()) return null; // 200 vazio = faltou o token (pot)
    const data: { events?: Json3Event[] } = JSON.parse(body);

    const segments: { ts: string; text: string }[] = [];
    for (const ev of data.events || []) {
      const text = (ev.segs || [])
        .map((s) => s.utf8 || '')
        .join('')
        .replace(/\n/g, ' ')
        .trim();
      if (!text) continue;
      segments.push({ ts: msToTimestamp(ev.tStartMs || 0), text });
    }
    if (!segments.length) return null;
    return { available: true, text: segments.map((s) => s.text).join(' '), segments };
  } catch {
    return null;
  }
}

export async function fetchTranscript(videoId: string): Promise<Transcript | null> {
  const sources: (() => Promise<TrackSource>)[] = [
    ...CLIENTS.map((c) => () => tracksFromPlayer(videoId, c)),
    () => tracksFromPage(videoId),
  ];
  for (const next of sources) {
    const { tracks, userAgent, spoken } = await next();
    if (tracks === null) continue; // esse jeito falhou: tenta o próximo
    if (!tracks.length) return null; // o player respondeu: o vídeo não tem legenda
    const track = pickTrack(tracks, spoken);
    if (!track?.baseUrl) continue;
    const transcript = await download(track, userAgent);
    if (transcript) return transcript;
  }
  return null;
}
