// Sons de fundo do exercício de respiração (tocados DENTRO do app via
// expo-audio, em loop, enquanto o guia 2-2-4 roda). Diferente do canto da
// coruja (notificações), estes são trilhas calmas de ~3 min.
//
// Além das opções embutidas, o usuário pode subir o próprio arquivo de áudio
// (id 'custom'); nesse caso o som vem de `config.breathingSoundUri`, não daqui.

export type BreathingSoundId =
  | 'cello'
  | 'bowl'
  | 'handpan'
  | 'bells'
  | 'crystal'
  | 'piano'
  | 'organ'
  | 'custom';

export interface BreathingSound {
  id: BreathingSoundId;
  /** Nome exibido na UI. */
  name: string;
  /** Descrição curta da trilha. */
  description: string;
  /**
   * Asset empacotado para tocar (expo-audio). `null` = a opção não tem áudio
   * próprio embutido (caso do 'custom', que usa o arquivo do usuário).
   */
  asset: number | null;
}

/** Som usado quando o usuário ainda não escolheu nenhum. */
export const DEFAULT_BREATHING_SOUND: BreathingSoundId = 'cello';

export const BREATHING_SOUNDS: BreathingSound[] = [
  {
    id: 'cello',
    name: 'Violoncelo',
    description: 'Cordas graves e quentes, uma oitava abaixo — sustentadas e calmas',
    asset: require('../../assets/sounds/breath_cello.mp3'),
  },
  {
    id: 'bowl',
    name: 'Tigela tibetana',
    description: 'Tigela cantante — ressonância profunda e meditativa',
    asset: require('../../assets/sounds/breath_bowl.mp3'),
  },
  {
    id: 'handpan',
    name: 'Handpan',
    description: 'Handpan (hang) — notas suaves e harmônicas',
    asset: require('../../assets/sounds/breath_handpan.mp3'),
  },
  {
    id: 'bells',
    name: 'Sinos tubulares',
    description: 'Sinos tubulares — timbres longos e cristalinos',
    asset: require('../../assets/sounds/breath_bells.mp3'),
  },
  {
    id: 'crystal',
    name: 'Cristal',
    description: 'Taças de cristal — brilho etéreo e sustentado',
    asset: require('../../assets/sounds/breath_crystal.mp3'),
  },
  {
    id: 'piano',
    name: 'Piano',
    description: 'Piano Yamaha — notas suaves, lentas e espaçadas',
    asset: require('../../assets/sounds/breath_piano.mp3'),
  },
  {
    id: 'organ',
    name: 'Órgão',
    description: 'Acordes longos de órgão, atmosféricos',
    asset: require('../../assets/sounds/breath_organ.mp3'),
  },
  {
    id: 'custom',
    name: 'Meu áudio',
    description: 'Suba um arquivo de áudio seu (mp3, m4a, wav…) para tocar aqui',
    asset: null,
  },
];

export function getBreathingSound(
  id: BreathingSoundId | null | undefined,
): BreathingSound {
  return (
    BREATHING_SOUNDS.find((s) => s.id === id) ??
    BREATHING_SOUNDS.find((s) => s.id === DEFAULT_BREATHING_SOUND)!
  );
}
