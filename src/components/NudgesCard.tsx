import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme';
import { listNudges } from '../services/database';
import { setNudgeEnabled, setNudgeTime } from '../services/nudges';
import type { Nudge } from '../types';

function parseHHMM(s: string): Date {
  const [h, m] = (s || '20:00').split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 20, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface NudgeRowProps {
  nudge: Nudge;
  onChange: (next: Nudge) => void;
}

function NudgeRow({ nudge, onChange }: NudgeRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const updated = await setNudgeEnabled(nudge.id, next);
      if (updated) onChange(updated);
    } finally {
      setBusy(false);
    }
  };

  const handleTime = async (_event: unknown, date?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (!date) return;
    const newTime = formatHHMM(date);
    setBusy(true);
    try {
      const updated = await setNudgeTime(nudge.id, newTime);
      if (updated) onChange(updated);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.row, nudge.enabled && styles.rowEnabled]}>
      <Text style={styles.emoji}>{nudge.emoji ?? '🦉'}</Text>
      <View style={styles.rowMain}>
        <Text style={styles.title}>{nudge.title}</Text>
        <Text style={styles.body} numberOfLines={3}>
          {nudge.body}
        </Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={styles.timeBtn}
          disabled={!nudge.enabled || busy}
        >
          <Text style={[styles.timeText, !nudge.enabled && { opacity: 0.5 }]}>
            🕐 {nudge.scheduleTime}
          </Text>
        </Pressable>
      </View>
      <View style={styles.rowRight}>
        {busy ? (
          <ActivityIndicator color={colors.accent.gold} />
        ) : (
          <Switch
            value={nudge.enabled}
            onValueChange={toggle}
            trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
            thumbColor={nudge.enabled ? colors.text.onGold : colors.text.tertiary}
          />
        )}
      </View>
      {pickerOpen && (
        <DateTimePicker
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
          is24Hour
          value={parseHHMM(nudge.scheduleTime)}
          onChange={handleTime}
          themeVariant="dark"
        />
      )}
    </View>
  );
}

export function NudgesCard() {
  const [nudges, setNudges] = useState<Nudge[] | null>(null);

  const reload = useCallback(async () => {
    const list = await listNudges();
    setNudges(list);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleChange = (next: Nudge) => {
    setNudges((curr) =>
      curr ? curr.map((n) => (n.id === next.id ? next : n)) : curr,
    );
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.section}>Nudges (lembretes diários)</Text>
        <Pressable onPress={reload} hitSlop={6} style={styles.reloadBtn}>
          <Text style={styles.reloadIcon}>↻</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        Pequenos lembretes que o CoMentor pode te mandar todos os dias em
        horários fixos. Ligue só os que fazem sentido pra você.
      </Text>

      {nudges === null && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      )}

      {nudges?.map((n) => (
        <NudgeRow key={n.id} nudge={n} onChange={handleChange} />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
  reloadBtn: { padding: spacing.xs },
  reloadIcon: { fontSize: 22, color: colors.accent.gold },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  loading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  rowEnabled: {
    backgroundColor: 'rgba(244,197,83,0.06)',
    borderColor: colors.border,
  },
  rowMain: {
    flex: 1,
  },
  rowRight: {
    minWidth: 50,
    alignItems: 'flex-end',
    paddingTop: 2,
  },
  emoji: {
    fontSize: 28,
    marginTop: 2,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  body: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 18,
  },
  timeBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeText: {
    ...typography.small,
    color: colors.accent.gold,
  },
});
