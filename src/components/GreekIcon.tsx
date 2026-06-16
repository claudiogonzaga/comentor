import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { colors } from '../theme';

/**
 * Conjunto de ícones monolineares em "preto sobre terracota" — o mesmo
 * vocabulário visual do vaso grego do app (figura negra `#2A1A10`). Substitui
 * os emojis coloridos, que quebravam a estética. Todos desenhados numa
 * viewBox 24×24, traço arredondado, sem preenchimento de cor.
 *
 * Uso: <GreekIcon name="moon" size={22} />  (cor = preto por padrão)
 */
export type GreekIconName =
  | 'settings'
  | 'moon'
  | 'chat'
  | 'check'
  | 'clock'
  | 'pill'
  | 'leaf'
  | 'sound'
  | 'mute'
  | 'voice'
  | 'stats'
  | 'sparkle'
  | 'sunset'
  | 'wind'
  | 'bell'
  | 'plus'
  | 'chevronRight'
  | 'drop'
  | 'bowl'
  | 'fasting'
  | 'owl'
  | 'trash'
  | 'sun'
  | 'coffee'
  | 'heart'
  | 'activity'
  | 'footsteps'
  | 'cloud'
  | 'phone'
  | 'brain'
  | 'mute'
  | 'flame'
  | 'download';

interface Props {
  name: GreekIconName;
  size?: number;
  /** Cor do traço. Padrão: preto da figura grega. */
  color?: string;
  /** Espessura do traço (escalada pela viewBox 24). */
  strokeWidth?: number;
}

export function GreekIcon({
  name,
  size = 24,
  color = colors.text.primary,
  strokeWidth = 1.8,
}: Props) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, color, common)}
    </Svg>
  );
}

function renderPaths(
  name: GreekIconName,
  color: string,
  common: {
    stroke: string;
    strokeWidth: number;
    strokeLinecap: 'round';
    strokeLinejoin: 'round';
    fill: 'none';
  },
) {
  switch (name) {
    case 'settings':
      // Engrenagem (cog) — símbolo universal de ajustes.
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...common} />
          <Path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            {...common}
          />
        </>
      );
    case 'moon':
      return <Path d="M20 13.5A7.5 7.5 0 1 1 10.5 4a6 6 0 0 0 9.5 9.5Z" {...common} />;
    case 'chat':
      return (
        <Path
          d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1Z"
          {...common}
        />
      );
    case 'check':
      return <Polyline points="4,12.5 9.5,18 20,6" {...common} />;
    case 'clock':
      return (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Polyline points="12,7 12,12 16,14" {...common} />
        </>
      );
    case 'pill':
      return (
        <>
          <Rect x={3.6} y={8} width={16.8} height={8} rx={4} {...common} />
          <Line x1={12} y1={8} x2={12} y2={16} {...common} />
        </>
      );
    case 'leaf':
      return (
        <>
          <Path d="M5 18C5 10 11 5 19 5c0 8-5 14-13 14a6 6 0 0 1-1-.2Z" {...common} />
          <Path d="M9 15c2-3 5-5 8-6" {...common} />
        </>
      );
    case 'sound':
      return (
        <>
          <Path d="M4 9.5h3l4-3.5v12l-4-3.5H4Z" {...common} />
          <Path d="M15 8.5a4.5 4.5 0 0 1 0 7M17.5 6a8 8 0 0 1 0 12" {...common} />
        </>
      );
    case 'mute':
      return (
        <>
          <Path d="M4 9.5h3l4-3.5v12l-4-3.5H4Z" {...common} />
          <Line x1={15} y1={9} x2={21} y2={15} {...common} />
          <Line x1={21} y1={9} x2={15} y2={15} {...common} />
        </>
      );
    case 'voice':
      return (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} {...common} />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" {...common} />
          <Line x1={12} y1={17.5} x2={12} y2={21} {...common} />
          <Line x1={8.5} y1={21} x2={15.5} y2={21} {...common} />
        </>
      );
    case 'stats':
      return (
        <>
          <Line x1={4} y1={20} x2={20} y2={20} {...common} />
          <Rect x={5.5} y={11} width={3.4} height={6.5} {...common} />
          <Rect x={10.6} y={6.5} width={3.4} height={11} {...common} />
          <Rect x={15.7} y={13.5} width={3.4} height={4} {...common} />
        </>
      );
    case 'sparkle':
      return (
        <Path
          d="M12 3.5c.7 4.3 1.7 5.3 6 6-4.3.7-5.3 1.7-6 6-.7-4.3-1.7-5.3-6-6 4.3-.7 5.3-1.7 6-6Z"
          {...common}
        />
      );
    case 'sun':
      return (
        <>
          <Circle cx={12} cy={12} r={4} {...common} />
          <Path
            d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"
            {...common}
          />
        </>
      );
    case 'sunset':
      return (
        <>
          <Path d="M5 18h14M2.5 18h1.5M20 18h1.5" {...common} />
          <Path d="M8.5 18a3.5 3.5 0 0 1 7 0" {...common} />
          <Path d="M12 3.5v4M12 7.5 9.8 5.3M12 7.5l2.2-2.2" {...common} />
        </>
      );
    case 'wind':
      return (
        <Path
          d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5M3 12h13a2.5 2.5 0 1 1-2.5 2.5M3 16h7a2 2 0 1 1-2 2"
          {...common}
        />
      );
    case 'bell':
      return (
        <>
          <Path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2H5Z" {...common} />
          <Path d="M10 19a2 2 0 0 0 4 0" {...common} />
        </>
      );
    case 'plus':
      return <Path d="M12 5v14M5 12h14" {...common} />;
    case 'chevronRight':
      return <Polyline points="9,5 16,12 9,19" {...common} />;
    case 'drop':
      return <Path d="M12 3.5c3.2 3.6 5.5 6.4 5.5 9.5a5.5 5.5 0 0 1-11 0c0-3.1 2.3-5.9 5.5-9.5Z" {...common} />;
    case 'bowl':
      return (
        <>
          <Path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" {...common} />
          <Path d="M9 7.5c0-1.3 0-2.5 1.2-3M12.5 7.5c0-1.5 0-2.8 1.4-3.4" {...common} />
        </>
      );
    case 'fasting':
      // Ampulheta — jejum / janela de tempo.
      return (
        <>
          <Path d="M7 4h10M7 20h10" {...common} />
          <Path d="M7.5 4c0 4 4.5 5.5 4.5 8s-4.5 4-4.5 8M16.5 4c0 4-4.5 5.5-4.5 8s4.5 4 4.5 8" {...common} />
        </>
      );
    case 'owl':
      return (
        <>
          <Path d="M4.5 9a7.5 7.5 0 0 1 15 0v3a7.5 7.5 0 0 1-15 0Z" {...common} />
          <Circle cx={9} cy={10} r={2.1} {...common} />
          <Circle cx={15} cy={10} r={2.1} {...common} />
          <Path d="M12 12.2 11 14h2Z" {...common} />
          <Path d="M4.8 6 7 8M19.2 6 17 8" {...common} />
        </>
      );
    case 'trash':
      return (
        <>
          <Path d="M4.5 6.5h15M9 6.5V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" {...common} />
          <Path d="M6.5 6.5 7.5 19a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1l1-12.5" {...common} />
          <Path d="M10 10v6M14 10v6" {...common} />
        </>
      );
    case 'coffee':
      return (
        <>
          <Path d="M4.5 9h12v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4Z" {...common} />
          <Path d="M16.5 10h2a2 2 0 0 1 0 4h-2" {...common} />
          <Path d="M7 3.5c-.6.8-.6 1.6 0 2.4M10.5 3.5c-.6.8-.6 1.6 0 2.4" {...common} />
        </>
      );
    case 'heart':
      return (
        <Path
          d="M12 20.5C6.5 16.8 3.5 13.3 3.5 9.4A4 4 0 0 1 12 7.2 4 4 0 0 1 20.5 9.4c0 3.9-3 7.4-8.5 11.1Z"
          {...common}
        />
      );
    case 'activity':
      // Linha de batimento/pulso — exercício.
      return <Polyline points="3,12 7,12 9.5,6 13.5,18 16,12 21,12" {...common} />;
    case 'footsteps':
      // Duas pegadas na diagonal — passos.
      return (
        <>
          <Path d="M7.4 4c1.5 0 2.4 1.7 2.4 3.8 0 1.8-.9 3-2.4 3S5 9.6 5 7.8C5 5.7 5.9 4 7.4 4Z" {...common} />
          <Path d="M6 12.6c1.1 0 1.9.9 1.9 2.2s-.8 2.2-1.9 2.2-1.9-.9-1.9-2.2.8-2.2 1.9-2.2Z" {...common} />
          <Path d="M16.6 8.2c1.5 0 2.4 1.7 2.4 3.8 0 1.8-.9 3-2.4 3s-2.4-1.2-2.4-3c0-2.1.9-3.8 2.4-3.8Z" {...common} />
          <Path d="M15.2 16.8c1.1 0 1.9.9 1.9 2.2s-.8 2.2-1.9 2.2-1.9-.9-1.9-2.2.8-2.2 1.9-2.2Z" {...common} />
        </>
      );
    case 'cloud':
      return (
        <Path
          d="M7 18h9.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6-1.4A3.8 3.8 0 0 0 7 18Z"
          {...common}
        />
      );
    case 'phone':
      return (
        <>
          <Rect x={7} y={2.5} width={10} height={19} rx={2.2} {...common} />
          <Line x1={10.5} y1={18.6} x2={13.5} y2={18.6} {...common} />
        </>
      );
    case 'brain':
      return (
        <>
          <Path
            d="M12 5.4a3 3 0 0 0-5 2.2c-1.5.3-2.5 1.5-2.5 3 0 1 .5 1.9 1.3 2.4-.2 1.6 1 3 2.7 3 .9 0 1.7-.4 2.2-1.1"
            {...common}
          />
          <Path
            d="M12 5.4a3 3 0 0 1 5 2.2c1.5.3 2.5 1.5 2.5 3 0 1-.5 1.9-1.3 2.4.2 1.6-1 3-2.7 3-.9 0-1.7-.4-2.2-1.1"
            {...common}
          />
          <Line x1={12} y1={5.4} x2={12} y2={17.3} {...common} />
        </>
      );
    case 'mute':
      return (
        <>
          <Path d="M4 9.5h3l4-3.5v12l-4-3.5H4Z" {...common} />
          <Path d="M15 9.5 20 14.5M20 9.5 15 14.5" {...common} />
        </>
      );
    case 'flame':
      return (
        <Path
          d="M12 3.5c2 3 4.5 4.2 4.5 8a4.5 4.5 0 0 1-9 0c0-1.8.8-3 1.8-4 .2 1.2 1 1.9 1.8 1.9C12.8 9.2 13 6.5 12 3.5Z"
          {...common}
        />
      );
    case 'download':
      return (
        <>
          <Line x1={12} y1={3.5} x2={12} y2={14.5} {...common} />
          <Polyline points="7.5,10 12,14.5 16.5,10" {...common} />
          <Path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" {...common} />
        </>
      );
    default:
      return null;
  }
}
