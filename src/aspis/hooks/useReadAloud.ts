// Leitura em voz alta de um texto com a voz do Gemini. Sintetiza (cacheado) e
// toca via expo-audio. Um único botão alterna: tocar → parar. Libera o player
// ao terminar e ao desmontar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { GeminiTTSError, synthesizeSpeech } from '../services/geminiTTS';

export type ReadAloudStatus = 'idle' | 'loading' | 'playing';

export interface UseReadAloud {
  status: ReadAloudStatus;
  error: string | null;
  isKeyError: boolean;
  toggle: (text: string, voice: string, apiKey: string) => Promise<void>;
  stop: () => void;
}

export function useReadAloud(): UseReadAloud {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isKeyError, setIsKeyError] = useState(false);

  const stop = useCallback(() => {
    const p = playerRef.current;
    playerRef.current = null;
    if (p) {
      try {
        p.remove();
      } catch {
        /* já liberado */
      }
    }
    setStatus('idle');
  }, []);

  useEffect(() => () => stop(), [stop]);

  const toggle = useCallback(
    async (text: string, voice: string, apiKey: string) => {
      // Botão único: se está tocando/gerando, a próxima toque para.
      if (status !== 'idle') {
        stop();
        return;
      }
      setError(null);
      setIsKeyError(false);
      setStatus('loading');
      try {
        const { uri } = await synthesizeSpeech(text, voice, apiKey);
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
        const player = createAudioPlayer({ uri });
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (s) => {
          if (s.didJustFinish) stop();
        });
        player.play();
        setStatus('playing');
      } catch (e) {
        setIsKeyError(e instanceof GeminiTTSError && e.isKeyError);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('idle');
      }
    },
    [status, stop],
  );

  return { status, error, isKeyError, toggle, stop };
}
