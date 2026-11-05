import { useMemo, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

// O fundo do tema espacial, o céu do Diángelos: noite azul-escura, estrelas
// discretas (sempre as mesmas, para não "piscar" entre telas) e o halo de um astro
// no alto, à direita.

const { width: W, height: H } = Dimensions.get('window');
const TOP = '#090C16';
const BOTTOM = '#131A33';
const STAR = '#F1EFE8';
const ASTRO = '#FAC775';

/** Gerador pseudoaleatório com semente: o mesmo céu em toda abertura. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function SpaceBackground() {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const width = measured?.w ?? W;
  const height = measured?.h ?? H;

  const stars = useMemo(() => {
    const rnd = seeded(7);
    const n = Math.round((width * height) / 5200);
    return Array.from({ length: n }, () => {
      const big = rnd() > 0.93;
      return { x: rnd() * width, y: rnd() * height, r: big ? 1.1 + rnd() * 0.6 : 0.4 + rnd() * 0.5, o: big ? 0.75 : 0.25 + rnd() * 0.4 };
    });
  }, [width, height]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setMeasured((m) => (m && m.w === w && m.h >= h ? m : { w, h }));
      }}
    >
      <LinearGradient colors={[TOP, BOTTOM]} style={StyleSheet.absoluteFill} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="astro" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={ASTRO} stopOpacity={0.16} />
            <Stop offset="1" stopColor={ASTRO} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={width * 0.86} cy={height * 0.08} r={Math.min(width, height) * 0.42} fill="url(#astro)" />
        {stars.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill={STAR} opacity={s.o} />
        ))}
      </Svg>
    </View>
  );
}
