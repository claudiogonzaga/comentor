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
   * Nome do arquivo de som empacotado no app (assets/sounds/<file>).
   * `null` = usa o som padrão do sistema (sem coruja).
   */
  soundFile: string | null;
  emoji: string;
}

/**
 * Espécie usada quando o usuário ainda não escolheu nenhuma.
 * Caburé: chamado distinto, alegre e não assustador — bom default noturno.
 */
export const DEFAULT_OWL_SPECIES: OwlSpeciesId = 'cabure';

export const OWL_SPECIES: OwlSpecies[] = [
  {
    id: 'cabure',
    name: 'Caburé',
    scientific: 'Glaucidium brasilianum',
    call: 'Série de assobios curtos e ritmados',
    soundFile: 'owl_cabure.wav',
    emoji: '🦉',
  },
  {
    id: 'buraqueira',
    name: 'Coruja-buraqueira',
    scientific: 'Athene cunicularia',
    call: 'Dois toques suaves "cu-cuuu"',
    soundFile: 'owl_buraqueira.wav',
    emoji: '🦉',
  },
  {
    id: 'murucututu',
    name: 'Murucututu',
    scientific: 'Pulsatrix perspicillata',
    call: 'Batidas graves que aceleram',
    soundFile: 'owl_murucututu.wav',
    emoji: '🦉',
  },
  {
    id: 'default',
    name: 'Som padrão do Android',
    scientific: '',
    call: 'Toque de notificação do próprio celular — escolha esta opção se o som da coruja não tocar',
    soundFile: null,
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
