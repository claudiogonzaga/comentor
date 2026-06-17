import { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

// Barra de volume VERTICAL discreta (avisos/nudges). Arrastar para cima sobe,
// para baixo desce até 0 (mudo). Sem dependência externa — PanResponder puro,
// no mesmo espírito do AudioScrubber. value/onChange em 0–1.

interface Props {
  value: number;
  onChange: (v: number) => void;
  /** Chamada ao soltar (para persistir/agendar uma vez, não a cada pixel). */
  onCommit?: (v: number) => void;
  height?: number;
}

export function VerticalVolume({ value, onChange, onCommit, height = 96 }: Props) {
  const hRef = useRef(height);
  hRef.current = height;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const lastRef = useRef(value);
  lastRef.current = value;

  const fromGesture = (locationY: number): number => {
    const h = hRef.current;
    // topo = 1, base = 0
    const v = 1 - Math.max(0, Math.min(h, locationY)) / h;
    return Math.round(Math.max(0, Math.min(1, v)) * 20) / 20; // passos de 5%
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const v = fromGesture(e.nativeEvent.locationY);
        lastRef.current = v;
        onChangeRef.current(v);
      },
      onPanResponderMove: (e) => {
        const v = fromGesture(e.nativeEvent.locationY);
        lastRef.current = v;
        onChangeRef.current(v);
      },
      onPanResponderRelease: () => onCommitRef.current?.(lastRef.current),
      onPanResponderTerminate: () => onCommitRef.current?.(lastRef.current),
    }),
  ).current;

  const muted = value <= 0;
  const fillH = Math.max(0, Math.min(1, value)) * height;

  return (
    <View
      style={[styles.track, { height }]}
      hitSlop={{ left: 12, right: 12, top: 6, bottom: 6 }}
      {...pan.panHandlers}
    >
      <View
        style={[
          styles.fill,
          { height: fillH, backgroundColor: muted ? colors.text.tertiary : colors.accent.gold },
        ]}
      />
      <View style={[styles.thumb, { bottom: Math.max(0, fillH - 5) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 6,
    borderRadius: 3,
    backgroundColor: colors.bg.surfaceStrong,
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  fill: {
    width: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    left: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent.gold,
    borderWidth: 2,
    borderColor: colors.bg.primary,
  },
});
