import { Linking, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';
import {
  DEFAULT_GEMINI_VOICE,
  GeminiTTSError,
  synthesizeFullSpeechGemini,
  synthesizeSpeechGemini,
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
export function chunkText(text: string, maxLen = 3500): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const sentences = clean.match(/[^.!?…\n]+[.!?…]*\n*|\n+/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > maxLen) {
      if (cur.trim()) {
        chunks.push(cur.trim());
        cur = '';
      }
      for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen).trim());
      continue;
    }
    if ((cur + s).length > maxLen) {
      if (cur.trim()) chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

interface SpeakLongOptions {
  /** 'system' (expo-speech) ou 'gemini' (TTS neural). Padrão: 'system'. */
  provider?: VoiceProvider;
  voiceId?: string | null;
  language?: string | null;
  /** Voz Gemini, quando provider === 'gemini'. */
  geminiVoiceName?: string;
  /** Velocidade (só sistema). 1.0 = normal. */
  rate?: number;
  onDone?: () => void;
  onError?: (e: unknown) => void;
  /** Progresso: pedaço atual (0-based) e total de pedaços. */
  onProgress?: (index: number, total: number) => void;
  /** Progresso da GERAÇÃO do áudio Gemini (só na 1ª vez): feitos / total. */
  onSynthProgress?: (done: number, total: number) => void;
}

/**
 * Lê um texto longo em voz alta, quebrando em pedaços e encadeando um após o
 * outro. Usado pela tela "Leia para mim" (visualização, auto-hipnose, oração).
 * Com provider 'system' usa expo-speech (com velocidade ajustável); com
 * 'gemini' sintetiza cada pedaço pela API neural e toca em sequência (voz
 * profissional, leitura pausada). Respeita o token de geração: `stopSpeaking()`
 * interrompe na hora e não encadeia o próximo.
 */
/** Limite de caracteres por pedaço, por provider (Gemini é mais conservador). */
const GEMINI_CHUNK_MAX = 800;
const SYSTEM_CHUNK_MAX = 3500;

export async function speakLongText(
  text: string,
  opts: SpeakLongOptions = {},
): Promise<void> {
  const provider = opts.provider ?? 'system';
  const chunks = chunkText(text, provider === 'gemini' ? GEMINI_CHUNK_MAX : SYSTEM_CHUNK_MAX);
  if (chunks.length === 0) return;
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
  opts: { geminiVoiceName?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const chunks = chunkText(text, GEMINI_CHUNK_MAX);
  if (chunks.length === 0) return;
  await synthesizeFullSpeechGemini(
    chunks,
    opts.geminiVoiceName ?? activeGeminiVoiceName,
    opts.onProgress,
  );
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
 * Gera o áudio Gemini do texto INTEIRO de uma vez (concatenado num único
 * arquivo, salvo em disco) e toca SEM as pausas de rede entre os trechos. Na
 * 1ª vez gera (reporta `onSynthProgress`); depois o arquivo já está salvo e
 * toca na hora. Se a geração falhar (cota/rede), cai para a voz do sistema.
 */
async function speakLongTextGemini(
  chunks: string[],
  opts: SpeakLongOptions,
  myToken: number,
): Promise<void> {
  const voice = opts.geminiVoiceName ?? activeGeminiVoiceName;
  currentlySpeaking = true;
  try {
    const { uri } = await synthesizeFullSpeechGemini(chunks, voice, (done, total) => {
      if (myToken === speakToken) opts.onSynthProgress?.(done, total);
    });
    if (myToken !== speakToken) return;
    const player = createAudioPlayer({ uri });
    activeGeminiPlayer = player;
    opts.onProgress?.(0, 1); // saiu da geração, começou a tocar (contínuo)
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
    if (myToken !== speakToken) return;
    // Gemini falhou — segue pela voz do sistema para não travar.
    console.warn('Gemini TTS (áudio completo) falhou; seguindo pela voz do sistema:', err);
    readSystemChunks(chunks, 0, opts, myToken);
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
