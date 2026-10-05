// Síntese de voz via Gemini TTS (3.8 Flash, 3.8 Flash-Lite ou o 2.5 antigo).
//
// O modelo retorna áudio 16-bit LE mono em 24 kHz como base64 — PCM cru nos
// modelos antigos e, nos 3.8, WAV completo (com cabeçalho). Aqui tudo vira PCM
// antes do resto do pipeline (normalização de volume, cache, WAV próprio). Para que o
// expo-audio player consiga reproduzir, montamos um cabeçalho WAV (44
// bytes) na frente do PCM e salvamos como arquivo no diretório de cache.
//
// O cache é trivial: nome do arquivo é hash do (texto + voz). Frases
// idênticas no preview reutilizam o áudio sem nova chamada. Para o chat,
// onde quase nunca há repetição, isso só não atrapalha.

import { File, Paths } from 'expo-file-system';
import { getApiKey } from './secureStore';
import { getSavedAudioUris } from './database';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Modelos de TTS que o app sabe usar. */
export interface TtsModel {
  id: string;
  label: string;
  description: string;
}

export const TTS_MODELS: TtsModel[] = [
  {
    id: 'gemini-3.8-flash-lite-tts',
    label: 'Flash-Lite (3.8)',
    description: 'a mais rápida e barata — boa para avisos e frases curtas',
  },
  {
    id: 'gemini-3.8-flash-tts',
    label: 'Flash (3.8)',
    description: 'mais expressiva e natural — melhor para leituras longas',
  },
  {
    id: 'gemini-2.5-flash-preview-tts',
    label: '2.5 Flash (antiga)',
    description: 'a versão anterior; só se as novas falharem na sua conta',
  },
];

export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
/** Reserva: se um modelo novo não existir para a chave, volta a este. */
const LEGACY_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

let activeTtsModel: string = DEFAULT_TTS_MODEL;

/** Define o modelo de TTS em uso (vem da configuração). Ids desconhecidos são ignorados. */
export function setActiveTtsModel(id?: string | null): void {
  if (id && TTS_MODELS.some((m) => m.id === id)) activeTtsModel = id;
}

export function getActiveTtsModel(): string {
  return activeTtsModel;
}

// Aprendido em tempo de execução, por modelo: a documentação dos 3.8 só mostra a
// Interactions API; se ela recusar (400/404/405), usamos o generateContent. Se o
// modelo nem existir para esta chave (404), cai no 2.5 — a voz continua saindo.
const generateOnly = new Set<string>();
const unavailableModels = new Set<string>();

function effectiveModel(): string {
  return unavailableModels.has(activeTtsModel) ? LEGACY_TTS_MODEL : activeTtsModel;
}

function usesInteractions(model: string): boolean {
  return model.startsWith('gemini-3.8') && !generateOnly.has(model);
}
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
  { name: 'Kore', label: 'Kore', gender: 'female', description: 'feminina, firme, casual e direta' },
  { name: 'Leda', label: 'Leda', gender: 'female', description: 'feminina, jovem e alegre' },
  { name: 'Zephyr', label: 'Zephyr', gender: 'female', description: 'feminina, brilhante, suave e calma' },
  { name: 'Callirrhoe', label: 'Callirrhoe', gender: 'female', description: 'feminina, descontraída' },
  { name: 'Autonoe', label: 'Autonoe', gender: 'female', description: 'feminina, brilhante' },
  { name: 'Despina', label: 'Despina', gender: 'female', description: 'feminina, suave' },
  { name: 'Erinome', label: 'Erinome', gender: 'female', description: 'feminina, clara' },
  { name: 'Laomedeia', label: 'Laomedeia', gender: 'female', description: 'feminina, animada' },
  { name: 'Achernar', label: 'Achernar', gender: 'female', description: 'feminina, macia' },
  { name: 'Gacrux', label: 'Gacrux', gender: 'female', description: 'feminina, madura' },
  { name: 'Pulcherrima', label: 'Pulcherrima', gender: 'female', description: 'feminina, direta e à frente' },
  { name: 'Vindemiatrix', label: 'Vindemiatrix', gender: 'female', description: 'feminina, gentil' },
  { name: 'Sulafat', label: 'Sulafat', gender: 'female', description: 'feminina, calorosa' },
  { name: 'Charon', label: 'Charon', gender: 'male', description: 'masculina, articulada e informativa' },
  { name: 'Puck', label: 'Puck', gender: 'male', description: 'masculina, animada e simpática' },
  { name: 'Fenrir', label: 'Fenrir', gender: 'male', description: 'masculina, firme e empolgada' },
  { name: 'Orus', label: 'Orus', gender: 'male', description: 'masculina, firme, calma e ponderada' },
  { name: 'Enceladus', label: 'Enceladus', gender: 'male', description: 'masculina, soprada e suave' },
  { name: 'Iapetus', label: 'Iapetus', gender: 'male', description: 'masculina, clara' },
  { name: 'Umbriel', label: 'Umbriel', gender: 'male', description: 'masculina, descontraída' },
  { name: 'Algieba', label: 'Algieba', gender: 'male', description: 'masculina, suave' },
  { name: 'Algenib', label: 'Algenib', gender: 'male', description: 'masculina, rouca' },
  { name: 'Rasalgethi', label: 'Rasalgethi', gender: 'male', description: 'masculina, informativa' },
  { name: 'Alnilam', label: 'Alnilam', gender: 'male', description: 'masculina, firme' },
  { name: 'Schedar', label: 'Schedar', gender: 'male', description: 'masculina, uniforme' },
  { name: 'Achird', label: 'Achird', gender: 'male', description: 'masculina, amigável' },
  { name: 'Zubenelgenubi', label: 'Zubenelgenubi', gender: 'male', description: 'masculina, casual' },
  { name: 'Sadachbia', label: 'Sadachbia', gender: 'male', description: 'masculina, viva' },
  { name: 'Sadaltager', label: 'Sadaltager', gender: 'male', description: 'masculina, conhecedora' },
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

/**
 * Normaliza o VOLUME do PCM (16-bit LE) para um nível-alvo constante. Cada trecho
 * vem de uma chamada independente da API e pode sair mais alto/baixo — isso
 * deixava o volume "pulando" entre os blocos. Normalizando todos para o mesmo RMS
 * (com ganho limitado e teto de pico p/ não estourar), o volume fica uniforme.
 * (O timbre/identidade da voz é do modelo e não dá pra igualar por DSP.)
 */
const NORMALIZE_TARGET_RMS = 5000; // ~-16 dBFS — nível de fala confortável
function normalizePcm(pcm: Uint8Array): Uint8Array {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return pcm;
  const dv = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  let sumSq = 0;
  let peak = 1;
  for (let i = 0; i < n; i++) {
    const s = dv.getInt16(i * 2, true);
    sumSq += s * s;
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sumSq / n);
  if (rms < 1) return pcm; // silêncio — não mexe
  let gain = NORMALIZE_TARGET_RMS / rms;
  gain = Math.max(0.5, Math.min(3.0, gain)); // não exagera trecho quieto/alto
  if (peak * gain > 30000) gain = 30000 / peak; // evita clip
  if (Math.abs(gain - 1) < 0.02) return pcm; // já está no alvo
  const out = new Uint8Array(pcm.length);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    let v = Math.round(dv.getInt16(i * 2, true) * gain);
    if (v > 32767) v = 32767;
    else if (v < -32768) v = -32768;
    odv.setInt16(i * 2, v, true);
  }
  if (pcm.length % 2 === 1) out[pcm.length - 1] = pcm[pcm.length - 1];
  return out;
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
  /** true quando a geração foi CANCELADA (nova geração/stop) — não é falha. */
  readonly aborted: boolean;
  constructor(
    message: string,
    opts: {
      httpStatus?: number;
      quotaExceeded?: boolean;
      dailyQuota?: boolean;
      aborted?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'GeminiTTSError';
    this.httpStatus = opts.httpStatus;
    this.quotaExceeded = !!opts.quotaExceeded;
    this.dailyQuota = !!opts.dailyQuota;
    this.aborted = !!opts.aborted;
  }
}

/** Sinal de cancelamento (AbortSignal serve; só lemos `.aborted`). */
export interface TtsSignal {
  aborted: boolean;
}

function throwIfAborted(signal?: TtsSignal): void {
  if (signal?.aborted) {
    throw new GeminiTTSError('geração cancelada', { aborted: true });
  }
}

/**
 * Gera o áudio TTS para o texto. Lança `GeminiTTSError` em falha (sem chave,
 * cota esgotada, erro de rede). O caller decide o fallback (ex: cair para
 * expo-speech).
 */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Timeout PADRÃO por chamada de TTS (frases curtas). Gerar áudio longo leva
 *  tempo — 30s era curto e abortava ("Gemini TTS: Aborted"). Os trechos da
 *  leitura usam um limite proporcional ao tamanho (timeoutForChunk). */
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
async function acquireRpmSlot(signal?: TtsSignal): Promise<void> {
  for (;;) {
    // Cancelado enquanto esperava um slot? Sai já — gerações canceladas não
    // podem continuar consumindo o orçamento de RPM das novas (loop "zumbi").
    throwIfAborted(signal);
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
// Cota diária (RPD) é POR MODELO: esgotar o Flash não bloqueia o Flash-Lite.
const dailyBlockUntil = new Map<string, number>();
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
 * Uma linha de log por TENTATIVA (logcat → ReactNativeJS, tag [GeminiTTS]):
 * tamanho do trecho, nº da tentativa, espera na fila de RPM, duração da
 * chamada, limite usado e resultado. Existe porque o diagnóstico de setembro
 * dependeu de inferir latência por cronômetro de tela — sem isto, não dá para
 * saber se as tentativas batem no limite ou se o servidor ficou lento.
 */
function logAttempt(
  text: string,
  attempt: number,
  queueMs: number,
  fetchMs: number,
  timeoutMs: number,
  outcome: string,
): void {
  console.warn(
    `[GeminiTTS] chars=${text.length} tentativa=${attempt + 1} fila=${Math.round(queueMs / 1000)}s ` +
      `chamada=${Math.round(fetchMs / 1000)}s limite=${Math.round(timeoutMs / 1000)}s → ${outcome}`,
  );
}

/**
 * Por que o Gemini respondeu 200 SEM áudio? Em setembro/2026 isso passou a
 * acontecer em 4 de 5 chamadas da leitura (40–90 s cada), e é o que deixa a
 * geração lenta. O Gemini informa o motivo em finishReason (ex.: OTHER,
 * MAX_TOKENS, SAFETY), às vezes em promptFeedback.blockReason, e às vezes manda
 * TEXTO no lugar do áudio. Registrar isso decide o próximo passo (trechos
 * menores, outro modelo, desistir antes) com dados em vez de palpite.
 */
function describeEmpty(json: {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
    finishMessage?: string;
  }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}): string {
  const c = json.candidates?.[0];
  const bits: string[] = [];
  bits.push(`candidatos=${json.candidates?.length ?? 0}`);
  bits.push(`chaves=${Object.keys(json).join(',')}`);
  if (c?.finishReason) bits.push(`finishReason=${c.finishReason}`);
  if (c?.finishMessage) bits.push(`finishMessage="${c.finishMessage.slice(0, 120)}"`);
  if (json.promptFeedback?.blockReason) bits.push(`blockReason=${json.promptFeedback.blockReason}`);
  const txt = c?.content?.parts?.find((p) => p.text)?.text;
  if (txt) bits.push(`texto="${txt.replace(/\s+/g, ' ').slice(0, 80)}"`);
  const u = json.usageMetadata;
  if (u) bits.push(`tokens=${u.promptTokenCount ?? '?'}/${u.candidatesTokenCount ?? '?'}`);
  return bits.join(' ');
}

/**
 * Limite por chamada proporcional ao tamanho do trecho da LEITURA. Os trechos
 * de 2000 caracteres foram dimensionados em junho para ~45 s de geração; em
 * setembro de 2026 eles passaram a bater nos 90 s fixos, e cada estouro
 * DESCARTAVA uma resposta que talvez estivesse quase pronta — e a cobrava da
 * cota — recomeçando o trecho do zero. 90 ms por caractere ≈ 180 s para 2000.
 * Frases curtas (nudges, inspirações) seguem com os 90 s.
 */
function timeoutForChunk(text: string): number {
  return Math.max(TTS_TIMEOUT_MS, text.length * 90);
}

/** Acha o áudio (base64) em qualquer formato de resposta: generateContent ou Interactions. */
function pickAudioBase64(json: unknown): string | undefined {
  let best: string | undefined;
  const walk = (o: unknown, depth: number) => {
    if (depth > 10 || o == null) return;
    if (typeof o === 'string') {
      if (o.length > 1000 && (!best || o.length > best.length) && /^[A-Za-z0-9+/_=\s-]+$/.test(o.slice(0, 200))) best = o;
      return;
    }
    if (Array.isArray(o)) {
      for (const v of o) walk(v, depth + 1);
    } else if (typeof o === 'object') {
      for (const v of Object.values(o as Record<string, unknown>)) walk(v, depth + 1);
    }
  };
  walk(json, 0);
  return best;
}

/**
 * Entrega PCM cru. Os modelos 3.8 respondem WAV completo ("RIFF…"): tira o
 * cabeçalho e fica com o chunk 'data'. PCM cru passa direto.
 */
function audioToPcm(bytes: Uint8Array): Uint8Array {
  const isRiff = bytes.length > 44 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  if (!isRiff) return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') {
      const end = size > 0 && off + 8 + size <= bytes.length ? off + 8 + size : bytes.length;
      return bytes.subarray(off + 8, end);
    }
    off += 8 + size + (size % 2);
  }
  return bytes.subarray(44);
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
  signal?: TtsSignal,
  /** Limite desta chamada. Trechos longos da leitura precisam de mais que 90 s. */
  timeoutMs: number = TTS_TIMEOUT_MS,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  // Bloqueio diário (RPD) ativo? Nem chama a API — cai direto para o fallback.
  const blockedUntil = dailyBlockUntil.get(effectiveModel()) ?? 0;
  if (blockedUntil && Date.now() < blockedUntil) {
    throw new GeminiTTSError('Gemini TTS: cota diária da API esgotada', {
      httpStatus: 429,
      quotaExceeded: true,
      dailyQuota: true,
    });
  }
  // Ritma para não estourar os 10 RPM (gargalo real do TTS). Adquire um slot em
  // TODA requisição — inclusive cada retry, que é uma nova requisição.
  const tQueue = Date.now();
  await acquireRpmSlot(signal);
  const queueMs = Date.now() - tQueue;
  const model = effectiveModel();
  const interactions = usesInteractions(model);
  const url = interactions
    ? `${API_BASE}/interactions`
    : `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = interactions
    ? {
        model,
        input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
        response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: SAMPLE_RATE },
        generation_config: { speech_config: [{ voice: voiceName }] },
      }
    : {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const tFetch = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: interactions
        ? { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    logAttempt(text, attempt, queueMs, Date.now() - tFetch, timeoutMs,
      err instanceof Error ? err.message : 'erro de rede');
    // Timeout (abort) ou rede instável — transiente. Tenta de novo com backoff
    // antes de desistir (em vez de cair na voz do sistema na primeira falha).
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      throwIfAborted(signal);
      return fetchPcm(text, voiceName, apiKey, attempt + 1, signal, timeoutMs);
    }
    const msg = err instanceof Error ? err.message : 'erro de rede';
    throw new GeminiTTSError(`Gemini TTS: ${msg}`);
  }
  clearTimeout(timer);
  const fetchMs = Date.now() - tFetch;
  if (!res.ok) logAttempt(text, attempt, queueMs, fetchMs, timeoutMs, `HTTP ${res.status}`);

  // 5xx ("An internal error has occurred. Please retry") é transitório → re-tenta.
  if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES) {
    await sleep(retryDelayMs(attempt));
    throwIfAborted(signal);
    return fetchPcm(text, voiceName, apiKey, attempt + 1, signal, timeoutMs);
  }

  if (!res.ok) {
    const rawErr = await res.text().catch(() => '');
    let j: { error?: { message?: string } } = {};
    try {
      j = JSON.parse(rawErr) as typeof j;
    } catch {
      /* corpo não é JSON */
    }
    const keyProblem = /api key|API_KEY|permission/i.test(rawErr);
    // A API nova recusou o formato: tenta o generateContent, uma vez por modelo.
    if (interactions && [400, 404, 405].includes(res.status) && !keyProblem) {
      console.warn(`[GeminiTTS] ${model}: Interactions API recusou (HTTP ${res.status}) — usando generateContent`);
      generateOnly.add(model);
      return fetchPcm(text, voiceName, apiKey, attempt, signal, timeoutMs);
    }
    // O modelo nem existe para esta chave: volta ao 2.5, uma vez.
    if (!interactions && res.status === 404 && model !== LEGACY_TTS_MODEL) {
      console.warn(`[GeminiTTS] ${model} indisponível (404) — usando ${LEGACY_TTS_MODEL}`);
      unavailableModels.add(activeTtsModel);
      return fetchPcm(text, voiceName, apiKey, attempt, signal, timeoutMs);
    }
    // 429: distinguir DIÁRIO (RPD — não re-tentar hoje; bloqueia e cai para o
    // sistema) de POR-MINUTO (RPM/TPM — transitório, re-tenta com o delay certo).
    if (res.status === 429) {
      const { daily, retryMs } = classify429(j);
      if (daily) {
        dailyBlockUntil.set(model, nextPacificMidnight());
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
        throwIfAborted(signal);
        return fetchPcm(text, voiceName, apiKey, attempt + 1, signal, timeoutMs);
      }
    }
    const msg = j.error?.message ?? `HTTP ${res.status}`;
    throw new GeminiTTSError(`Gemini TTS: ${msg}`, {
      httpStatus: res.status,
      quotaExceeded: res.status === 429,
    });
  }
  const json = (await res.json()) as {
    candidates?: {
      content?: { parts?: { inlineData?: { data?: string }; text?: string }[] };
      finishReason?: string;
      finishMessage?: string;
    }[];
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const audioBase64 = pickAudioBase64(json);
  logAttempt(text, attempt, queueMs, Date.now() - tFetch, timeoutMs,
    audioBase64
      ? `ok ${Math.round((audioBase64.length * 3) / 4 / 1024)} KiB`
      : `ok SEM ÁUDIO — ${describeEmpty(json)}`);
  if (!audioBase64) {
    // 200 mas sem áudio — também é uma falha transitória; re-tenta antes de desistir.
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      throwIfAborted(signal);
      return fetchPcm(text, voiceName, apiKey, attempt + 1, signal, timeoutMs);
    }
    throw new GeminiTTSError('Gemini TTS: resposta sem áudio');
  }
  return audioToPcm(base64ToBytes(audioBase64));
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

  const cacheKey = shortHash(`${activeTtsModel}|${voiceName}:${trimmed}`);
  const file = new File(Paths.cache, `gemini_tts_${cacheKey}.wav`);
  if (file.exists) {
    return { uri: file.uri, cached: true };
  }

  const pcm = normalizePcm(await fetchPcm(trimmed, voiceName, apiKey));
  const wav = pcmToWav(pcm);
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, cached: false };
}

const NUDGE_PREFIX = 'nudge_';

/**
 * Prepara o áudio de UMA frase curta de "nudge" na voz do Gemini.
 *
 *  - `persist: true` (frases FIXAS, ex.: inspirações): grava um WAV PERSISTENTE
 *    em `Paths.document` com nome estável por (voz+texto). Sobrevive a reboot —
 *    obrigatório, pois o BootReceiver nativo re-arma o alarme apontando para esse
 *    caminho. Chamadas repetidas com o MESMO texto+voz batem no cache
 *    (`cached:true`) sem gastar token → render-1x de verdade.
 *  - `persist: false` (texto DINÂMICO/JITAI efêmero): delega a
 *    `synthesizeSpeechGemini` (cache volátil em `Paths.cache`).
 *
 * Lança `GeminiTTSError` em falha (sem chave, cota diária, rede). O chamador faz
 * o fallback (agendar com o texto → voz do sistema).
 */
export async function prepareNudgeAudio(
  text: string,
  opts: { voiceName?: string; persist?: boolean; namespace?: string } = {},
): Promise<{ uri: string; cached: boolean; key: string }> {
  const voiceName = opts.voiceName || DEFAULT_GEMINI_VOICE;
  const trimmed = text.trim();
  if (!trimmed) throw new GeminiTTSError('texto vazio');
  const key = shortHash(`nudge:${activeTtsModel}|${voiceName}:${trimmed}`);

  // Texto dinâmico (JITAI): não persiste — usa o cache volátil do motor.
  if (!opts.persist) {
    const r = await synthesizeSpeechGemini(trimmed, voiceName);
    return { uri: r.uri, cached: r.cached, key };
  }

  // Frase fixa: WAV persistente com nome estável (sobrevive a reboot). O
  // `namespace` ('insp', 'med', …) separa as fontes — assim a limpeza de uma
  // fonte nunca apaga o áudio de outra.
  const ns = opts.namespace || 'gen';
  const file = new File(Paths.document, `${NUDGE_PREFIX}${ns}_${key}.wav`);
  if (file.exists) {
    return { uri: file.uri, cached: true, key };
  }
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiTTSError('Sem chave do Gemini — configure em "Como você quer usar?"');
  }
  const pcm = normalizePcm(await fetchPcm(trimmed, voiceName, apiKey));
  const wav = pcmToWav(pcm);
  file.create({ overwrite: true });
  file.write(wav);
  return { uri: file.uri, cached: false, key };
}

/**
 * Remove WAVs de nudge ÓRFÃOS de um `namespace` ('insp', 'med', …) — os que NÃO
 * correspondem a nenhuma das `expectedKeys` (ex.: o usuário trocou a voz Gemini,
 * ou as frases mudaram). Opera SÓ dentro do namespace, então nunca apaga áudio de
 * outra fonte. Best-effort. Só chamar quando a sincronização COMPLETOU e gerou ao
 * menos um WAV — senão apagaria áudio ainda válido.
 */
export async function cleanupNudgeAudio(
  namespace: string,
  expectedKeys: Set<string>,
): Promise<void> {
  try {
    const prefix = `${NUDGE_PREFIX}${namespace}_`;
    const keep = new Set<string>();
    for (const k of expectedKeys) keep.add(`${prefix}${k}.wav`);
    const entries = Paths.document.list();
    entries
      .filter(
        (e): e is File =>
          e instanceof File && e.name.startsWith(prefix) && e.name.endsWith('.wav'),
      )
      .filter((f) => !keep.has(f.name))
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
  signal?: TtsSignal,
): Promise<GeminiTTSResult> {
  const clean = chunks.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) throw new GeminiTTSError('texto vazio');
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new GeminiTTSError('Sem chave do Gemini — configure em "Como você quer usar?"');
  }

  const cacheKey = shortHash(`${activeTtsModel}|${voiceName}:full:${clean.join('')}`);
  const file = new File(Paths.document, `readaloud_${cacheKey}.wav`);
  if (file.exists) {
    return { uri: file.uri, cached: true };
  }

  // O ritmo (RPM) agora é GLOBAL, dentro de fetchPcm (acquireRpmSlot), e vale
  // para todos os caminhos. Aqui é só gerar em série e concatenar.
  //
  // RETOMÁVEL: cada trecho pronto vai para o disco. Se a geração for
  // interrompida (app fora da tela, processo morto à noite, novo toque), a
  // próxima tentativa pula o que já existe em vez de recomeçar do trecho 1 —
  // e de gastar a cota de novo com ele.
  const pcms: Uint8Array[] = [];
  const chunkFiles: File[] = [];
  let totalLen = 0;
  for (let i = 0; i < clean.length; i++) {
    throwIfAborted(signal);
    onProgress?.(i, clean.length);
    const chunkFile = new File(
      Paths.cache,
      `readaloud_chunk_${shortHash(`${activeTtsModel}|${voiceName}:chunk:${clean[i]}`)}.pcm`,
    );
    chunkFiles.push(chunkFile);
    let pcm: Uint8Array | null = null;
    if (chunkFile.exists) {
      try {
        const bytes = await chunkFile.bytes();
        // PCM 16-bit: comprimento ímpar = arquivo truncado (a gravação é
        // atômica e com tamanho conferido, mas por garantia). Descarta e gera de novo.
        if (bytes.length > 0 && bytes.length % 2 === 0) pcm = bytes;
      } catch {
        pcm = null; // ilegível → gera de novo
      }
      if (!pcm) {
        try {
          chunkFile.delete();
        } catch {
          /* ignore */
        }
      }
    }
    if (!pcm) {
      pcm = normalizePcm(
        await fetchPcm(clean[i], voiceName, apiKey, 0, signal, timeoutForChunk(clean[i])),
      );
      // Grava num temporário e só então renomeia: um processo morto ou disco
      // cheio no meio da escrita nunca deixa um trecho truncado com o nome
      // final — senão ele seria reaproveitado e viraria chiado no áudio salvo.
      const tmp = new File(Paths.cache, `${chunkFile.name}.tmp`);
      try {
        tmp.create({ overwrite: true });
        tmp.write(pcm);
        // Com o disco quase cheio o Android pode gravar só PARTE do arquivo sem
        // lançar erro. Confere o tamanho antes de dar o nome final.
        if (tmp.size !== pcm.length) throw new Error('gravação curta do trecho');
        tmp.move(chunkFile);
      } catch {
        try {
          if (tmp.exists) tmp.delete();
        } catch {
          /* ignore */
        }
        /* sem disco para o trecho: segue só em memória */
      }
    }
    pcms.push(pcm);
    totalLen += pcm.length;
  }
  throwIfAborted(signal);
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
  // Mesma conferência do trecho: um WAV gravado pela metade não pode ficar como
  // "pronto" (seria reusado para sempre) — e aí os trechos NÃO são apagados,
  // para a próxima tentativa só remontar o arquivo.
  if (file.size !== wav.length) {
    try {
      file.delete();
    } catch {
      /* ignore */
    }
    throw new GeminiTTSError('não consegui gravar o áudio completo (espaço em disco?)');
  }
  // O WAV completo já tem tudo: os trechos avulsos não servem mais.
  for (const f of chunkFiles) {
    try {
      if (f.exists) f.delete();
    } catch {
      /* best-effort */
    }
  }
  return { uri: file.uri, cached: false };
}

// ---------- Leitura PROGRESSIVA (toca cada trecho assim que fica pronto) ----------

/** Mesmo arquivo/chave do WAV completo usado por synthesizeFullSpeechGemini. */
function fullReadAloudFile(chunks: string[], voiceName: string): File {
  const clean = chunks.map((c) => c.trim()).filter(Boolean);
  const cacheKey = shortHash(`${activeTtsModel}|${voiceName}:full:${clean.join('')}`);
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
  const cacheKey = shortHash(`${activeTtsModel}|${voiceName}:${trimmed}`);
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
  const pcm = normalizePcm(
    await fetchPcm(trimmed, voiceName, apiKey, 0, undefined, timeoutForChunk(trimmed)),
  );
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
