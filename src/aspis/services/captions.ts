// Legendas públicas do YouTube (timedtext) sem API key: lê a página do vídeo,
// extrai as captionTracks do player e baixa a faixa em json3. É a camada (b)
// da análise — se falhar por qualquer motivo, devolve null e o brain cai para
// a camada de metadados.

import type { Transcript } from '../types';
import { msToTimestamp } from '../utils/duration';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string; // "asr" = gerada automaticamente
  vssId?: string;
}

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

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  // preferir legenda humana; senão a automática (asr)
  const human = tracks.find((t) => t.kind !== 'asr');
  return human || tracks[0];
}

interface Json3Event {
  tStartMs?: number;
  segs?: { utf8?: string }[];
}

export async function fetchTranscript(videoId: string): Promise<Transcript | null> {
  try {
    const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!page.ok) return null;
    const html = await page.text();

    const marker = '"captionTracks":';
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const arrText = extractJsonArray(html, idx + marker.length);
    if (!arrText) return null;

    const tracks: CaptionTrack[] = JSON.parse(arrText);
    const track = pickTrack(tracks);
    if (!track?.baseUrl) return null;

    const sep = track.baseUrl.includes('?') ? '&' : '?';
    const resp = await fetch(`${track.baseUrl}${sep}fmt=json3`, {
      headers: { 'User-Agent': UA },
    });
    if (!resp.ok) return null;
    const data: { events?: Json3Event[] } = await resp.json();

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

    const text = segments.map((s) => s.text).join(' ');
    return { available: true, text, segments };
  } catch {
    return null;
  }
}
