// Síntese de voz via Gemini 2.5 Flash Preview TTS — portado do CoMentor.
//
// O modelo devolve PCM 16-bit LE mono a 24 kHz em base64. Para o expo-audio
// tocar, montamos um cabeçalho WAV (44 bytes) na frente do PCM e salvamos no
// cache. O cache é por (voz + texto): ler o mesmo resumo de novo é grátis.
//
// A chave do Gemini chega por parâmetro (vem do store do app). Em falha, lança
// GeminiTTSError e o caller decide o fallback.

import { File, Paths } from 'expo-file-system';

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/** Vozes pré-construídas da API. A descrição é referencial. */
export interface GeminiVoice {
  name: string; // id usado na API (case-sensitive)
  label: string;
  gender: 'female' | 'male';
  description: string;
}

export const GEMINI_VOICES: GeminiVoice[] = [
  { name: 'Aoede', label: 'Aoede', gender: 'female', description: 'leve e expressiva' },
  { name: 'Kore', label: 'Kore', gender: 'female', description: 'casual e direta' },
  { name: 'Leda', label: 'Leda', gender: 'female', description: 'jovem e alegre' },
  { name: 'Zephyr', label: 'Zephyr', gender: 'female', description: 'suave e calma' },
  { name: 'Charon', label: 'Charon', gender: 'male', description: 'articulada e neutra' },
  { name: 'Puck', label: 'Puck', gender: 'male', description: 'leve e simpática' },
  { name: 'Fenrir', label: 'Fenrir', gender: 'male', description: 'firme e grave' },
  { name: 'Orus', label: 'Orus', gender: 'male', description: 'calma e ponderada' },
];

export const DEFAULT_GEMINI_VOICE = 'Aoede';

export function isValidVoice(name: string): boolean {
  return GEMINI_VOICES.some((v) => v.name === name);
}

export class GeminiTTSError extends Error {
  readonly isKeyError: boolean;
  constructor(message: string, isKeyError = false) {
    super(message);
    this.name = 'GeminiTTSError';
    this.isKeyError = isKeyError;
  }
}

// --- base64 → bytes (tolerante; não depende do atob do Hermes) ---------------
const B64_LUT: Int8Array = (() => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i;
  t[45] = 62; // '-' URL-safe
  t[95] = 63; // '_' URL-safe
  return t;
})();

function base64ToBytes(b64: string): Uint8Array {
  const lut = B64_LUT;
  let validLen = 0;
  for (let i = 0; i < b64.length; i++) if (lut[b64.charCodeAt(i) & 0xff] >= 0) validLen++;
  const out = new Uint8Array(Math.floor((validLen * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = lut[b64.charCodeAt(i) & 0xff];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

// --- WAV ---------------------------------------------------------------------
function buildWavHeader(pcmByteLength: number): Uint8Array {
  const header = new Uint8Array(44);
  const dv = new DataView(header.buffer);
  let off = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) header[off++] = s.charCodeAt(i);
  };
  const writeU32 = (v: number) => {
    dv.setUint32(off, v, true);
    off += 4;
  };
  const writeU16 = (v: number) => {
    dv.setUint16(off, v, true);
    off += 2;
  };
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  writeStr('RIFF');
  writeU32(36 + pcmByteLength);
  writeStr('WAVE');
  writeStr('fmt ');
  writeU32(16);
  writeU16(1);
  writeU16(CHANNELS);
  writeU32(SAMPLE_RATE);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(BITS_PER_SAMPLE);
  writeStr('data');
  writeU32(pcmByteLength);
  return header;
}

function pcmToWav(pcm: Uint8Array): Uint8Array {
  const header = buildWavHeader(pcm.length);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header, 0);
  wav.set(pcm, header.length);
  return wav;
}

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// --- ritmo (RPM) + retry de erros transitórios -------------------------------
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const TTS_TIMEOUT_MS = 90000;
const MAX_RETRIES = 5;
const RPM_LIMIT = 9; // Tier 1 = 10 RPM; margem de 1
const rpmWindow: number[] = [];

async function acquireRpmSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (rpmWindow.length && (now - rpmWindow[0] > 60000 || rpmWindow[0] > now)) rpmWindow.shift();
    if (rpmWindow.length < RPM_LIMIT) {
      rpmWindow.push(now);
      return;
    }
    await sleep(Math.min(60250, Math.max(250, 60000 - (now - rpmWindow[0]) + 250)));
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(30000, 2000 * Math.pow(2, attempt));
}

async function fetchPcm(
  text: string,
  voiceName: string,
  apiKey: string,
  attempt = 0,
): Promise<Uint8Array> {
  await acquireRpmSlot();
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      return fetchPcm(text, voiceName, apiKey, attempt + 1);
    }
    throw new GeminiTTSError(`Gemini TTS: ${err instanceof Error ? err.message : 'erro de rede'}`);
  }
  clearTimeout(timer);

  // 5xx e 429 são transitórios → re-tenta com backoff.
  if ((res.status >= 500 || res.status === 429) && attempt < MAX_RETRIES) {
    await sleep(retryDelayMs(attempt));
    return fetchPcm(text, voiceName, apiKey, attempt + 1);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = j.error?.message ?? `HTTP ${res.status}`;
    const isKey = res.status === 401 || res.status === 403 || /api key/i.test(msg);
    throw new GeminiTTSError(`Gemini TTS: ${msg}`, isKey);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const audioBase64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioBase64) {
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      return fetchPcm(text, voiceName, apiKey, attempt + 1);
    }
    throw new GeminiTTSError('Gemini TTS: resposta sem áudio');
  }
  return base64ToBytes(audioBase64);
}

// Quebra textos longos em trechos por frase (a API tem limite por chamada). Um
// resumo curto vira um único trecho.
function chunkText(text: string, maxLen = 600): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export interface GeminiTTSResult {
  uri: string; // file:// passável ao expo-audio
  cached: boolean;
}

/**
 * Sintetiza `text` na `voiceName` e devolve um WAV em cache. Gera trecho a
 * trecho (frases) e concatena num único arquivo. Lança GeminiTTSError em falha.
 */
export async function synthesizeSpeech(
  text: string,
  voiceName: string,
  apiKey: string,
): Promise<GeminiTTSResult> {
  if (!apiKey) throw new GeminiTTSError('Sem chave do Gemini — configure em Configurações.', true);
  const voice = isValidVoice(voiceName) ? voiceName : DEFAULT_GEMINI_VOICE;
  const chunks = chunkText(text);
  if (!chunks.length) throw new GeminiTTSError('texto vazio');

  const cacheKey = shortHash(`${voice}:${chunks.join('')}`);
  const file = new File(Paths.cache, `aspis_tts_${cacheKey}.wav`);
  if (file.exists) return { uri: file.uri, cached: true };

  const pcms: Uint8Array[] = [];
  let total = 0;
  for (const c of chunks) {
    const pcm = await fetchPcm(c, voice, apiKey);
    pcms.push(pcm);
    total += pcm.length;
  }
  const allPcm = new Uint8Array(total);
  let off = 0;
  for (const p of pcms) {
    allPcm.set(p, off);
    off += p.length;
  }
  const wav = pcmToWav(allPcm);
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, cached: false };
}
