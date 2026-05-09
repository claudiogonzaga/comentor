import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { getActiveHabits, getRecentLogs, getStreak } from '../services/database';
import type { DailyLog } from '../types';

interface Stats {
  total: number;
  completed: number;
  avgRemindersBeforeSleep: number;
  weekly: { date: string; completed: boolean; remindersSent: number }[];
}

export function HistoryScreen() {
  const navigation = useNavigation<any>();
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, completed: 0, avgRemindersBeforeSleep: 0, weekly: [] });
  const [streak, setStreak] = useState({ current: 0, best: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const habits = await getActiveHabits();
      const sleep = habits.find((h) => h.type === 'sleep');
      if (!sleep) {
        setLoading(false);
        return;
      }
      const recent = await getRecentLogs(sleep.id, 30);
      const s = await getStreak(sleep.id);
      setStreak({ current: s.currentStreak, best: s.bestStreak });

      const completed = recent.filter((r) => r.completed);
      const avgReminders =
        completed.length > 0
          ? completed.reduce((acc, r) => acc + r.remindersSent, 0) / completed.length
          : 0;
      const weekly = recent
        .slice(0, 7)
        .map((r) => ({ date: r.date, completed: r.completed, remindersSent: r.remindersSent }))
        .reverse();

      setStats({
        total: recent.length,
        completed: completed.length,
        avgRemindersBeforeSleep: Math.round(avgReminders * 10) / 10,
        weekly,
      });
      setLogs(recent);
      setLoading(false);
    })();
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Histórico</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{streak.current}</Text>
            <Text style={styles.statLabel}>streak</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{streak.best}</Text>
            <Text style={styles.statLabel}>melhor</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>
              {stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100)}%
            </Text>
            <Text style={styles.statLabel}>30 dias</Text>
          </Card>
        </View>

        <Card style={styles.card}>
          <Text style={[typography.label, styles.sectionLabel]}>ÚLTIMOS 7 DIAS</Text>
          <View style={styles.weekRow}>
            {stats.weekly.length === 0 && (
              <Text style={[typography.small, { color: colors.text.tertiary }]}>
                Sem dados ainda. Volte depois de algumas noites.
              </Text>
            )}
            {stats.weekly.map((d) => (
              <View key={d.date} style={styles.dayCol}>
                <View
                  style={[
                    styles.bar,
                    d.completed
                      ? { backgroundColor: colors.accent.gold, height: 60 }
                      : { backgroundColor: colors.bg.surfaceStrong, height: 24 },
                  ]}
                />
                <Text style={styles.dayLabel}>
                  {format(parseISO(d.date), 'EEE', { locale: ptBR }).slice(0, 3)}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[typography.small, styles.subtleNote]}>
            Lembretes médios até dormir: {stats.avgRemindersBeforeSleep}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={[typography.label, styles.sectionLabel]}>NOITES RECENTES</Text>
          {logs.length === 0 ? (
            <Text style={[typography.small, { color: colors.text.tertiary }]}>
              Nenhuma noite registrada ainda.
            </Text>
          ) : (
            logs.slice(0, 14).map((l) => (
              <View key={l.id} style={styles.logRow}>
                <Text style={styles.logDate}>
                  {format(parseISO(l.date), "d 'de' MMM", { locale: ptBR })}
                </Text>
                <View style={styles.logRight}>
                  {l.completed ? (
                    <Text style={[typography.small, { color: colors.accent.success }]}>
                      ✓ {l.actualTime ?? ''}
                    </Text>
                  ) : (
                    <Text style={[typography.small, { color: colors.text.tertiary }]}>
                      —
                    </Text>
                  )}
                  <Text style={[typography.small, { color: colors.text.tertiary, marginLeft: spacing.md }]}>
                    {l.remindersSent} lembretes
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    minWidth: 60,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  statValue: {
    ...typography.hero,
    fontSize: 28,
    color: colors.accent.gold,
  },
  statLabel: {
    ...typography.label,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  card: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    color: colors.text.tertiary,
    marginBottom: spacing.md,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    minHeight: 80,
    marginBottom: spacing.md,
  },
  dayCol: {
    alignItems: 'center',
    flex: 1,
  },
  bar: {
    width: 16,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  dayLabel: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'lowercase',
  },
  subtleNote: {
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logDate: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  logRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
