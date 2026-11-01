import { useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { ALIGN_COLORS, ALIGN_MAX, alignColor, colors, typography } from '../theme';

interface Props {
  value: number; // nível de alinhamento mínimo, 0–4 (escala Likert)
  onChange: (n: number) => void;
}

const DOT_R = 7; // raio do ponto; também a margem do trilho p/ não cortar os pontos
const LEVELS = Array.from({ length: ALIGN_MAX + 1 }, (_, i) => i); // [0,1,2,3,4]

// Régua de alinhamento estilo escala Likert: 5 pontos simétricos sobre a linha
// colorida; toque/arraste seleciona o ponto mais próximo. Espelha o
// .align-track do desktop.
export function StarsRuler({ value, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const current = drag ?? value;
  const usable = Math.max(1, width - 2 * DOT_R);
  const xOf = (level: number) => DOT_R + (level / ALIGN_MAX) * usable;

  const valueAt = (e: GestureResponderEvent) => {
    if (!width) return current;
    const ratio = Math.max(0, Math.min(1, (e.nativeEvent.locationX - DOT_R) / usable));
    return Math.round(ratio * ALIGN_MAX);
  };

  return (
    <View style={styles.row}>
      <Text style={styles.lbl}>não alinhado</Text>
      <View
        style={styles.trackWrap}
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
        <LinearGradient
          colors={[...ALIGN_COLORS]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.track}
        />
        {width > 0 &&
          LEVELS.map((lvl) => {
            const selected = lvl === current;
            return (
              <View
                key={lvl}
                pointerEvents="none"
                style={[
                  styles.dot,
                  {
                    left: xOf(lvl) - (selected ? 9 : DOT_R),
                    width: selected ? 18 : DOT_R * 2,
                    height: selected ? 18 : DOT_R * 2,
                    borderRadius: selected ? 9 : DOT_R,
                    // sempre a cor da linha naquele nível; anel claro fininho
                    // (creme) só para separar do gradiente — nunca preto.
                    backgroundColor: alignColor(lvl),
                    borderColor: colors.text.onGold,
                    top: selected ? 5 : 7,
                  },
                ]}
              />
            );
          })}
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
    height: 28, // área de toque generosa; o trilho é fino
    justifyContent: 'center',
  },
  track: {
    height: 7,
    borderRadius: 3.5,
    marginHorizontal: DOT_R,
  },
  dot: {
    position: 'absolute',
    borderWidth: 1.5,
  },
});
