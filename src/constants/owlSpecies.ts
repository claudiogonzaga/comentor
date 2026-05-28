import type { OwlSpeciesId } from '../types';

export interface OwlSpecies {
  id: OwlSpeciesId;
  /** Nome popular exibido na UI. */
  name: string;
  /** Nome científico. */
  scientific: string;
  /** Descrição curta da vocalização. */
  call: string;
  /**
   * Nome do arquivo usado no canal de notificação do Android
   * (assets/sounds/<file>). `null` = usa o som padrão do sistema.
   */
  soundFile: string | null;
  /**
   * Asset empacotado para tocar o canto dentro do app (expo-audio).
   * `null` = sem áudio próprio (usa o som padrão do sistema).
   */
  soundAsset: number | null;
  emoji: string;
}

/**
 * Espécie usada quando o usuário ainda não escolheu nenhuma.
 * Coruja-buraqueira: vocalização curta e ritmada, não assustadora.
 */
export const DEFAULT_OWL_SPECIES: OwlSpeciesId = 'buraqueira';

export const OWL_SPECIES: OwlSpecies[] = [
  {
    id: 'buraqueira',
    name: 'Coruja-buraqueira',
    scientific: 'Athene cunicularia',
    call: '"coo-coooo" curto e ritmado — a coruja que vive em buracos no chão',
    soundFile: 'owl_buraqueira.mp3',
    soundAsset: require('../../assets/sounds/owl_buraqueira.mp3'),
    emoji: '🦉',
  },
  {
    id: 'corujinha_mato',
    name: 'Corujinha-do-mato',
    scientific: 'Megascops choliba',
    call: '"krrrrr-krr-krr" crescente — pequena coruja brasileira com tufos',
    soundFile: 'owl_corujinha_mato.mp3',
    soundAsset: require('../../assets/sounds/owl_corujinha_mato.mp3'),
    emoji: '🦉',
  },
  {
    id: 'bubo_bubo',
    name: 'Bufo-real',
    scientific: 'Bubo bubo',
    call: '"uhu" profundo e ressonante — uma das maiores corujas do mundo',
    soundFile: 'owl_bubo_bubo.mp3',
    soundAsset: require('../../assets/sounds/owl_bubo_bubo.mp3'),
    emoji: '🦉',
  },
  {
    id: 'default',
    name: 'Som padrão do Android',
    scientific: '',
    call: 'Toque de notificação do próprio celular — escolha esta opção se o som da coruja não tocar',
    soundFile: null,
    soundAsset: null,
    emoji: '🔔',
  },
];

export function getOwlSpecies(id: OwlSpeciesId | null | undefined): OwlSpecies {
  return (
    OWL_SPECIES.find((s) => s.id === id) ??
    OWL_SPECIES.find((s) => s.id === DEFAULT_OWL_SPECIES)!
  );
}

/** Lista de arquivos para o plugin expo-notifications empacotar no build. */
export const OWL_SOUND_FILES: string[] = OWL_SPECIES.map((s) => s.soundFile).filter(
  (f): f is string => f !== null,
);
