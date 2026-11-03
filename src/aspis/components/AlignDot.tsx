import { StyleSheet, View } from 'react-native';

import { colors } from '../theme';

// Indicador de alinhamento em figura negra: um xadrez de 4 casas, como os dos vasos
// áticos. Quantas casas pretas, tanto mais alinhado (0 a 4).
export function AlignDot({ stars }: { stars: number }) {
  const filled = Math.max(0, Math.min(4, Math.round(stars)));
  return (
    <View style={styles.grid} accessibilityLabel={`Alinhamento ${filled} de 4`}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.cell, i < filled && styles.on]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: 15, height: 15, flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
  cell: {
    width: 7,
    height: 7,
    borderWidth: 1,
    borderColor: colors.text.tertiary,
  },
  on: { backgroundColor: colors.text.primary, borderColor: colors.text.primary },
});
