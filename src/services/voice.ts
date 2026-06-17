import { Linking, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';
import {
  DEFAULT_GEMINI_VOICE,
  GeminiTTSError,
  synthesizeFullSpeechGemini,
  synthesizeSpeechGemini,
  synthesizeChunkGemini,
  getCachedReadAloudUri,
  saveFullReadAloud,
} from './geminiTTS';
import type { VoiceProvider } from '../types';

const DEFAULT_LANGUAGE = 'pt-BR';

export type VoiceGender = 'female' | 'male' | 'unknown';

export interface EnrichedVoice {
  identifier: string;
  name: string;
  language: string;
  quality: Speech.VoiceQuality;
  gender: VoiceGender;
  displayName: string;
  isBrazilian: boolean;
  isPortuguese: boolean;
}

interface SpeakOptions {
  onDone?: () => void;
  onError?: (e: unknown) => void;
  voiceId?: string | null;
  language?: string | null;
  /** Volume 0–1 (avisos/nudges escalam pela barra da Home). Padrão 1. */
  volume?: number;
}

let currentlySpeaking = false;
// Token de "geração" de fala. Cada chamada que inicia uma fala reivindica um
// token novo; quando a síntese assíncrona (Gemini) ou o encadeamento de
// pedaços (texto longo) termina, só age se ainda for o token vigente. Isso
// impede que duas vozes se sobreponham lendo mensagens diferentes — o bug em
// que a síntese do Gemini de uma msg antiga voltava e tocava junto com a do
// sistema de outra. stopSpeaking() incrementa o token, invalidando o que vier.
let speakToken = 0;

// Active voice state — set explicitly via setActiveVoice() OR resolved by
// auto-pick when listing. Lives in module memory; persisted in user_config
// by callers (Settings/onboarding).
let activeVoiceId: string | null = null;
let activeLanguage: string | null = null;
let activeProvider: VoiceProvider = 'system';
let activeGeminiVoiceName: string = DEFAULT_GEMINI_VOICE;
// Player do expo-audio em uso quando provider === 'gemini'.
let activeGeminiPlayer: AudioPlayer | null = null;
// Resolve a reprodução de um trecho em andamento (para `stopPlayback` destravar
// o `await playAndWait` da leitura progressiva).
let activePlaybackFinish: (() => void) | null = null;

// Liga a reprodução em SEGUNDO PLANO (continua com a tela apagada / bloqueada).
// O expo-audio já traz um foreground service de mídia (AudioControlsService);
// `shouldPlayInBackground: true` faz o player não pausar ao sair do primeiro
// plano. Idempotente — basta uma vez por sessão do app.
let backgroundAudioReady = false;
export async function ensureBackgroundAudio(): Promise<void> {
  if (backgroundAudioReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
    backgroundAudioReady = true;
  } catch {
    // Se falhar, a leitura ainda toca em primeiro plano — só não persiste no lock.
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function setActiveVoice(voiceId: string | null, language: string | null) {
  activeVoiceId = voiceId;
  activeLanguage = language;
}

export function setActiveVoiceProvider(
  provider: VoiceProvider,
  geminiVoiceName?: string,
) {
  activeProvider = provider;
  if (geminiVoiceName) activeGeminiVoiceName = geminiVoiceName;
}

export function getActiveVoiceProvider(): VoiceProvider {
  return activeProvider;
}

export function getActiveVoiceId(): string | null {
  return activeVoiceId;
}

// Female-name heuristics. Order matters; we check most specific first.
const FEMALE_SIGNALS = [
  'female',
  'mulher',
  /[-_/#]f[-_/#0-9]/i, // x-afs#female_1, x-pt-f1, etc.
  '-fb',
  '-fc',
  '-fd',
  '-fe',
  '-ff',
  'maria',
  'ana',
  'sofia',
  'camila',
  'beatriz',
  'júlia',
  'julia',
  'mariana',
  'helena',
  'luciana',
  'patricia',
  'patrícia',
  'wavenet-a', // Google Cloud convention: A/C/E typically female in pt-BR
  'wavenet-c',
  'standard-a',
  'standard-c',
];

const MALE_SIGNALS = [
  'male',
  'homem',
  /[-_/#]m[-_/#0-9]/i,
  '-mb',
  '-mc',
  '-md',
  '-me',
  'pedro',
  'joão',
  'joao',
  'bruno',
  'marcos',
  'rafael',
  'antonio',
  'antônio',
  'carlos',
  'paulo',
  'wavenet-b',
  'wavenet-d',
  'standard-b',
  'standard-d',
];

function matchesAny(haystack: string, patterns: (string | RegExp)[]): boolean {
  const h = haystack.toLowerCase();
  return patterns.some((p) => (typeof p === 'string' ? h.includes(p) : p.test(h)));
}

function guessGender(voice: Speech.Voice): VoiceGender {
  const combined = `${voice.identifier ?? ''} ${voice.name ?? ''}`;
  if (matchesAny(combined, FEMALE_SIGNALS)) return 'female';
  if (matchesAny(combined, MALE_SIGNALS)) return 'male';
  return 'unknown';
}

function regionLabel(language: string): string {
  const lower = language.toLowerCase();
  if (lower.startsWith('pt-br')) return 'Brasil';
  if (lower.startsWith('pt-pt')) return 'Portugal';
  if (lower.startsWith('pt')) return 'Português';
  return language;
}

function genderLabel(g: VoiceGender): string {
  if (g === 'female') return 'feminina';
  if (g === 'male') return 'masculina';
  return 'voz';
}

function buildDisplayName(voice: Speech.Voice, gender: VoiceGender): string {
  const region = regionLabel(voice.language);
  const g = genderLabel(gender);
  // Try to extract a personal name from the identifier (Google Cloud-style):
  // e.g. "pt-BR-Wavenet-A" → "Wavenet A"
  const id = voice.identifier ?? '';
  const idParts = id.split(/[-_]/).slice(2).filter(Boolean);
  if (idParts.length > 0 && /^[a-zA-Z]/.test(idParts[0])) {
    const cleaned = idParts
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');
    return `${cleaned} (${region}, ${g})`;
  }
  return `${region} — ${g}`;
}

function enrich(voice: Speech.Voice): EnrichedVoice {
  const gender = guessGender(voice);
  const lang = voice.language ?? '';
  return {
    identifier: voice.identifier,
    name: voice.name,
    language: lang,
    quality: voice.quality,
    gender,
    displayName: buildDisplayName(voice, gender),
    isBrazilian: lang.toLowerCase().startsWith('pt-br'),
    isPortuguese: lang.toLowerCase().startsWith('pt'),
  };
}

export async function listAvailableVoices(): Promise<EnrichedVoice[]> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.map(enrich);
  } catch (err) {
    console.warn('listAvailableVoices failed:', err);
    return [];
  }
}

export async function listPortugueseVoices(): Promise<EnrichedVoice[]> {
  const all = await listAvailableVoices();
  return all
    .filter((v) => v.isPortuguese)
    .sort((a, b) => {
      // pt-BR first, then quality (Enhanced > Default), then gender (female, male, unknown)
      if (a.isBrazilian !== b.isBrazilian) return a.isBrazilian ? -1 : 1;
      const qScore = (q: Speech.VoiceQuality) =>
        q === Speech.VoiceQuality.Enhanced ? 0 : 1;
      const qa = qScore(a.quality);
      const qb = qScore(b.quality);
      if (qa !== qb) return qa - qb;
      const gScore = (g: VoiceGender) => (g === 'female' ? 0 : g === 'male' ? 1 : 2);
      return gScore(a.gender) - gScore(b.gender);
    });
}

async function resolveVoice(): Promise<{ id: string | null; lang: string }> {
  if (activeVoiceId) {
    return { id: activeVoiceId, lang: activeLanguage ?? DEFAULT_LANGUAGE };
  }
  // Auto-pick: prefer Brazilian, then any pt-*, then nothing
  const pt = await listPortugueseVoices();
  const first = pt[0];
  if (!first) return { id: null, lang: DEFAULT_LANGUAGE };
  return { id: first.identifier, lang: first.language || DEFAULT_LANGUAGE };
}

interface SpeakExtraOptions {
  /** Força um provider para esta chamada (preview). Padrão: o ativo. */
  provider?: VoiceProvider;
  /** Voz Gemini explícita (preview). Padrão: a ativa. */
  geminiVoiceName?: string;
}

export async function speak(
  text: string,
  opts: SpeakOptions & SpeakExtraOptions = {},
): Promise<void> {
  if (!text.trim()) return;
  const myToken = ++speakToken; // reivindica esta geração de fala
  await stopPlayback(); // para o que estiver tocando, sem mexer no token
  if (myToken !== speakToken) return; // outra fala assumiu durante o await

  const provider = opts.provider ?? activeProvider;
  if (provider === 'gemini') {
    await speakWithGemini(text, opts, myToken);
    return;
  }

  const resolved =
    opts.voiceId !== undefined
      ? { id: opts.voiceId, lang: opts.language ?? DEFAULT_LANGUAGE }
      : await resolveVoice();
  if (myToken !== speakToken) return; // resolveVoice() pode ter cedido a vez
  currentlySpeaking = true;
  Speech.speak(text, {
    language: resolved.lang,
    voice: resolved.id ?? undefined,
    rate: 1.0,
    pitch: 1.0,
    volume: opts.volume == null ? 1 : Math.max(0, Math.min(1, opts.volume)),
    onDone: () => {
      if (myToken !== speakToken) return;
      currentlySpeaking = false;
      opts.onDone?.();
    },
    onStopped: () => {
      if (myToken === speakToken) currentlySpeaking = false;
    },
    onError: (e) => {
      if (myToken !== speakToken) return;
      currentlySpeaking = false;
      opts.onError?.(e);
    },
  });
}

async function speakWithGemini(
  text: string,
  opts: SpeakOptions & SpeakExtraOptions,
  myToken: number,
): Promise<void> {
  const voice = opts.geminiVoiceName ?? activeGeminiVoiceName;
  currentlySpeaking = true;
  try {
    const { uri } = await synthesizeSpeechGemini(text, voice);
    if (myToken !== speakToken) return; // superada durante a síntese — não toca
    const player = createAudioPlayer({ uri });
    activeGeminiPlayer = player;
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        sub.remove();
        releaseGeminiPlayer(player);
        if (myToken === speakToken) {
          currentlySpeaking = false;
          opts.onDone?.();
        }
      }
    });
    player.play();
  } catch (err) {
    if (myToken !== speakToken) return; // superada (não cair no fallback à toa)
    currentlySpeaking = false;
    if (err instanceof GeminiTTSError) {
      console.warn('Gemini TTS falhou, caindo no sistema:', err.message);
      // Fallback transparente: usa expo-speech se a síntese remota falhar.
      await speak(text, { ...opts, provider: 'system' });
      return;
    }
    opts.onError?.(err);
  }
}

function releaseGeminiPlayer(player: AudioPlayer) {
  try {
    player.remove();
  } catch {
    /* já liberado */
  }
  if (activeGeminiPlayer === player) activeGeminiPlayer = null;
}

const PREVIEW_TEXT =
  'Oi, eu sou a Comentora, sua coruja de sabedoria. Vou te ajudar a dormir melhor.';

export async function previewVoice(voice: EnrichedVoice): Promise<void> {
  await speak(PREVIEW_TEXT, {
    provider: 'system',
    voiceId: voice.identifier,
    language: voice.language || DEFAULT_LANGUAGE,
  });
}

/**
 * Reproduz uma frase de demonstração com uma voz Gemini específica.
 * Usado pelo picker em Configurações.
 */
export async function previewGeminiVoice(voiceName: string): Promise<void> {
  await speak(PREVIEW_TEXT, { provider: 'gemini', geminiVoiceName: voiceName });
}

/**
 * Quebra um texto grande em pedaços de até `maxLen` caracteres, respeitando
 * limites de frase quando possível. O Android tem um limite por chamada de TTS
 * (~4000 chars), então textos longos (visualização, oração) precisam ser lidos
 * em sequência. Sem lookbehind (Hermes-safe).
 */
/**
 * Fatia o texto em pedaços de até `maxLen`, preferindo as fronteiras de
 * PARÁGRAFO (linha em branco) e, dentro delas, de FRASE — nunca corta no meio de
 * uma frase. Um parágrafo só é dividido (por frase) se sozinho passar de maxLen;
 * uma frase só é cortada à força se sozinha passar de maxLen. Hermes-safe.
 */
export function chunkText(text: string, maxLen = 3500): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const paragraphs = clean
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };

  // Quebra um parágrafo grande demais em frases (e a frase gigante, à força).
  const splitParagraph = (p: string): string[] => {
    const out: string[] = [];
    let buf = '';
    const sentences = p.match(/[^.!?…]+[.!?…]*\s*/g) ?? [p];
    for (const s of sentences) {
      if (s.length > maxLen) {
        if (buf.trim()) {
          out.push(buf.trim());
          buf = '';
        }
        for (let i = 0; i < s.length; i += maxLen) out.push(s.slice(i, i + maxLen).trim());
        continue;
      }
      if ((buf + s).length > maxLen) {
        if (buf.trim()) out.push(buf.trim());
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(Boolean);
  };

  for (const p of paragraphs) {
    if (p.length > maxLen) {
      flush();
      for (const piece of splitParagraph(p)) chunks.push(piece);
      continue;
    }
    const sep = cur ? '\n\n' : '';
    if ((cur + sep + p).length > maxLen) {
      flush();
      cur = p;
    } else {
      cur += sep + p;
    }
  }
  flush();
  return chunks.filter(Boolean);
}

/**
 * "Leitura pausada" (visualização / auto-hipnose): separa cada FRASE por uma
 * linha em branco, fazendo o TTS pausar mais entre elas. O chunkText depois
 * reagrupa essas frases-parágrafo nos pedaços, mantendo as pausas.
 */
function addSentencePauses(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => {
      const sentences = p.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*/g);
      return sentences ? sentences.map((s) => s.trim()).filter(Boolean).join('\n\n') : p.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

interface SpeakLongOptions {
  /** 'system' (expo-speech) ou 'gemini' (TTS neural). Padrão: 'system'. */
  provider?: VoiceProvider;
  voiceId?: string | null;
  language?: string | null;
  /** Voz Gemini, quando provider === 'gemini'. */
  geminiVoiceName?: string;
  /** Velocidade (sistema e Gemini). 1.0 = normal. <1 = mais lento. */
  rate?: number;
  /** Leitura pausada: insere pausa entre as frases (visualização/auto-hipnose). */
  paused?: boolean;
  onDone?: () => void;
  onError?: (e: unknown) => void;
  /** Progresso: pedaço atual (0-based) e total de pedaços. */
  onProgress?: (index: number, total: number) => void;
  /** Progresso da GERAÇÃO do áudio Gemini (só na 1ª vez): feitos / total. */
  onSynthProgress?: (done: number, total: number) => void;
  /** Chamado quando o Gemini falha e a leitura cai para a voz do sistema. */
  onFallback?: (e: unknown) => void;
}

/**
 * Lê um texto longo em voz alta, quebrando em pedaços e encadeando um após o
 * outro. Usado pela tela "Leia para mim" (visualização, auto-hipnose, oração).
 * Com provider 'system' usa expo-speech (com velocidade ajustável); com
 * 'gemini' sintetiza cada pedaço pela API neural e toca em sequência (voz
 * profissional, leitura pausada). Respeita o token de geração: `stopSpeaking()`
 * interrompe na hora e não encadeia o próximo.
 */
/** Limite de caracteres por pedaço (Gemini). 2000 é o ponto ótimo: minimiza o
 *  nº de REQUISIÇÕES (gargalo real é RPM 10/min e RPD 100/dia no Tier 1 — um
 *  texto de 26k chars cai de ~38 para ~15 requisições), mantém o trecho < 4000
 *  bytes (limite, mesmo com acentos PT-BR), ~2 min de fala (longe do corte de
 *  ~5 min) e ~45s de geração (dentro do timeout de 90s). O ritmo (RPM) é global
 *  no geminiTTS (acquireRpmSlot). */
const GEMINI_CHUNK_MAX = 2000;
const SYSTEM_CHUNK_MAX = 3500;

export async function speakLongText(
  text: string,
  opts: SpeakLongOptions = {},
): Promise<void> {
  const provider = opts.provider ?? 'system';
  const src = opts.paused ? addSentencePauses(text) : text;
  const chunks = chunkText(src, provider === 'gemini' ? GEMINI_CHUNK_MAX : SYSTEM_CHUNK_MAX);
  if (chunks.length === 0) return;
  await ensureBackgroundAudio(); // continua tocando com a tela apagada
  const myToken = ++speakToken;
  await stopPlayback();
  if (myToken !== speakToken) return;

  if (provider === 'gemini') {
    await speakLongTextGemini(chunks, opts, myToken);
    return;
  }
  readSystemChunks(chunks, 0, opts, myToken);
}

/**
 * Pré-gera e salva o áudio Gemini do texto (sem tocar). Usado pelo botão
 * "Salvar áudio": depois disso, a leitura toca sem pausas e o arquivo fica
 * guardado. Lança GeminiTTSError em falha.
 */
export async function prepareReadAloudAudio(
  text: string,
  opts: {
    geminiVoiceName?: string;
    paused?: boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<string | null> {
  const src = opts.paused ? addSentencePauses(text) : text;
  const chunks = chunkText(src, GEMINI_CHUNK_MAX);
  if (chunks.length === 0) return null;
  const { uri } = await synthesizeFullSpeechGemini(
    chunks,
    opts.geminiVoiceName ?? activeGeminiVoiceName,
    opts.onProgress,
  );
  return uri;
}

/**
 * O áudio COMPLETO desta leitura (mesmo texto + voz + pausa) já está em cache?
 * Usado para decidir se mostramos o aviso "vai levar alguns minutos" (só quando
 * de fato vai GERAR) ou se já podemos tocar na hora.
 */
export function isReadAloudCached(
  text: string,
  opts: { geminiVoiceName?: string; paused?: boolean } = {},
): boolean {
  const src = opts.paused ? addSentencePauses(text) : text;
  const chunks = chunkText(src, GEMINI_CHUNK_MAX);
  if (chunks.length === 0) return false;
  return getCachedReadAloudUri(chunks, opts.geminiVoiceName ?? activeGeminiVoiceName) != null;
}

/** Lê os pedaços `chunks` a partir de `startIdx` com a voz do sistema. */
function readSystemChunks(
  chunks: string[],
  startIdx: number,
  opts: SpeakLongOptions,
  myToken: number,
): void {
  const lang = opts.language ?? DEFAULT_LANGUAGE;
  let i = startIdx;
  const speakNext = () => {
    if (myToken !== speakToken) return; // parado ou superado
    if (i >= chunks.length) {
      currentlySpeaking = false;
      opts.onDone?.();
      return;
    }
    const idx = i++;
    opts.onProgress?.(idx, chunks.length);
    currentlySpeaking = true;
    Speech.speak(chunks[idx], {
      language: lang,
      voice: opts.voiceId ?? undefined,
      rate: opts.rate ?? 1.0,
      pitch: 1.0,
      onDone: () => speakNext(),
      onStopped: () => {
        if (myToken === speakToken) currentlySpeaking = false;
      },
      onError: (e) => {
        if (myToken !== speakToken) return;
        currentlySpeaking = false;
        opts.onError?.(e);
      },
    });
  };
  speakNext();
}

/**
 * Toca um WAV (`uri`) e resolve quando termina OU quando a leitura é parada
 * (token mudou / `stopPlayback`). É a unidade da leitura progressiva: um trecho
 * por vez.
 */
function playAndWait(uri: string, myToken: number, rate = 1): Promise<void> {
  return new Promise<void>((resolve) => {
    if (myToken !== speakToken) {
      resolve();
      return;
    }
    let player: AudioPlayer;
    try {
      player = createAudioPlayer({ uri });
    } catch {
      resolve();
      return;
    }
    activeGeminiPlayer = player;
    // Velocidade da leitura (com correção de tom para não engrossar/afinar a voz).
    if (rate && Math.abs(rate - 1) > 0.001) {
      try {
        player.shouldCorrectPitch = true;
        player.setPlaybackRate(rate, 'high');
      } catch {
        /* nem todo device suporta — segue em velocidade normal */
      }
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (activePlaybackFinish === finish) activePlaybackFinish = null;
      try {
        sub.remove();
      } catch {
        /* noop */
      }
      releaseGeminiPlayer(player);
      resolve();
    };
    // Permite que stopPlayback() destrave este await imediatamente.
    activePlaybackFinish = finish;
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (myToken !== speakToken) {
        finish();
        return;
      }
      if (status.didJustFinish) finish();
    });
    try {
      player.play();
    } catch {
      finish();
    }
  });
}

/**
 * Leitura PROGRESSIVA com a voz Gemini: gera o 1º trecho e JÁ começa a tocar;
 * enquanto um trecho toca, gera o próximo. Como tocar (~60s/trecho) é mais lento
 * que gerar (~20s/trecho), o próximo quase sempre já está pronto — e isso mantém
 * o ritmo bem abaixo do limite da API sem precisar de throttle. Ao final,
 * concatena tudo num WAV e cacheia, para a PRÓXIMA leitura tocar na hora. Se o
 * áudio completo já existir, toca direto. Se a geração falhar, cai para o sistema.
 */
async function speakLongTextGemini(
  chunks: string[],
  opts: SpeakLongOptions,
  myToken: number,
): Promise<void> {
  const voice = opts.geminiVoiceName ?? activeGeminiVoiceName;
  currentlySpeaking = true;

  // 1) Áudio completo já em cache? Toca na hora (texto já lido/salvo antes).
  const cachedUri = getCachedReadAloudUri(chunks, voice);
  if (cachedUri) {
    opts.onProgress?.(0, 1);
    await playAndWait(cachedUri, myToken, opts.rate ?? 1);
    if (myToken === speakToken) {
      currentlySpeaking = false;
      opts.onDone?.();
    }
    return;
  }

  // 2) Progressivo com BUFFER de look-ahead. Um PRODUTOR gera os trechos em
  // ordem, até LOOKAHEAD à frente do que está tocando; um CONSUMIDOR toca em
  // ordem, esperando só se o buffer esvaziar. Como gerar (~20s) é ~3x mais
  // rápido que tocar (~60s), o buffer enche e absorve a lentidão pontual de um
  // trecho (ex.: um retry de 5xx) SEM a leitura "parar" no meio — que era o bug
  // do prefetch-de-1-só.
  const LOOKAHEAD = 2;
  const uris: (string | null)[] = new Array(chunks.length).fill(null);
  const pcms: (Uint8Array | null)[] = new Array(chunks.length).fill(null);
  type GenErr = { index: number; err: unknown };
  let genErr: GenErr | null = null;
  let playIndex = 0;

  opts.onSynthProgress?.(0, chunks.length); // preparando a 1ª parte

  // PRODUTOR (fire-and-forget): gera em ordem, no máximo LOOKAHEAD à frente.
  void (async () => {
    for (let j = 0; j < chunks.length; j++) {
      while (j > playIndex + LOOKAHEAD && myToken === speakToken) {
        await sleep(250);
      }
      if (myToken !== speakToken) return;
      try {
        const { uri, pcm } = await synthesizeChunkGemini(chunks[j], voice);
        uris[j] = uri;
        pcms[j] = pcm;
      } catch (err) {
        genErr = { index: j, err };
        return;
      }
    }
  })().catch(() => {
    /* erros já viram genErr; o catch é só guarda contra unhandled rejection */
  });

  // CONSUMIDOR: toca em ordem, esperando cada trecho ficar pronto. (Lê genErr
  // num const ANOTADO porque a atribuição acontece no closure produtor, que o
  // controle de fluxo do TS não enxerga — sem a anotação ele estreita p/ never.)
  for (let i = 0; i < chunks.length; i++) {
    playIndex = i;
    if (myToken !== speakToken) return;
    for (;;) {
      const ge = genErr as GenErr | null;
      if (uris[i] !== null || (ge && ge.index <= i)) break;
      if (myToken !== speakToken) return;
      opts.onSynthProgress?.(i, chunks.length); // "preparando parte i+1…"
      await sleep(250);
    }
    const ge = genErr as GenErr | null;
    if (ge && ge.index <= i) {
      // O trecho i (após os retries internos) falhou → lê o RESTO pela voz do
      // sistema (sem cachear o parcial).
      console.warn('Gemini TTS (trecho) falhou; voz do sistema:', ge.err);
      opts.onFallback?.(ge.err);
      readSystemChunks(chunks.slice(i), 0, opts, myToken);
      return;
    }
    if (myToken !== speakToken) return;
    opts.onProgress?.(i, chunks.length); // tocando a parte i+1
    await playAndWait(uris[i] as string, myToken, opts.rate ?? 1);
  }

  if (myToken !== speakToken) return;
  // 3) Tudo tocou → concatena e cacheia o WAV completo (próxima = instantâneo).
  try {
    const all = pcms.filter((p): p is Uint8Array => !!p);
    if (all.length === chunks.length) await saveFullReadAloud(chunks, voice, all);
  } catch {
    /* cache é best-effort */
  }
  currentlySpeaking = false;
  opts.onDone?.();
}

/**
 * Toca um áudio JÁ SALVO (`uri`) direto, sem gerar nada. Usado quando o usuário
 * toca num texto salvo que já tem áudio guardado.
 */
export async function playSavedAudio(
  uri: string,
  opts: { rate?: number; onDone?: () => void; onError?: (e: unknown) => void } = {},
): Promise<void> {
  await ensureBackgroundAudio(); // continua tocando com a tela apagada
  const myToken = ++speakToken;
  await stopPlayback();
  if (myToken !== speakToken) return;
  currentlySpeaking = true;
  try {
    await playAndWait(uri, myToken, opts.rate ?? 1);
    if (myToken === speakToken) {
      currentlySpeaking = false;
      opts.onDone?.();
    }
  } catch (e) {
    if (myToken === speakToken) {
      currentlySpeaking = false;
      opts.onError?.(e);
    }
  }
}

/** Para a reprodução atual (sistema + player Gemini) SEM invalidar o token. */
async function stopPlayback() {
  try {
    await Speech.stop();
  } catch {
    /* noop */
  }
  if (activeGeminiPlayer) {
    try {
      activeGeminiPlayer.pause();
    } catch {
      /* noop */
    }
    releaseGeminiPlayer(activeGeminiPlayer);
  }
  // Destrava um `playAndWait` em espera (leitura progressiva), para o laço
  // perceber a parada e não ficar pendurado.
  if (activePlaybackFinish) {
    const f = activePlaybackFinish;
    activePlaybackFinish = null;
    f();
  }
  currentlySpeaking = false;
}

export async function stopSpeaking() {
  // Incrementa o token: qualquer síntese/encadeamento em voo vira "superado"
  // e não vai tocar nem encadear o próximo pedaço.
  speakToken++;
  await stopPlayback();
}

export function isSpeaking(): boolean {
  return currentlySpeaking;
}

/**
 * Opens the system text-to-speech settings on Android, where the user can
 * install additional voice data (e.g. pt-BR voices). No-op on iOS.
 */
export async function openAndroidTTSSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    // Linking.sendIntent is Android-only and built into react-native; no
    // extra package required. The action constant comes from AOSP Settings.
    await Linking.sendIntent('com.android.settings.TTS_SETTINGS');
    return true;
  } catch (err) {
    console.warn('TTS_SETTINGS intent failed, trying generic settings:', err);
    try {
      await Linking.sendIntent('android.settings.SETTINGS');
      return true;
    } catch (err2) {
      console.warn('settings intent failed:', err2);
      return false;
    }
  }
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  } catch (err) {
    console.warn('speech permissions failed:', err);
    return false;
  }
}

export interface RecognitionHandlers {
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (code: string, message: string) => void;
  onEnd?: () => void;
}

export async function startListening(
  handlers: RecognitionHandlers = {},
): Promise<() => void> {
  const granted = await ensureSpeechPermissions();
  if (!granted) {
    handlers.onError?.('permission-denied', 'Permissão de microfone negada');
    return () => {};
  }

  const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event) => {
    const result = event?.results?.[0];
    if (!result) return;
    handlers.onResult?.(result.transcript ?? '', !!event.isFinal);
  });
  const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event) => {
    handlers.onError?.(event.error ?? 'unknown', event.message ?? 'erro de reconhecimento');
  });
  const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
    handlers.onEnd?.();
  });

  const opts: ExpoSpeechRecognitionOptions = {
    lang: 'pt-BR',
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    requiresOnDeviceRecognition: false,
    addsPunctuation: true,
  };

  try {
    ExpoSpeechRecognitionModule.start(opts);
  } catch (err) {
    handlers.onError?.('start-failed', err instanceof Error ? err.message : String(err));
  }

  return () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* noop */
    }
    resultSub.remove();
    errorSub.remove();
    endSub.remove();
  };
}

export async function stopListening() {
  try {
    await ExpoSpeechRecognitionModule.stop();
  } catch {
    /* noop */
  }
}
