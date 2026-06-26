import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from './Card';
import { TimePickerInput } from './TimePickerInput';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import {
  loadQuietPeriods,
  saveQuietPeriods,
  invalidateQuietCache,
  loadSleepQuiet,
  saveSleepQuiet,
  deriveSleepPeriod,
  type QuietPeriod,
  type SleepQuiet,
} from '../services/quietHours';
import { setSpokenQuietHours } from '../services/spokenNudges';
import { rescheduleAllNotifications } from '../services/coach';

const SLEEP_HOURS = [6, 7, 8, 9, 10];

// Vários períodos de "não perturbe" para os AVISOS SONOROS. Em qualquer janela:
// as notificações aparecem SEM som/vibração e a voz não fala. Ex.: sono
// 22:00–07:00 + trabalho 09:00–18:00. Substitui o horário silencioso único.

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function describeDays(mask: number): string {
  if (mask === 127) return 'todos os dias';
  if (mask === 0b0111110) return 'seg a sex';
  if (mask === 0b1000001) return 'fim de semana';
  const on = DAY_LABELS.filter((_, d) => ((mask >> d) & 1) === 1);
  return on.length ? on.join(', ') : 'nenhum dia';
}

export function QuietPeriodsCard() {
  const { config } = useAppStore();
  const bedtime = config?.bedtime || '23:00';
  const [periods, setPeriods] = useState<QuietPeriod[] | null>(null);
  const [sleep, setSleep] = useState<SleepQuiet | null>(null);

  useEffect(() => {
    loadQuietPeriods()
      .then(setPeriods)
      .catch(() => setPeriods([]));
    loadSleepQuiet()
      .then(setSleep)
      .catch(() => setSleep({ enabled: false, hours: 8 }));
  }, []);

  const persistSleep = useCallback(async (next: SleepQuiet) => {
    setSleep(next);
    try {
      await saveSleepQuiet(next);
      invalidateQuietCache();
      rescheduleAllNotifications().catch(() => {});
    } catch {
      /* best-effort */
    }
  }, []);

  const persist = useCallback(async (next: QuietPeriod[]) => {
    setPeriods(next);
    try {
      await saveQuietPeriods(next);
      invalidateQuietCache();
      // Espelha a 1ª janela no nativo (legado, voz em background single-window);
      // os demais períodos são cobertos pelo filtro de agendamento + canal mudo.
      const first = next[0];
      setSpokenQuietHours(
        first
          ? {
              spokenQuietEnabled: true,
              spokenQuietStart: first.start,
              spokenQuietEnd: first.end,
              spokenQuietDays: first.days,
            }
          : { spokenQuietEnabled: false },
      );
      // Reaplica os agendamentos para o roteamento ao canal silencioso valer já.
      rescheduleAllNotifications().catch(() => {});
    } catch {
      /* persistência best-effort */
    }
  }, []);

  const list = periods ?? [];
  const add = () => persist([...list, { start: '22:00', end: '07:00', days: 127 }]);
  const removeAt = (i: number) => persist(list.filter((_, idx) => idx !== i));
  const setField = (i: number, patch: Partial<QuietPeriod>) =>
    persist(list.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const toggleDay = (i: number, d: number) =>
    setField(i, { days: list[i].days ^ (1 << d) });

  if (!periods) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.section}>Períodos sem som (não perturbe)</Text>
      <Text style={styles.subtitle}>
        Nos horários e dias escolhidos, os avisos não tocam som nem voz — só
        aparecem em silêncio. A confirmação de cama continua soando.
      </Text>

      {/* Sono: janela derivada do horário de dormir (acompanha o bedtime). */}
      {sleep && (
        <View style={styles.sleepBox}>
          <View style={styles.periodHead}>
            <Text style={styles.periodTitle}>Silenciar durante o sono</Text>
            <Switch
              value={sleep.enabled}
              onValueChange={(v) => persistSleep({ ...sleep, enabled: v })}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={sleep.enabled ? colors.text.onGold : colors.text.tertiary}
            />
          </View>
          {sleep.enabled && (
            <>
              <Text style={styles.sleepHint}>
                A partir do horário de dormir ({bedtime}) por:
              </Text>
              <View style={styles.daysRow}>
                {SLEEP_HOURS.map((h) => {
                  const on = sleep.hours === h;
                  return (
                    <Pressable
                      key={h}
                      onPress={() => persistSleep({ ...sleep, hours: h })}
                      style={[styles.dayChip, on && styles.dayChipOn]}
                    >
                      <Text style={[styles.dayText, on && styles.dayTextOn]}>{h}h</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.sleepWindow}>
                Sem som das {deriveSleepPeriod(bedtime, sleep.hours).start} às{' '}
                {deriveSleepPeriod(bedtime, sleep.hours).end}, todos os dias.
              </Text>
            </>
          )}
        </View>
      )}

      <Text style={styles.groupLabel}>Outros períodos (trabalho, escola…)</Text>

      {list.length === 0 && (
        <Text style={styles.empty}>
          Nenhum período ainda. Toque em “+ Adicionar período”.
        </Text>
      )}

      {list.map((p, i) => (
        <View key={i} style={styles.period}>
          <View style={styles.periodHead}>
            <Text style={styles.periodTitle}>
              {p.start}–{p.end} · {describeDays(p.days)}
            </Text>
            <Pressable onPress={() => removeAt(i)} hitSlop={8}>
              <Text style={styles.remove}>Remover</Text>
            </Pressable>
          </View>

          <View style={styles.timesRow}>
            <View style={{ flex: 1 }}>
              <TimePickerInput
                label="Início"
                value={p.start}
                onChange={(hhmm) => setField(i, { start: hhmm })}
              />
            </View>
            <View style={{ width: spacing.md }} />
            <View style={{ flex: 1 }}>
              <TimePickerInput
                label="Fim"
                value={p.end}
                onChange={(hhmm) => setField(i, { end: hhmm })}
              />
            </View>
          </View>

          <Text style={styles.daysLabel}>Dias</Text>
          <View style={styles.daysRow}>
            {DAY_LABELS.map((lbl, d) => {
              const on = ((p.days >> d) & 1) === 1;
              return (
                <Pressable
                  key={lbl}
                  onPress={() => toggleDay(i, d)}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                >
                  <Text style={[styles.dayText, on && styles.dayTextOn]}>{lbl}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <Pressable onPress={add} style={styles.addBtn}>
        <Text style={styles.addBtnText}>+ Adicionar período</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  section: { ...typography.subtitle, color: colors.text.primary },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  empty: { ...typography.small, color: colors.text.tertiary, marginBottom: spacing.sm },
  sleepBox: {
    borderWidth: 1,
    borderColor: colors.accent.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
  sleepHint: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  sleepWindow: { ...typography.small, color: colors.accent.gold, marginTop: spacing.sm },
  groupLabel: {
    ...typography.small,
    color: colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  period: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.bg.surface,
  },
  periodHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  periodTitle: { ...typography.bodyMedium, color: colors.text.primary, flex: 1 },
  remove: { ...typography.small, color: colors.accent.danger },
  timesRow: { flexDirection: 'row', alignItems: 'flex-end' },
  daysLabel: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  daysRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  dayChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayChipOn: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.15)' },
  dayText: { ...typography.small, color: colors.text.tertiary },
  dayTextOn: { color: colors.accent.gold },
  addBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  addBtnText: { ...typography.small, color: colors.accent.gold },
});
