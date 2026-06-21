import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

// Fundo de vaso grego: terracota que clareia de dia e escurece à noite,
// emoldurado pela grega (meandro) nos quatro lados da tela.

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
// Espiral grega (chave): a MESMA glifa é usada nos cantos E repetida ao longo
// das retas — assim a borda fica consistente, sem os "ganchos soltos" da versão
// antiga. [ao-longo (a), atravessado (c)] numa caixa 4u × 4u; c=0 = borda externa.
const U = 3.6;
const GLYPH: ReadonlyArray<readonly [number, number]> = [
  [0, 4 * U], [0, 0], [4 * U, 0], [4 * U, 3 * U], [U, 3 * U], [U, U], [3 * U, U], [3 * U, 2 * U],
];
const GLEN = 4 * U; // comprimento da glifa ao longo da fileira
const GAP = 5; // espaço entre chaves
const STEP = GLEN + GAP;

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
 * varia só de leve entre dia e noite. (O modo escuro de verdade é uma
 * troca de tema, não um escurecer do fundo.)
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

    const paths: string[] = [];

    // Coloca a glifa mapeando (a=ao-longo, c=atravessado) → ponto de tela.
    const place = (mapPt: (a: number, c: number) => [number, number]) =>
      seg(GLYPH.map(([a, c]) => mapPt(a, c)));

    // RETAS: tila a glifa entre os cantos (deixando GLEN de folga p/ o canto).
    const hStart = L + GLEN;
    const hEnd = R - GLEN;
    const nH = Math.max(0, Math.floor((hEnd - hStart) / STEP));
    const offH = hStart + ((hEnd - hStart) - nH * STEP) / 2;
    for (let i = 0; i < nH; i++) {
      const s = offH + i * STEP;
      paths.push(place((a, c) => [s + a, T + c])); // topo
      paths.push(place((a, c) => [s + a, B - c])); // base
    }
    const vStart = T + GLEN;
    const vEnd = B - GLEN;
    const nV = Math.max(0, Math.floor((vEnd - vStart) / STEP));
    const offV = vStart + ((vEnd - vStart) - nV * STEP) / 2;
    for (let i = 0; i < nV; i++) {
      const s = offV + i * STEP;
      paths.push(place((a, c) => [L + c, s + a])); // esquerda
      paths.push(place((a, c) => [R - c, s + a])); // direita
    }

    // CANTOS: a MESMA glifa, espelhada por sinais (sx, sy) — fecha as 4 quinas.
    const corner = (cx: number, cy: number, sx: number, sy: number) =>
      seg(GLYPH.map(([x, y]) => [cx + sx * x, cy + sy * y]));
    paths.push(corner(L, T, 1, 1));
    paths.push(corner(R, T, -1, 1));
    paths.push(corner(L, B, 1, -1));
    paths.push(corner(R, B, -1, -1));

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
