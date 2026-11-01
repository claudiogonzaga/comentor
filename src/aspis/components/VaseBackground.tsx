import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

// Fundo de vaso grego: terracota que clareia de dia e escurece à noite,
// emoldurado pela grega (meandro) nos quatro lados da tela. Compartilhado
// com o CoMentor — mesma identidade visual.

interface VaseBackgroundProps {
  meander?: boolean;
}

const { width: W, height: H } = Dimensions.get('window');

const DAY_TOP = '#CE7544';
const DAY_BOTTOM = '#B65A30';
const NIGHT_TOP = '#5A3322';
const NIGHT_BOTTOM = '#412419';
const DAY_LINE = '#33200F';
const NIGHT_LINE = '#D29A6E';

const INSET = 5;
const BAND = 15;
const UNIT = 22;
// Unidade do meandro: [ao-longo, atravessado] numa faixa UNIT x BAND.
const KEY: ReadonlyArray<readonly [number, number]> = [
  [2.5, 12], [2.5, 3], [19, 3], [19, 9.5], [7.5, 9.5], [7.5, 6], [12.5, 6],
];

function mix(a: string, b: string, t: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  const out = [1, 3, 5].map((i) =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t),
  );
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Luminosidade do fundo. O texto do app é escuro (figura negra), então o
 * fundo é mantido sempre claro o suficiente para o texto ficar legível —
 * varia só de leve entre dia e noite.
 */
function daylight(): number {
  const d = new Date();
  const hour = d.getHours() + d.getMinutes() / 60;
  const raw = (Math.cos(((hour - 14) / 24) * 2 * Math.PI) + 1) / 2;
  return 0.82 + raw * 0.18;
}

export function VaseBackground({ meander = true }: VaseBackgroundProps) {
  const insets = useSafeAreaInsets();

  const { topColor, bottomColor, lineColor } = useMemo(() => {
    const t = daylight();
    return {
      topColor: mix(NIGHT_TOP, DAY_TOP, t),
      bottomColor: mix(NIGHT_BOTTOM, DAY_BOTTOM, t),
      lineColor: mix(NIGHT_LINE, DAY_LINE, t),
    };
  }, []);

  const frame = useMemo(() => {
    const L = insets.left + INSET;
    const T = insets.top + INSET;
    const R = W - insets.right - INSET;
    const B = H - insets.bottom - INSET;
    const seg = (pts: [number, number][]) =>
      'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');

    const innerW = R - L - 2 * BAND;
    const innerH = B - T - 2 * BAND;
    const nx = Math.max(0, Math.floor(innerW / UNIT));
    const ny = Math.max(0, Math.floor(innerH / UNIT));
    const ox = L + BAND + (innerW - nx * UNIT) / 2;
    const oy = T + BAND + (innerH - ny * UNIT) / 2;

    const paths: string[] = [];
    for (let i = 0; i < nx; i++) {
      const s = ox + i * UNIT;
      paths.push(seg(KEY.map(([a, c]) => [s + a, T + c])));
      paths.push(seg(KEY.map(([a, c]) => [s + a, B - c])));
    }
    for (let i = 0; i < ny; i++) {
      const s = oy + i * UNIT;
      paths.push(seg(KEY.map(([a, c]) => [L + c, s + a])));
      paths.push(seg(KEY.map(([a, c]) => [R - c, s + a])));
    }
    return { L, T, R, B, paths };
  }, [insets.left, insets.top, insets.right, insets.bottom]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[topColor, bottomColor]}
        style={StyleSheet.absoluteFill}
      />
      {meander && (
        <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
          <Rect
            x={frame.L}
            y={frame.T}
            width={frame.R - frame.L}
            height={frame.B - frame.T}
            fill="none"
            stroke={lineColor}
            strokeWidth={2}
            opacity={0.9}
          />
          {frame.paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              fill="none"
              stroke={lineColor}
              strokeWidth={2.2}
              strokeLinecap="square"
              opacity={0.9}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}
