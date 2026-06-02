// Sons de fundo do exercício de respiração (tocados DENTRO do app via
// expo-audio, em loop, enquanto o guia 2-2-4 roda). Diferente do canto da
// coruja (notificações), estes são trilhas calmas de ~3 min.
//
// Além das opções embutidas, o usuário pode subir o próprio arquivo de áudio
// (id 'custom'); nesse caso o som vem de `config.breathingSoundUri`, não daqui.

export type BreathingSoundId = 'tone' | 'piano' | 'cello' | 'organ' | 'custom';

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
export const DEFAULT_BREATHING_SOUND: BreathingSoundId = 'tone';

export const BREATHING_SOUNDS: BreathingSound[] = [
  {
    id: 'tone',
    name: 'Tom original',
    description: 'Drone calmo e contínuo — sem melodia, só uma base para respirar',
    asset: require('../../assets/sounds/breath_tone.mp3'),
  },
  {
    id: 'piano',
    name: 'Piano',
    description: 'Notas suaves de piano, lentas e espaçadas',
    asset: require('../../assets/sounds/breath_piano.mp3'),
  },
  {
    id: 'cello',
    name: 'Violoncelo',
    description: 'Cordas graves e quentes, sustentadas',
    asset: require('../../assets/sounds/breath_cello.mp3'),
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
