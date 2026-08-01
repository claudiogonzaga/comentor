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

/**
 * Entra no modo de áudio do exercício de respiração.
 *
 * `shouldPlayInBackground` mantém o foreground service de mídia do expo-audio
 * segurando o áudio: o usuário apaga a tela para dormir e a trilha continua.
 *
 * `interruptionMode: 'mixWithOthers'` é a diferença que importa aqui. Com
 * `duckOthers` (o padrão do resto do app) o app PEDE foco de áudio transitório,
 * e aí o Android abaixa o volume de quem já estava tocando — pior ainda, os
 * players que não implementam ducking (Music Folder Player, vários apps de
 * audiolivro) tratam isso como perda de foco e simplesmente PAUSAM. Com
 * `mixWithOthers` não pedimos foco nenhum: a trilha da respiração toca por cima
 * do que já estiver tocando, sem mexer no volume do outro app.
 *
 * NÃO tem guarda de "já configurado" de propósito: o modo é global do app e as
 * outras telas (Leia para mim, fila de mídia) sobrescrevem para `duckOthers`,
 * então precisa ser reaplicado a cada play. É a mesma lição registrada no
 * comentário do useReadAloud.
 */
async function enterMixingAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    });
  } catch {
    /* se falhar, toca em primeiro plano mesmo */
  }
}

/**
 * Devolve o modo padrão do app ao encerrar o exercício, para que os avisos
 * falados, os nudges e o "Leia para mim" continuem ducando como antes.
 */
async function restoreDefaultAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  } catch {
    /* nada a fazer — o próximo player seta o modo de novo */
  }
}

function release(player: AudioPlayer): void {
  try {
    player.remove();
  } catch {
    /* já liberado */
  }
}

/**
 * Para e libera a trilha ativa. `restoreMode` distingue os dois motivos de
 * parar: o usuário encerrando o exercício (devolve o modo de áudio padrão) e a
 * limpeza interna antes de trocar de trilha (não devolve — quem chamou vai
 * ligar o modo de mistura logo em seguida, e um restore assíncrono em voo
 * poderia aterrissar depois e desfazê-lo).
 */
function stopActiveSound(restoreMode: boolean): void {
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
    if (restoreMode) void restoreDefaultAudioMode();
  }
}

/** Para e libera o som de respiração que estiver tocando. */
export function stopBreathingSound(): void {
  stopActiveSound(true);
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
    stopActiveSound(false); // troca de trilha: para sem devolver o modo de áudio
    // Depois do stop, para o restore não correr por cima: trilha por cima do
    // que o usuário já estiver ouvindo, e seguindo com a tela apagada.
    await enterMixingAudioMode();
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
