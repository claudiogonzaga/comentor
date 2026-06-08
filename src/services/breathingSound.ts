// Toca o som de fundo do exercício de respiração DENTRO do app (expo-audio).
//
// Mesma ideia do owlSound.ts, mas aqui as trilhas são longas (~3 min) e tocam
// em loop enquanto o guia 2-2-4 roda. A fonte pode ser um asset embutido
// (trilhas 'cello'/'piano'/'organ') ou um arquivo que o usuário subiu
// (id 'custom', cujo file:// vem da config). Falhas são engolidas — nunca
// derrubam o app.

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { getBreathingSound, type BreathingSoundId } from '../constants/breathingSounds';

let active: AudioPlayer | null = null;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

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
export function playBreathingSound(opts: {
  id: string;
  customUri?: string | null;
  loop?: boolean;
}): boolean {
  const source = resolveSource(opts.id, opts.customUri ?? null);
  if (source == null) return false;
  try {
    stopBreathingSound();
    const player = createAudioPlayer(source);
    active = player;
    player.loop = opts.loop !== false;
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
  const ok = playBreathingSound({ id, customUri, loop: false });
  if (!ok) return;
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => stopBreathingSound(), seconds * 1000);
}
