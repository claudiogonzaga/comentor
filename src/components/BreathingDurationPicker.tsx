import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { colors, radius, spacing, typography } from '../theme';

/** Opções de duração do exercício de respiração, em minutos. */
const DURATION_OPTIONS = [3, 5, 10, 16, 20, 30];

interface Props {
  /** Duração atual (minutos). */
  value: number;
  /** Chamado quando o usuário escolhe outra duração. */
  onChange: (minutes: number) => void;
}

export function BreathingDurationPicker({ value, onChange }: Props) {
  return (
    <Card style={styles.card}>
      <View style={styles.sectionRow}>
        <GreekIcon name="clock" size={20} />
        <Text style={styles.section}>Duração da respiração</Text>
      </View>
      <Text style={styles.subtitle}>
        Por quanto tempo o exercício de respiração dura. A coruja guia os ciclos
        2-2-4 até completar esse tempo.
      </Text>

      <View style={styles.chipRow}>
        {DURATION_OPTIONS.map((min) => {
          const on = min === value;
          return (
            <Pressable
              key={min}
              onPress={() => onChange(min)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {min} min
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  chipOn: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.12)',
  },
  chipText: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
  chipTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
});
