import { Linking, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';

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

// Active voice state — set explicitly via setActiveVoice() OR resolved by
// auto-pick when listing. Lives in module memory; persisted in user_config
// by callers (Settings/onboarding).
let activeVoiceId: string | null = null;
let activeLanguage: string | null = null;

export function setActiveVoice(voiceId: string | null, language: string | null) {
  activeVoiceId = voiceId;
  activeLanguage = language;
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

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!text.trim()) return;
  await stopSpeaking();
  const resolved =
    opts.voiceId !== undefined
      ? { id: opts.voiceId, lang: opts.language ?? DEFAULT_LANGUAGE }
      : await resolveVoice();
  currentlySpeaking = true;
  Speech.speak(text, {
    language: resolved.lang,
    voice: resolved.id ?? undefined,
    rate: 1.0,
    pitch: 1.0,
    onDone: () => {
      currentlySpeaking = false;
      opts.onDone?.();
    },
    onStopped: () => {
      currentlySpeaking = false;
    },
    onError: (e) => {
      currentlySpeaking = false;
      opts.onError?.(e);
    },
  });
}

export async function previewVoice(voice: EnrichedVoice): Promise<void> {
  await speak(
    'Oi, eu sou a sua corujinha. Vamos dormir melhor essa noite?',
    { voiceId: voice.identifier, language: voice.language || DEFAULT_LANGUAGE },
  );
}

export async function stopSpeaking() {
  try {
    await Speech.stop();
  } catch {
    /* noop */
  }
  currentlySpeaking = false;
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
