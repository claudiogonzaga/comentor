import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { PERIOD_LABELS } from '../constants/defaults';
import type { Period } from '../types';
import { colors, radius, typography } from '../theme';

interface Props {
  value: Period;
  onChange: (p: Period) => void;
}

// Segmento Dia / Semana / Mês (port do .period-seg do desktop).
export function PeriodSegment({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => {
        const active = p === value;
        return (
          <Pressable
            key={p}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(p);
            }}
            style={[styles.btn, active && styles.active]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {PERIOD_LABELS[p]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2 },
  btn: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  active: { backgroundColor: colors.bg.surfaceStrong },
  label: { ...typography.small, color: colors.text.tertiary },
  labelActive: { color: colors.text.primary, fontFamily: 'Inter_600SemiBold' },
});
