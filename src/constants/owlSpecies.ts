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
    id: 'suindara',
    name: 'Suindara',
    scientific: 'Tyto furcata',
    call: 'Grito raspado e descendente',
    soundFile: 'owl_suindara.wav',
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
    id: 'mocho',
    name: 'Mocho-orelhudo',
    scientific: 'Asio clamator',
    call: 'Assobio único e descendente',
    soundFile: 'owl_mocho.wav',
    emoji: '🦉',
  },
  {
    id: 'listrada',
    name: 'Coruja-listrada',
    scientific: 'Strix hylophila',
    call: 'Pio rítmico "u u u-u"',
    soundFile: 'owl_listrada.wav',
    emoji: '🦉',
  },
  {
    id: 'default',
    name: 'Som padrão do sistema',
    scientific: '',
    call: 'Sem som de coruja — usa o toque padrão do celular',
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
