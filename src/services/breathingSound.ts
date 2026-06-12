// Toca o som de fundo do exercício de respiração DENTRO do app (expo-audio).
//
// Mesma ideia do owlSound.ts, mas aqui as trilhas são longas (~3 min) e tocam
// em loop enquanto o guia 2-2-4 roda. A fonte pode ser um asset embutido
// (trilhas 'cello'/'piano'/'organ') ou um arquivo que o usuário subiu
// (id 'custom', cujo file:// vem da config). Falhas são engolidas — nunca
// derrubam o app.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { getBreathingSound, type BreathingSoundId } from '../constants/breathingSounds';

let active: AudioPlayer | null = null;
let activeStatusSub: { remove: () => void } | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundReady = false;

/**
 * Liga a reprodução em SEGUNDO PLANO (continua com a tela apagada/bloqueada). O
 * usuário apaga a tela para dormir — o som da respiração precisa seguir tocando.
 * Igual ao "Leia para mim": `shouldPlayInBackground` mantém o foreground service
 * de mídia do expo-audio segurando o áudio. Idempotente.
 */
async function ensureBackgroundAudio(): Promise<void> {
  if (backgroundReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
    backgroundReady = true;
  } catch {
    /* se falhar, toca em primeiro plano mesmo */
  }
}

function release(player: AudioPlayer): void {
  try {
    player.remove();
  } catch {
    /* já liberado */
  }
}

/** Para e libera o som de respiração que estiver tocando. */
export function stopBreathingSound(): void {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (activeStatusSub) {
    try {
      activeStatusSub.remove();
    } catch {
      /* já removido */
    }
    activeStatusSub = null;
  }
  if (active) {
    try {
      active.pause();
    } catch {
      /* ignore */
    }
    release(active);
    active = null;
  }
}

/** Resolve a fonte de áudio: asset embutido (number) ou { uri } do usuário. */
function resolveSource(
  id: string,
  customUri: string | null,
): number | { uri: string } | null {
  // 'custom' (legado) ou 'custom:<id>' (vários sons): o caller resolve o uri.
  if (id === 'custom' || id.startsWith('custom:')) {
    return customUri ? { uri: customUri } : null;
  }
  const asset = getBreathingSound(id as BreathingSoundId).asset;
  return asset ?? null;
}

/**
 * Toca o som de respiração escolhido (por padrão em loop). Substitui qualquer
 * som ativo. Retorna false se não havia nada para tocar (ex.: 'custom' sem
 * arquivo).
 */
export async function playBreathingSound(opts: {
  id: string;
  customUri?: string | null;
  loop?: boolean;
  /**
   * Para SOZINHO depois de N ms e chama `onAutoStop`. IMPORTANTE: o relógio é
   * dirigido pelos eventos de status do PLAYER NATIVO (e não por setTimeout),
   * porque com a tela apagada o Android congela os timers JS do React Native —
   * os eventos do áudio continuam chegando (o som segue no foreground service).
   * É o que permite encadear respiração → "Leia para mim" no escuro.
   */
  stopAfterMs?: number | null;
  onAutoStop?: () => void;
}): Promise<boolean> {
  const source = resolveSource(opts.id, opts.customUri ?? null);
  if (source == null) return false;
  try {
    await ensureBackgroundAudio(); // continua tocando com a tela apagada
    stopBreathingSound();
    const player = createAudioPlayer(source);
    active = player;
    player.loop = opts.loop !== false;
    if (opts.stopAfterMs != null && opts.stopAfterMs > 0) {
      const endAt = Date.now() + opts.stopAfterMs;
      const onAutoStop = opts.onAutoStop;
      activeStatusSub = player.addListener('playbackStatusUpdate', () => {
        if (Date.now() < endAt) return;
        stopBreathingSound(); // remove o listener e libera o player
        onAutoStop?.();
      });
    }
    player.play();
    return true;
  } catch (err) {
    console.warn('playBreathingSound falhou:', err);
    return false;
  }
}

/** Toca uma prévia curta (alguns segundos) e para — usado no seletor. */
export function previewBreathingSound(
  id: string,
  customUri: string | null,
  seconds = 8,
): void {
  void playBreathingSound({ id, customUri, loop: false }).then((ok) => {
    if (!ok) return;
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => stopBreathingSound(), seconds * 1000);
  });
}
