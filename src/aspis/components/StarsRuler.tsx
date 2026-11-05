import { useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, G, Line } from 'react-native-svg';

import { ALIGN_MAX, colors, typography } from '../theme';
import { ECOLOGICO, ESPACIAL } from '../../theme/tema';

interface Props {
  value: number; // nível de alinhamento mínimo, 0–4 (escala Likert)
  onChange: (n: number) => void;
}

const HEIGHT = 34;
const MID = HEIGHT / 2;
const SUN_R = 5;
const RAYS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
const SUN_GAP = 18; // do último planeta até o sol
const LEVELS = Array.from({ length: ALIGN_MAX + 1 }, (_, i) => i); // [0,1,2,3,4]
const PLANET_R = [3, 3.5, 4, 4.5, 5]; // crescem rumo ao "muito alinhado"

/** Fora da conjunção, o planeta sai do eixo: para cima e para baixo, alternando, e
 *  tanto mais longe quanto mais longe do nível escolhido. */
function offAxis(level: number, chosen: number): number {
  if (level >= chosen) return 0;
  const far = Math.min(1, (chosen - level) / ALIGN_MAX);
  return (level % 2 === 0 ? -1 : 1) * (6 + 3 * far);
}

// Régua de alinhamento como uma conjunção: os planetas do nível escolhido até "muito
// alinhado" ficam em linha com o sol, sobre o eixo traçado firme — é o que entra no
// feed; os de baixo saem do eixo, apagados. Toque ou arraste escolhe um dos 5 níveis.
export function StarsRuler({ value, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const current = drag ?? value;
  const sel = PLANET_R[ALIGN_MAX] + 4; // margem para o anel do escolhido
  const usable = Math.max(1, width - sel - SUN_GAP - SUN_R * 2 - 5);
  const xOf = (level: number) => sel + (level / ALIGN_MAX) * usable;
  const sunX = width - SUN_R - 6;

  const valueAt = (e: GestureResponderEvent) => {
    if (!width) return current;
    const ratio = Math.max(0, Math.min(1, (e.nativeEvent.locationX - sel) / usable));
    return Math.round(ratio * ALIGN_MAX);
  };

  const ink = colors.text.primary;
  // O sol: quente no espacial, âmbar no ecológico; no terracota, da mesma tinta dos planetas.
  const sun = ESPACIAL ? '#FAC775' : ECOLOGICO ? '#C98A2B' : ink;

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
            {/* o eixo: tracejado e apagado fora da conjunção, firme dentro dela */}
            <Line x1={xOf(0)} y1={MID} x2={xOf(current)} y2={MID} stroke={ink} strokeWidth={1} strokeDasharray="2 4" opacity={0.3} />
            <Line x1={xOf(current)} y1={MID} x2={sunX} y2={MID} stroke={ink} strokeWidth={1.4} />
            {/* o sol: disco com raios curtos, colorido nos temas espacial e ecológico */}
            {RAYS.map((a) => (
              <Line
                key={a}
                x1={sunX + Math.cos(a) * (SUN_R + 2)}
                y1={MID + Math.sin(a) * (SUN_R + 2)}
                x2={sunX + Math.cos(a) * (SUN_R + 5)}
                y2={MID + Math.sin(a) * (SUN_R + 5)}
                stroke={sun}
                strokeWidth={1.2}
                strokeLinecap="round"
              />
            ))}
            <Circle cx={sunX} cy={MID} r={SUN_R} fill={sun} />
            {LEVELS.map((lvl) => {
              const aligned = lvl >= current;
              const cy = MID + offAxis(lvl, current);
              const r = PLANET_R[lvl] + (lvl === current ? 1.5 : 0);
              return (
                <G key={lvl}>
                  {lvl === current && (
                    <Circle cx={xOf(lvl)} cy={cy} r={r + 4} fill="none" stroke={ink} strokeWidth={1} opacity={0.55} />
                  )}
                  <Circle
                    cx={xOf(lvl)}
                    cy={cy}
                    r={r}
                    fill={aligned ? ink : 'none'}
                    stroke={ink}
                    strokeWidth={1.2}
                    opacity={aligned ? 1 : 0.35}
                  />
                </G>
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
