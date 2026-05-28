// Toca o canto da coruja DENTRO do app (expo-audio).
//
// Diferente do som das notificações — que depende dos canais imutáveis do
// Android e não funciona em todo aparelho — este caminho toca um asset
// empacotado direto pelo player de áudio. Funciona sempre que o volume de
// mídia estiver ligado. É o caminho confiável para o usuário ouvir a coruja.

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { getOwlSpecies } from '../constants/owlSpecies';
import type { OwlSpeciesId } from '../types';

let active: AudioPlayer | null = null;

function release(player: AudioPlayer): void {
  try {
    player.remove();
  } catch {
    /* já liberado */
  }
}

/**
 * Toca o canto da coruja escolhida. A espécie "default" (som padrão do
 * sistema) não tem áudio próprio, então não toca nada aqui. Falhas são
 * engolidas — nunca derrubam o app.
 */
export function playOwlCall(species?: OwlSpeciesId | null): void {
  const asset = getOwlSpecies(species).soundAsset;
  if (asset == null) return;
  try {
    if (active) {
      release(active);
      active = null;
    }
    const player = createAudioPlayer(asset);
    active = player;
    player.play();
    // Os sons isolados têm ~5–12 s; libera o player com folga depois disso.
    setTimeout(() => {
      release(player);
      if (active === player) active = null;
    }, 15000);
  } catch (err) {
    console.warn('playOwlCall falhou:', err);
  }
}
