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
import { getSavedAudioUris } from './database';

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

// Tabela de decodificação base64. Aceita o alfabeto padrão (+/) E o URL-safe
// (-_); os demais bytes (incl. '=', espaços, quebras de linha) ficam -1.
const B64_LUT: Int8Array = (() => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i;
  t[45] = 62; // '-' (URL-safe)
  t[95] = 63; // '_' (URL-safe)
  return t;
})();

/**
 * Decodifica base64 em bytes SEM depender do `atob` global. O `atob` do Hermes
 * é estrito (quebra com padding ausente / alfabeto URL-safe), e a saída do
 * Gemini TTS às vezes não passa nessa validação — fazia a síntese falhar
 * silenciosamente (e cair na voz do sistema). Este decodificador é tolerante:
 * ignora qualquer caractere fora do alfabeto e não exige padding.
 */
function base64ToBytes(b64: string): Uint8Array {
  const lut = B64_LUT;
  let validLen = 0;
  for (let i = 0; i < b64.length; i++) {
    if (lut[b64.charCodeAt(i) & 0xff] >= 0) validLen++;
  }
  const out = new Uint8Array(Math.floor((validLen * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = lut[b64.charCodeAt(i) & 0xff];
    if (v < 0) continue; // ignora '=', espaços, quebras, etc.
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
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
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Timeout por chamada de TTS. Gerar áudio longo leva tempo — 30s era curto e
 *  abortava ("Gemini TTS: Aborted"). */
const TTS_TIMEOUT_MS = 90000;
/**
 * Re-tentativas para erros TRANSITÓRIOS: 429 (limite), 5xx (ex.: "An internal
 * error has occurred. Please retry" — erro interno do servidor do Gemini),
 * timeout/rede, e resposta 200 sem áudio.
 *
 * Por que isso importa: o 500 do Gemini TTS é INTERMITENTE. Numa leitura de ~24
 * trechos, basta UM trecho pegar um 500 transitório para a leitura inteira
 * falhar. Se cada trecho tem ~10% de chance de 500, a chance de ao menos um
 * falhar em 24 é ~92%. Re-tentando com backoff, a chance de falha por trecho
 * cai para ~0,0001% — e a leitura completa passa a (quase) sempre concluir.
 */
const MAX_RETRIES = 6;

/** Status HTTP transitórios que vale a pena re-tentar (limite + erro do servidor). */
function isRetryableStatus(s: number): boolean {
  return s === 429 || (s >= 500 && s < 600);
}
/** Backoff exponencial com teto: 2s, 4s, 8s, 16s, 30s, 30s. */
function retryDelayMs(attempt: number): number {
  return Math.min(30000, 2000 * Math.pow(2, attempt));
}

/**
 * Faz a chamada à API e devolve o PCM (24kHz mono 16-bit) do trecho. Re-tenta
 * (com backoff) em TODOS os erros transitórios — 429 (limite), 5xx (erro
 * interno do servidor), timeout/rede e resposta 200 sem áudio — em vez de
 * desistir de cara. Só erros 4xx "de verdade" (chave inválida etc.) são fatais.
 */
async function fetchPcm(
  text: string,
  voiceName: string,
  apiKey: string,
  attempt = 0,
): Promise<Uint8Array> {
  const url = `${TTS_URL}?key=${encodeURIComponent(apiKey)}`;
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
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Timeout (abort) ou rede instável — transiente. Tenta de novo com backoff
    // antes de desistir (em vez de cair na voz do sistema na primeira falha).
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      return fetchPcm(text, voiceName, apiKey, attempt + 1);
    }
    const msg = err instanceof Error ? err.message : 'erro de rede';
    throw new GeminiTTSError(`Gemini TTS: ${msg}`);
  }
  clearTimeout(timer);

  // 429 (limite) ou 5xx ("An internal error has occurred. Please retry") são
  // transitórios do servidor → espera e re-tenta, em vez de derrubar a leitura.
  if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
    let delay = retryDelayMs(attempt);
    if (res.status === 429) {
      const ra = parseFloat(res.headers.get('retry-after') ?? '');
      delay =
        Number.isFinite(ra) && ra > 0
          ? Math.min(65000, ra * 1000)
          : Math.min(60000, 12000 * Math.pow(2, attempt));
    }
    await sleep(delay);
    return fetchPcm(text, voiceName, apiKey, attempt + 1);
  }

  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
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
    // 200 mas sem áudio — também é uma falha transitória; re-tenta antes de desistir.
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      return fetchPcm(text, voiceName, apiKey, attempt + 1);
    }
    throw new GeminiTTSError('Gemini TTS: resposta sem áudio');
  }
  return base64ToBytes(audioBase64);
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

  const pcm = await fetchPcm(trimmed, voiceName, apiKey);
  const wav = pcmToWav(pcm);
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, cached: false };
}

/**
 * Limpa áudios de leitura AD-HOC (não salvos), mantendo no máximo `keep` mais
 * recentes. NUNCA apaga áudios amarrados a textos salvos (esses são guardados
 * para sempre e só somem quando o texto é excluído). Best-effort.
 */
async function cleanupReadAloudCache(keep = 6): Promise<void> {
  let protectedSet: Set<string>;
  try {
    protectedSet = new Set(await getSavedAudioUris());
  } catch {
    // Sem saber o que proteger, não apaga nada (evita perder áudio salvo).
    return;
  }
  try {
    const entries = Paths.document.list();
    const files = entries.filter(
      (e): e is File =>
        e instanceof File && e.name.startsWith('readaloud_') && e.name.endsWith('.wav'),
    );
    const unprotected = files.filter((f) => !protectedSet.has(f.uri));
    if (unprotected.length <= keep) return;
    unprotected
      .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
      .slice(0, unprotected.length - keep)
      .forEach((f) => {
        try {
          f.delete();
        } catch {
          /* ignore */
        }
      });
  } catch {
    /* limpeza é best-effort */
  }
}

/**
 * Sintetiza o texto INTEIRO (recebido já fatiado em `chunks`) e concatena o
 * PCM de todos os trechos num ÚNICO arquivo WAV salvo em disco (persistente).
 * Resultado: a leitura toca sem as pausas de rede entre os trechos, e fica
 * "baixada" — na 2ª vez retorna o arquivo do cache na hora. `onProgress`
 * reporta o andamento da geração (só na 1ª vez).
 */
export async function synthesizeFullSpeechGemini(
  chunks: string[],
  voiceName: string = DEFAULT_GEMINI_VOICE,
  onProgress?: (done: number, total: number) => void,
): Promise<GeminiTTSResult> {
  const clean = chunks.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) throw new GeminiTTSError('texto vazio');
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiTTSError('Sem chave do Gemini — configure em "Como você quer usar?"');
  }

  const cacheKey = shortHash(`${voiceName}:full:${clean.join('')}`);
  const file = new File(Paths.document, `readaloud_${cacheKey}.wav`);
  if (file.exists) {
    return { uri: file.uri, cached: true };
  }

  // Ritmo (Tier 1 do TTS: 10 req/min e 10.000 tokens/min). Mantemos uma janela
  // deslizante de 60s e só disparamos o próximo trecho quando ele couber nos
  // dois limites — assim textos longos não tomam 429 por rajada.
  const TTS_RPM = 10;
  const TTS_TPM = 10000;
  const estTokens = (chars: number) => Math.ceil(chars * 1.9) + 50;
  const sentAt: number[] = [];
  const sentTok: number[] = [];
  const waitForCapacity = async (need: number) => {
    for (;;) {
      const now = Date.now();
      while (sentAt.length && now - sentAt[0] > 60000) {
        sentAt.shift();
        sentTok.shift();
      }
      const toks = sentTok.reduce((a, b) => a + b, 0);
      if (sentAt.length < TTS_RPM - 1 && toks + need <= TTS_TPM - 500) break;
      const wait = sentAt.length ? 60000 - (now - sentAt[0]) + 300 : 1000;
      await sleep(Math.max(300, wait));
    }
  };

  const pcms: Uint8Array[] = [];
  let totalLen = 0;
  for (let i = 0; i < clean.length; i++) {
    onProgress?.(i, clean.length);
    const need = estTokens(clean[i].length);
    await waitForCapacity(need);
    sentAt.push(Date.now());
    sentTok.push(need);
    const pcm = await fetchPcm(clean[i], voiceName, apiKey);
    pcms.push(pcm);
    totalLen += pcm.length;
  }
  onProgress?.(clean.length, clean.length);

  const allPcm = new Uint8Array(totalLen);
  let off = 0;
  for (const p of pcms) {
    allPcm.set(p, off);
    off += p.length;
  }
  const wav = pcmToWav(allPcm);
  await cleanupReadAloudCache();
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, cached: false };
}
