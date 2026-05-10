import * as Speech from 'expo-speech';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionOptions,
} from 'expo-speech-recognition';

const TTS_LANGUAGE = 'pt-BR';

interface SpeakOptions {
  onDone?: () => void;
  onError?: (e: unknown) => void;
}

let currentlySpeaking = false;

function pickPtBrVoice(voices: Speech.Voice[]): Speech.Voice | undefined {
  const ptVoices = voices.filter((v) => v.language?.toLowerCase().startsWith('pt'));
  if (ptVoices.length === 0) return undefined;
  // Prefer a higher-quality voice when listed
  const enhanced = ptVoices.find((v) => v.quality === Speech.VoiceQuality.Enhanced);
  return enhanced ?? ptVoices[0];
}

let cachedVoiceId: string | null | undefined; // undefined = not loaded; null = no pt voice

async function getVoiceId(): Promise<string | null> {
  if (cachedVoiceId !== undefined) return cachedVoiceId;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const v = pickPtBrVoice(voices);
    cachedVoiceId = v?.identifier ?? null;
  } catch {
    cachedVoiceId = null;
  }
  return cachedVoiceId;
}

export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!text.trim()) return;
  await stopSpeaking();
  const voiceId = await getVoiceId();
  currentlySpeaking = true;
  Speech.speak(text, {
    language: TTS_LANGUAGE,
    voice: voiceId ?? undefined,
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
