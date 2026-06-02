import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { TimePickerInput } from './TimePickerInput';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { scheduleSedentaryNudges } from '../services/sedentary';

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const INTERVAL_OPTIONS = [30, 45, 60, 90];

/**
 * Card "Trabalho sentado": a pessoa marca os dias e a janela de horário em que
 * trabalha sentada, e a Comentora manda um nudge para levantar/mover a cada
 * X minutos durante esse período.
 */
export function SedentaryCard() {
  const { config, setConfig } = useAppStore();

  const enabled = config?.sedentaryEnabled ?? false;
  const days = config?.sedentaryDays ?? [1, 2, 3, 4, 5];
  const start = config?.sedentaryStart ?? '09:00';
  const end = config?.sedentaryEnd ?? '17:00';
  const interval = config?.sedentaryIntervalMin ?? 60;

  const apply = async (patch: Parameters<typeof setConfig>[0]) => {
    await setConfig(patch);
    await scheduleSedentaryNudges();
  };

  const toggleDay = (d: number) => {
    const next = days.includes(d)
      ? days.filter((x) => x !== d)
      : [...days, d].sort((a, b) => a - b);
    apply({ sedentaryDays: next });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.sectionRow}>
          <GreekIcon name="activity" size={20} />
          <Text style={styles.section}>Trabalho sentado</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => apply({ sedentaryEnabled: v })}
          trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
          thumbColor={enabled ? colors.text.onGold : colors.text.tertiary}
        />
      </View>
      <Text style={styles.subtitle}>
        Marque quando você passa o dia sentado(a). A coruja lembra de levantar e
        mover o corpo durante esse período.
      </Text>

      {enabled && (
        <>
          <Text style={styles.label}>Dias</Text>
          <View style={styles.dayRow}>
            {DAY_LABELS.map((lbl, idx) => {
              const on = days.includes(idx);
              return (
                <Pressable
                  key={idx}
                  onPress={() => toggleDay(idx)}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{lbl}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.timesRow}>
            <View style={styles.timeCol}>
              <TimePickerInput
                label="Início"
                value={start}
                onChange={(hhmm) => apply({ sedentaryStart: hhmm })}
              />
            </View>
            <View style={{ width: spacing.md }} />
            <View style={styles.timeCol}>
              <TimePickerInput
                label="Fim"
                value={end}
                onChange={(hhmm) => apply({ sedentaryEnd: hhmm })}
              />
            </View>
          </View>

          <Text style={styles.label}>Lembrar a cada</Text>
          <View style={styles.dayRow}>
            {INTERVAL_OPTIONS.map((min) => {
              const on = min === interval;
              return (
                <Pressable
                  key={min}
                  onPress={() => apply({ sedentaryIntervalMin: min })}
                  style={[styles.intervalChip, on && styles.dayChipOn]}
                >
                  <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>
                    {min} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: spacing.xs,
  },
  dayChip: {
    flex: 1,
    minWidth: 40,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  intervalChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayChipOn: {
    backgroundColor: 'rgba(244,197,83,0.18)',
    borderColor: colors.accent.gold,
  },
  dayChipText: {
    ...typography.small,
    color: colors.text.secondary,
  },
  dayChipTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
  timesRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  timeCol: {
    flex: 1,
  },
});
