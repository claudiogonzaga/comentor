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
  /** true quando o 429 é o limite DIÁRIO (RPD) — não adianta re-tentar hoje. */
  readonly dailyQuota: boolean;
  constructor(
    message: string,
    opts: { httpStatus?: number; quotaExceeded?: boolean; dailyQuota?: boolean } = {},
  ) {
    super(message);
    this.name = 'GeminiTTSError';
    this.httpStatus = opts.httpStatus;
    this.quotaExceeded = !!opts.quotaExceeded;
    this.dailyQuota = !!opts.dailyQuota;
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

/** Backoff exponencial com teto: 2s, 4s, 8s, 16s, 30s, 30s. */
function retryDelayMs(attempt: number): number {
  return Math.min(30000, 2000 * Math.pow(2, attempt));
}

/**
 * Limitador de REQUISIÇÕES POR MINUTO. O gargalo real do TTS é RPM, não TPM (a
 * doc conta TPM só por ENTRADA, e o áudio de saída não entra). Tier 1 = 10 RPM;
 * usamos margem de 9 numa janela deslizante de 60s. GLOBAL: vale para TODAS as
 * chamadas (leitura progressiva, salvar, trecho único) — evita o 429 por rajada
 * (ex.: o buffer de look-ahead disparando vários trechos juntos no início).
 */
const RPM_LIMIT = 9;
const rpmWindow: number[] = [];
async function acquireRpmSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    // Descarta entradas velhas (>60s) E do FUTURO (relógio recuou via NTP/ajuste
    // manual) — sem o segundo caso, um recuo congelaria o trecho por todo o recuo.
    while (rpmWindow.length && (now - rpmWindow[0] > 60000 || rpmWindow[0] > now)) {
      rpmWindow.shift();
    }
    if (rpmWindow.length < RPM_LIMIT) {
      rpmWindow.push(now);
      return;
    }
    // Espera limitada à janela (teto de ~60s) por segurança.
    const wait = Math.min(60250, Math.max(250, 60000 - (now - rpmWindow[0]) + 250));
    await sleep(wait);
  }
}

/**
 * Quando o limite DIÁRIO (RPD) estoura, não adianta re-tentar hoje — só reseta à
 * meia-noite no Pacífico. Guardamos até quando bloquear o Gemini (e cair para a
 * voz do sistema) sem nem bater na API. Sem depender de Intl/timezone no Hermes,
 * usamos a próxima 07:00 UTC (= meia-noite PDT). No PST destrava ~1h antes do
 * reset real, e se ainda estiver esgotado a própria API re-bloqueia com 1 chamada
 * — assim NUNCA sobre-bloqueia além do reset.
 */
let dailyBlockUntil = 0;
function nextPacificMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(7, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

/** Distingue um 429 DIÁRIO (RPD) de um POR-MINUTO (RPM/TPM) pelos detalhes do erro. */
function classify429(body: unknown): { daily: boolean; retryMs: number } {
  let s = '';
  try {
    s = JSON.stringify((body as { error?: { details?: unknown } })?.error?.details ?? []);
  } catch {
    s = '';
  }
  const perDay = /PerDay|per day|RequestsPerDay/i.test(s);
  const perMinute = /PerMinute|per minute/i.test(s);
  const m = s.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  const retryMs = m ? Math.min(65000, Math.ceil(parseFloat(m[1]) * 1000) + 500) : 0;
  // Bloqueia o DIA só com EVIDÊNCIA POSITIVA de RPD (a violação cita "PerDay").
  // Se vierem PerDay e PerMinute juntos, o diário manda (não adianta re-tentar
  // hoje). Um 429 sem details/ilegível (infra/borda, body não-JSON) → daily=false
  // → cai no retry LIMITADO, em vez de bloquear o Gemini o dia inteiro por engano.
  const daily = perDay;
  return { daily, retryMs };
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
  // Bloqueio diário (RPD) ativo? Nem chama a API — cai direto para o fallback.
  if (dailyBlockUntil && Date.now() < dailyBlockUntil) {
    throw new GeminiTTSError('Gemini TTS: cota diária da API esgotada', {
      httpStatus: 429,
      quotaExceeded: true,
      dailyQuota: true,
    });
  }
  // Ritma para não estourar os 10 RPM (gargalo real do TTS). Adquire um slot em
  // TODA requisição — inclusive cada retry, que é uma nova requisição.
  await acquireRpmSlot();
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

  // 5xx ("An internal error has occurred. Please retry") é transitório → re-tenta.
  if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES) {
    await sleep(retryDelayMs(attempt));
    return fetchPcm(text, voiceName, apiKey, attempt + 1);
  }

  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    // 429: distinguir DIÁRIO (RPD — não re-tentar hoje; bloqueia e cai para o
    // sistema) de POR-MINUTO (RPM/TPM — transitório, re-tenta com o delay certo).
    if (res.status === 429) {
      const { daily, retryMs } = classify429(j);
      if (daily) {
        dailyBlockUntil = nextPacificMidnight();
        throw new GeminiTTSError(
          'Gemini TTS: cota diária da API esgotada — reseta à meia-noite no Pacífico',
          { httpStatus: 429, quotaExceeded: true, dailyQuota: true },
        );
      }
      if (attempt < MAX_RETRIES) {
        const ra = parseFloat(res.headers.get('retry-after') ?? '');
        const delay =
          retryMs > 0
            ? retryMs
            : Number.isFinite(ra) && ra > 0
              ? Math.min(65000, ra * 1000)
              : Math.min(60000, 12000 * Math.pow(2, attempt));
        await sleep(delay);
        return fetchPcm(text, voiceName, apiKey, attempt + 1);
      }
    }
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

  // O ritmo (RPM) agora é GLOBAL, dentro de fetchPcm (acquireRpmSlot), e vale
  // para todos os caminhos. Aqui é só gerar em série e concatenar.
  const pcms: Uint8Array[] = [];
  let totalLen = 0;
  for (let i = 0; i < clean.length; i++) {
    onProgress?.(i, clean.length);
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

// ---------- Leitura PROGRESSIVA (toca cada trecho assim que fica pronto) ----------

/** Mesmo arquivo/chave do WAV completo usado por synthesizeFullSpeechGemini. */
function fullReadAloudFile(chunks: string[], voiceName: string): File {
  const clean = chunks.map((c) => c.trim()).filter(Boolean);
  const cacheKey = shortHash(`${voiceName}:full:${clean.join('')}`);
  return new File(Paths.document, `readaloud_${cacheKey}.wav`);
}

/**
 * Se o áudio COMPLETO desta leitura (mesmos trechos + voz) já está em disco,
 * devolve o uri — aí a leitura toca na hora, sem gerar nem gastar token.
 */
export function getCachedReadAloudUri(
  chunks: string[],
  voiceName: string = DEFAULT_GEMINI_VOICE,
): string | null {
  try {
    const f = fullReadAloudFile(chunks, voiceName);
    return f.exists ? f.uri : null;
  } catch {
    return null;
  }
}

/**
 * Gera UM trecho: devolve o PCM (para concatenar no fim) e o uri de um WAV em
 * cache (para tocar já). Cacheia por trecho em Paths.cache, então re-gerar o
 * mesmo trecho é grátis (útil quando uma leitura é interrompida no meio).
 */
export async function synthesizeChunkGemini(
  text: string,
  voiceName: string = DEFAULT_GEMINI_VOICE,
): Promise<{ uri: string; pcm: Uint8Array }> {
  const trimmed = text.trim();
  if (!trimmed) throw new GeminiTTSError('texto vazio');
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiTTSError('Sem chave do Gemini — configure em "Como você quer usar?"');
  }
  const cacheKey = shortHash(`${voiceName}:${trimmed}`);
  const file = new File(Paths.cache, `gemini_tts_${cacheKey}.wav`);
  if (file.exists) {
    try {
      const bytes = await file.bytes();
      // tira o cabeçalho WAV (44 bytes) para recuperar o PCM puro
      const pcm = bytes.length > 44 ? bytes.slice(44) : new Uint8Array(0);
      if (pcm.length > 0) return { uri: file.uri, pcm };
    } catch {
      /* cache ilegível → regenera abaixo */
    }
  }
  const pcm = await fetchPcm(trimmed, voiceName, apiKey);
  const wav = pcmToWav(pcm);
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, pcm };
}

/**
 * Concatena os PCMs já gerados (na ordem) num único WAV completo e cacheia em
 * disco (Paths.document), para a PRÓXIMA leitura tocar na hora. Devolve o uri.
 */
export async function saveFullReadAloud(
  chunks: string[],
  voiceName: string,
  pcms: Uint8Array[],
): Promise<string> {
  let totalLen = 0;
  for (const p of pcms) totalLen += p.length;
  const allPcm = new Uint8Array(totalLen);
  let off = 0;
  for (const p of pcms) {
    allPcm.set(p, off);
    off += p.length;
  }
  const wav = pcmToWav(allPcm);
  await cleanupReadAloudCache();
  const file = fullReadAloudFile(chunks, voiceName);
  file.create({ overwrite: true });
  file.write(wav);
  return file.uri;
}
