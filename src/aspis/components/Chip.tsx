import { Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radius, spacing, typography } from '../theme';

interface Props {
  label: string;
  active?: boolean;
  onPress: () => void;
}

// Chip de filtro — mesmo papel dos .chip da UI do desktop, no tema escuro.
export function Chip({ label, active, onPress }: Props) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, active && styles.active, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  active: {
    backgroundColor: colors.bg.surfaceStrong,
    borderColor: colors.border,
  },
  label: {
    ...typography.small,
    color: colors.text.secondary,
  },
  labelActive: {
    color: colors.text.primary,
    fontFamily: 'Inter_500Medium',
  },
});
