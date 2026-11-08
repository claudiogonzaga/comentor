// Ícone de um hábito. O hábito guarda um EMOJI (é o que vai no texto da
// notificação do Android e na sincronização com o Mac); dentro do app ele vira
// um ícone grego monolinear, como no resto da Noosfera. Aos 12 ícones dos
// lembretes somam-se alguns que só fazem sentido para hábitos (leitura,
// escrita, meditação, gratidão, força, celular) — os três que o GreekIcon não
// tem são desenhados aqui, no mesmo traço.

import Svg, { Line, Path } from 'react-native-svg';
import { GreekIcon, type GreekIconName } from './GreekIcon';
import { iconForEmoji } from '../services/todos';
import { colors } from '../theme';

export type HabitIconName = GreekIconName | 'book' | 'pen' | 'lotus';

export interface HabitIconChoice {
  icon: HabitIconName;
  emoji: string;
  label: string;
}

/** As 12 opções de RemindersScreen, na mesma ordem, e as novas no fim. */
export const HABIT_ICON_CHOICES: HabitIconChoice[] = [
  { icon: 'pill', emoji: '💊', label: 'Remédio' },
  { icon: 'leaf', emoji: '🌿', label: 'Suplemento' },
  { icon: 'drop', emoji: '💧', label: 'Água' },
  { icon: 'bowl', emoji: '🍲', label: 'Comida' },
  { icon: 'fasting', emoji: '⏳', label: 'Jejum' },
  { icon: 'coffee', emoji: '☕', label: 'Café' },
  { icon: 'sun', emoji: '☀️', label: 'Manhã' },
  { icon: 'sunset', emoji: '🕶️', label: 'Luz azul' },
  { icon: 'wind', emoji: '🌬️', label: 'Respiração' },
  { icon: 'footsteps', emoji: '🏃', label: 'Exercício' },
  { icon: 'moon', emoji: '🌙', label: 'Noite' },
  { icon: 'bell', emoji: '🔔', label: 'Lembrete' },
  { icon: 'book', emoji: '📖', label: 'Leitura' },
  { icon: 'pen', emoji: '✍️', label: 'Escrever' },
  { icon: 'lotus', emoji: '🧘', label: 'Meditar' },
  { icon: 'heart', emoji: '❤️', label: 'Gratidão' },
  { icon: 'activity', emoji: '💪', label: 'Força' },
  { icon: 'phone', emoji: '📱', label: 'Celular' },
];

/** Emoji → ícone. Os novos primeiro; o resto segue o mapa dos lembretes. */
export function habitIconName(emoji: string | null | undefined): HabitIconName {
  switch (emoji) {
    case '📖':
    case '📚':
      return 'book';
    case '✍️':
    case '📝':
      return 'pen';
    case '🧘':
    case '🧘‍♀️':
    case '🧘‍♂️':
      return 'lotus';
    case '❤️':
    case '🙏':
      return 'heart';
    case '💪':
      return 'activity';
    case '📱':
    case '📵':
      return 'phone';
    case '🧠':
      return 'brain';
    default:
      return iconForEmoji(emoji, 'nudge');
  }
}

export function HabitIcon({
  emoji,
  name,
  size = 22,
  color = colors.text.primary,
}: {
  emoji?: string | null;
  name?: HabitIconName;
  size?: number;
  color?: string;
}) {
  const icon = name ?? habitIconName(emoji);
  const common = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  if (icon === 'book') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M3 5.5c2.6-1 5.6-1 9 1v13c-3.4-2-6.4-2-9-1z" {...common} />
        <Path d="M21 5.5c-2.6-1-5.6-1-9 1v13c3.4-2 6.4-2 9-1z" {...common} />
      </Svg>
    );
  }
  if (icon === 'pen') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M4 20l1.2-4.2L15.8 5.2a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.2 18.8z" {...common} />
        <Line x1={14} y1={7} x2={17} y2={10} {...common} />
      </Svg>
    );
  }
  if (icon === 'lotus') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M12 5.5c2.2 2.6 2.2 6.6 0 9.5-2.2-2.9-2.2-6.9 0-9.5z" {...common} />
        <Path d="M12 15c-3.2 0-6.2-2-7.6-5.2 3.2 0 5.8 1.7 7.6 5.2z" {...common} />
        <Path d="M12 15c3.2 0 6.2-2 7.6-5.2-3.2 0-5.8 1.7-7.6 5.2z" {...common} />
        <Line x1={5} y1={18.5} x2={19} y2={18.5} {...common} />
      </Svg>
    );
  }
  return <GreekIcon name={icon} size={size} color={color} />;
}
