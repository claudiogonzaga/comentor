import { useMemo, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';

// O fundo do tema ecológico: folha clara que desce para o musgo, com dois ramos finos
// em traço (folhas com nervura) saindo dos cantos — de leve, quase marca d'água. Sem
// grega: a moldura é do vaso. Os ramos são sempre os mesmos, para não mudar entre telas.

const { width: W, height: H } = Dimensions.get('window');
const TOP = '#EEF2E6';
const BOTTOM = '#DCE6D2';
const INK = '#1F3326';
const OPACITY = 0.08;

type Pt = readonly [number, number];

/** Ponto e direção da curva quadrática p0 → p2 (controle p1) no instante t. */
function onCurve(p0: Pt, p1: Pt, p2: Pt, t: number): { p: Pt; a: number } {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return { p: [x, y], a: Math.atan2(dy, dx) };
}

const f = (n: number) => n.toFixed(1);

/** Uma folha amendoada com a nervura do meio, da base `b` na direção `a`. */
function leaf(b: Pt, a: number, len: number): string[] {
  const w = len * 0.34;
  const at = (x: number, y: number): string => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return `${f(b[0] + x * c - y * s)},${f(b[1] + x * s + y * c)}`;
  };
  return [
    `M${at(0, 0)} Q${at(len * 0.5, -w)} ${at(len, 0)} Q${at(len * 0.5, w)} ${at(0, 0)}`,
    `M${at(len * 0.08, 0)} L${at(len * 0.78, 0)}`,
  ];
}

/** Um ramo: o caule curvo e as folhas alternadas, menores rumo à ponta. */
function sprig(p0: Pt, p1: Pt, p2: Pt, leaves: number, maxLen: number, first: 1 | -1): string[] {
  const out = [`M${f(p0[0])},${f(p0[1])} Q${f(p1[0])},${f(p1[1])} ${f(p2[0])},${f(p2[1])}`];
  for (let i = 0; i < leaves; i += 1) {
    const t = 0.16 + (i / leaves) * 0.8;
    const { p, a } = onCurve(p0, p1, p2, t);
    const side = i % 2 === 0 ? first : -first;
    out.push(...leaf(p, a + side * 0.85, maxLen * (1 - 0.5 * t)));
  }
  // a folha da ponta, no prolongamento do caule
  const tip = onCurve(p0, p1, p2, 1);
  out.push(...leaf(tip.p, tip.a, maxLen * 0.45));
  return out;
}

interface Props {
  /** Os ramos dos cantos (o mesmo papel da grega no terracota). */
  ornament?: boolean;
}

export function EcoBackground({ ornament = true }: Props) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const width = measured?.w ?? W;
  const height = measured?.h ?? H;

  const paths = useMemo(() => {
    const s = Math.min(width, 430) / 390; // escala para telas maiores ou menores
    const y0 = height * 0.015;
    // No alto, à direita: o ramo desce em arco para a esquerda; um raminho sai dele.
    const tA: Pt = [width + 6, y0];
    const tB: Pt = [width - 70 * s, y0 + 120 * s];
    const tC: Pt = [width - 190 * s, y0 + 150 * s];
    const tFork = onCurve(tA, tB, tC, 0.3).p;
    const top = sprig(tA, tB, tC, 11, 36 * s, 1);
    const topSmall = sprig(
      tFork,
      [tFork[0] - 6 * s, tFork[1] + 46 * s],
      [tFork[0] - 52 * s, tFork[1] + 84 * s],
      5,
      24 * s,
      -1,
    );
    // Embaixo, à esquerda: sobe em arco para a direita, com o seu raminho.
    const bA: Pt = [-6, height - 10 * s];
    const bB: Pt = [60 * s, height - 130 * s];
    const bC: Pt = [175 * s, height - 165 * s];
    const bFork = onCurve(bA, bB, bC, 0.32).p;
    const bottom = sprig(bA, bB, bC, 10, 34 * s, -1);
    const bottomSmall = sprig(
      bFork,
      [bFork[0] + 40 * s, bFork[1] + 4 * s],
      [bFork[0] + 74 * s, bFork[1] - 34 * s],
      5,
      22 * s,
      1,
    );
    return [...top, ...topSmall, ...bottom, ...bottomSmall];
  }, [width, height]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        // O teclado encolhe a tela: os ramos ficam onde estão.
        setMeasured((m) => (m && m.w === w && m.h >= h ? m : { w, h }));
      }}
    >
      <LinearGradient colors={[TOP, BOTTOM]} style={StyleSheet.absoluteFill} />
      {ornament && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              fill="none"
              stroke={INK}
              strokeWidth={1.3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={OPACITY}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}
