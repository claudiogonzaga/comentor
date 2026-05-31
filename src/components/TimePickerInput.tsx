import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { GreekIcon } from './GreekIcon';
import { colors, radius, spacing, typography } from '../theme';

interface Props {
  label?: string;
  value: string;
  onChange: (hhmm: string) => void;
}

function parseHHMM(s: string): Date {
  const [h, m] = (s || '23:00').split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(isNaN(h) ? 23 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
}

function formatHHMM(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function TimePickerInput({ label, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setOpen(false);
      if (event.type === 'set' && date) onChange(formatHHMM(date));
    } else if (date) {
      onChange(formatHHMM(date));
    }
  };

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.button,
          pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        ]}
      >
        <View style={styles.icon}>
          <GreekIcon name="clock" size={18} />
        </View>
        <Text style={styles.value}>{value || '--:--'}</Text>
        <Text style={styles.hint}>tocar para alterar</Text>
      </Pressable>

      {open && (
        <DateTimePicker
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          is24Hour
          value={parseHHMM(value)}
          onChange={handleChange}
          themeVariant="dark"
        />
      )}
      {Platform.OS === 'ios' && open && (
        <Pressable style={styles.iosCloseBtn} onPress={() => setOpen(false)}>
          <Text style={styles.iosCloseText}>OK</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.label,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  button: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: { justifyContent: 'center' },
  value: {
    ...typography.title,
    color: colors.text.primary,
    fontSize: 28,
    flex: 1,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
  },
  iosCloseBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  iosCloseText: {
    ...typography.button,
    color: colors.accent.gold,
  },
});
