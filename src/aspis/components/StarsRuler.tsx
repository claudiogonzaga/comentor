import { useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, ClipPath, Defs, Path, Rect } from 'react-native-svg';

import { ALIGN_MAX, colors, typography } from '../theme';

interface Props {
  value: number; // nível de alinhamento mínimo, 0–4 (escala Likert)
  onChange: (n: number) => void;
}

const HEIGHT = 30;
const BAND = 14; // altura da grega
const DOT_R = 4;
const SEL_R = 8;
const KEY = 18; // largura de uma "chave" da grega
const LEVELS = Array.from({ length: ALIGN_MAX + 1 }, (_, i) => i); // [0,1,2,3,4]

/** A grega contínua dos vasos: dois trilhos e as espirais ligadas. */
function meanderPath(width: number, top: number): string {
  const n = Math.max(1, Math.round(width / KEY));
  const p = width / n;
  const bottom = top + BAND;
  const parts = [`M0,${bottom - 0.5} H${width}`, `M0,${top + 0.5} H${width}`];
  for (let i = 0; i < n; i += 1) {
    const x = i * p;
    parts.push(
      `M${x + p * 0.12},${bottom - 0.5} V${top + 3} H${x + p * 0.8} V${bottom - 3.5} H${x + p * 0.38} V${top + 6.5} H${x + p * 0.58}`,
    );
  }
  return parts.join(' ');
}

// Régua de alinhamento em figura negra, como um friso de vaso ático: a grega escura
// mostra a faixa que entra no feed, do nível escolhido até "muito alinhado"; o resto
// fica como sombra. Toque ou arraste seleciona um dos 5 níveis.
export function StarsRuler({ value, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const current = drag ?? value;
  const usable = Math.max(1, width - 2 * SEL_R);
  const xOf = (level: number) => SEL_R + (level / ALIGN_MAX) * usable;

  const valueAt = (e: GestureResponderEvent) => {
    if (!width) return current;
    const ratio = Math.max(0, Math.min(1, (e.nativeEvent.locationX - SEL_R) / usable));
    return Math.round(ratio * ALIGN_MAX);
  };

  const top = (HEIGHT - BAND) / 2;
  const ink = colors.text.primary;
  const path = width > 0 ? meanderPath(width, top) : '';
  const clipId = `aspis-align-${width}`;

  return (
    <View style={styles.row}>
      <Text style={styles.lbl}>não alinhado</Text>
      <View
        style={styles.trackWrap}
        accessibilityRole="adjustable"
        accessibilityLabel={`Alinhamento mínimo: nível ${current} de ${ALIGN_MAX}`}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDrag(valueAt(e))}
        onResponderMove={(e) => {
          const n = valueAt(e);
          if (n !== drag) setDrag(n);
        }}
        onResponderRelease={(e) => {
          const n = valueAt(e);
          setDrag(null);
          Haptics.selectionAsync();
          onChange(n);
        }}
      >
        {width > 0 && (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={xOf(current)} y={0} width={width - xOf(current)} height={HEIGHT} />
              </ClipPath>
            </Defs>
            <Path d={path} fill="none" stroke={ink} strokeWidth={1.2} opacity={0.22} />
            <Path d={path} fill="none" stroke={ink} strokeWidth={1.5} clipPath={`url(#${clipId})`} />
            {LEVELS.map((lvl) => {
              const selected = lvl === current;
              return selected ? (
                <Circle key={lvl} cx={xOf(lvl)} cy={HEIGHT / 2} r={SEL_R} fill={ink} stroke={colors.bg.primary} strokeWidth={2} />
              ) : (
                <Circle key={lvl} cx={xOf(lvl)} cy={HEIGHT / 2} r={DOT_R} fill={colors.bg.primary} stroke={ink} strokeWidth={1.5} />
              );
            })}
          </Svg>
        )}
      </View>
      <Text style={styles.lbl}>muito alinhado</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lbl: {
    ...typography.label,
    fontSize: 10,
    color: colors.text.tertiary,
    textTransform: 'none',
    letterSpacing: 0,
  },
  trackWrap: {
    flex: 1,
    height: HEIGHT,
    justifyContent: 'center',
  },
});
