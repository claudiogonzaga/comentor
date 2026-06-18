import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { TimePickerInput } from './TimePickerInput';
import { colors, radius, spacing, typography } from '../theme';
import {
  createMedication,
  deleteMedication,
  listMedications,
  updateMedication,
} from '../services/database';
import { scheduleAllMedications } from '../services/medications';
import type { Medication } from '../types';

const FASTING_HOURS_OPTIONS = [12, 14, 16, 18, 20];
const DEFAULT_HOURS = 16;
const DEFAULT_FIRST_MEAL = '12:00';

/** Da 1ª refeição + horas de jejum, calcula a janela de alimentação. */
function fastingWindow(time: string, fastH: number): { end: string; warn: string; eat: number } {
  const parts = time.split(':').map((s) => parseInt(s, 10));
  const firstMin = (parts[0] || 0) * 60 + (parts[1] || 0);
  const eat = Math.max(1, 24 - fastH);
  const endMin = (firstMin + eat * 60) % (24 * 60);
  const warnMin = (endMin - 30 + 24 * 60) % (24 * 60);
  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { end: fmt(endMin), warn: fmt(warnMin), eat };
}

/**
 * Card do JEJUM INTERMITENTE — hábito pré-definido configurável (não é uma
 * opção do editor de novos hábitos). Fica abaixo do card de Sono. Persiste como
 * UMA linha de `medications` com `fastingHours != null` (o agendador já trata:
 * avisa 30 min antes do fim da janela de alimentação e no fim). Liga/desliga,
 * escolhe as horas de jejum e o horário da 1ª refeição.
 */
export function FastingCard() {
  const [fasting, setFasting] = useState<Medication | null>(null);

  const reload = useCallback(async () => {
    try {
      const meds = await listMedications();
      setFasting(meds.find((m) => m.fastingHours != null) ?? null);
    } catch {
      setFasting(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const enabled = !!fasting?.enabled;
  const hours = fasting?.fastingHours ?? DEFAULT_HOURS;
  const firstMeal = fasting?.time ?? DEFAULT_FIRST_MEAL;

  const persistAndReschedule = async () => {
    await scheduleAllMedications();
    await reload();
  };

  const toggle = async (on: boolean) => {
    if (on) {
      if (fasting) {
        await updateMedication(fasting.id, { enabled: true });
      } else {
        await createMedication({
          name: 'Jejum intermitente',
          emoji: '⏳',
          time: DEFAULT_FIRST_MEAL,
          fastingHours: DEFAULT_HOURS,
          enabled: true,
        });
      }
    } else if (fasting) {
      // Desligar não apaga — mantém as preferências (horas/refeição) para depois.
      await updateMedication(fasting.id, { enabled: false });
    }
    await persistAndReschedule();
  };

  const setHours = async (h: number) => {
    if (!fasting) return;
    await updateMedication(fasting.id, { fastingHours: h });
    await persistAndReschedule();
  };

  const setFirstMeal = async (hhmm: string) => {
    if (!fasting) return;
    await updateMedication(fasting.id, { time: hhmm });
    await persistAndReschedule();
  };

  const w = fastingWindow(firstMeal, hours);

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.sectionRow}>
          <GreekIcon name="fasting" size={20} />
          <Text style={styles.section}>Jejum intermitente</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
          thumbColor={enabled ? colors.text.onGold : colors.text.tertiary}
        />
      </View>
      <Text style={styles.subtitle}>
        Escolha as horas de jejum e o horário da primeira refeição. A coruja avisa
        30 min antes de fechar a janela de alimentação e no fim dela.
      </Text>

      {enabled && (
        <>
          <Text style={styles.label}>Horas de jejum</Text>
          <View style={styles.chipRow}>
            {FASTING_HOURS_OPTIONS.map((h) => {
              const on = h === hours;
              return (
                <Pressable
                  key={h}
                  onPress={() => setHours(h)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{h}h</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: spacing.sm }} />
          <TimePickerInput label="Primeira refeição" value={firstMeal} onChange={setFirstMeal} />

          <Text style={styles.preview}>
            Janela de alimentação: {firstMeal} → {w.end} ({w.eat}h). Aviso às {w.warn}; pare de
            comer às {w.end}.
          </Text>
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    flex: 1,
    minWidth: 44,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: 'rgba(244,197,83,0.18)',
    borderColor: colors.accent.gold,
  },
  chipText: {
    ...typography.small,
    color: colors.text.secondary,
  },
  chipTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
  preview: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    lineHeight: 17,
  },
});
