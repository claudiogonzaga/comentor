// Síntese de voz via Gemini 2.5 Flash Preview TTS.
//
// O modelo retorna PCM 16-bit LE mono em 24 kHz como base64. Para que o
// expo-audio player consiga reproduzir, montamos um cabeçalho WAV (44
// bytes) na frente do PCM e salvamos como arquivo no diretório de cache.
//
// O cache é trivial: nome do arquivo é hash do (texto + voz). Frases
// idênticas no preview reutilizam o áudio sem nova chamada. Para o chat,
// onde quase nunca há repetição, isso só não atrapalha.

import { File, Paths } from 'expo-file-system';
import { getApiKey } from './secureStore';

const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/** Vozes pré-construídas disponíveis na API. A descrição é referencial. */
export interface GeminiVoice {
  name: string; // o id usado na API (case-sensitive)
  label: string;
  gender: 'female' | 'male';
  description: string;
}

export const GEMINI_VOICES: GeminiVoice[] = [
  { name: 'Aoede', label: 'Aoede', gender: 'female', description: 'feminina, leve e expressiva' },
  { name: 'Kore', label: 'Kore', gender: 'female', description: 'feminina, casual e direta' },
  { name: 'Leda', label: 'Leda', gender: 'female', description: 'feminina, jovem e alegre' },
  { name: 'Zephyr', label: 'Zephyr', gender: 'female', description: 'feminina, suave e calma' },
  { name: 'Charon', label: 'Charon', gender: 'male', description: 'masculina, articulada e neutra' },
  { name: 'Puck', label: 'Puck', gender: 'male', description: 'masculina, leve e simpática' },
  { name: 'Fenrir', label: 'Fenrir', gender: 'male', description: 'masculina, firme e grave' },
  { name: 'Orus', label: 'Orus', gender: 'male', description: 'masculina, calma e ponderada' },
];

export const DEFAULT_GEMINI_VOICE = 'Aoede';

function base64ToBytes(b64: string): Uint8Array {
  // atob está disponível em RN 0.74+ (Hermes runtime). O app está em RN 0.81.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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
  writeU16(1); // PCM
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

export interface GeminiTTSResult {
  /** file:// URI passável para o expo-audio. */
  uri: string;
  /** true se o áudio veio do cache local (mesma frase + voz). */
  cached: boolean;
}

export class GeminiTTSError extends Error {
  readonly httpStatus?: number;
  readonly quotaExceeded: boolean;
  constructor(message: string, opts: { httpStatus?: number; quotaExceeded?: boolean } = {}) {
    super(message);
    this.name = 'GeminiTTSError';
    this.httpStatus = opts.httpStatus;
    this.quotaExceeded = !!opts.quotaExceeded;
  }
}

/**
 * Gera o áudio TTS para o texto. Lança `GeminiTTSError` em falha (sem chave,
 * cota esgotada, erro de rede). O caller decide o fallback (ex: cair para
 * expo-speech).
 */
export async function synthesizeSpeechGemini(
  text: string,
  voiceName: string = DEFAULT_GEMINI_VOICE,
): Promise<GeminiTTSResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new GeminiTTSError('texto vazio');
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiTTSError('Sem chave do Gemini — configure em "Como você quer usar?"');
  }

  const cacheKey = shortHash(`${voiceName}:${trimmed}`);
  const file = new File(Paths.cache, `gemini_tts_${cacheKey}.wav`);
  if (file.exists) {
    return { uri: file.uri, cached: true };
  }

  const url = `${TTS_URL}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: trimmed }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : 'erro de rede';
    throw new GeminiTTSError(`Gemini TTS: ${msg}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    const msg = j.error?.message ?? `HTTP ${res.status}`;
    throw new GeminiTTSError(`Gemini TTS: ${msg}`, {
      httpStatus: res.status,
      quotaExceeded: res.status === 429,
    });
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  };
  const audioBase64 = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioBase64) {
    throw new GeminiTTSError('Gemini TTS: resposta sem áudio');
  }

  const pcm = base64ToBytes(audioBase64);
  const wav = pcmToWav(pcm);
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, cached: false };
}
