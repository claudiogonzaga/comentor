import { StyleSheet, View } from 'react-native';

import { alignColor, colors } from '../theme';

// Indicador de alinhamento por cor (port do .align-dot do desktop):
// vermelho (0) → violeta (5).
export function AlignDot({ stars }: { stars: number }) {
  const color = alignColor(stars);
  return (
    <View style={[styles.halo, { backgroundColor: `${color}33` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
  },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
});
