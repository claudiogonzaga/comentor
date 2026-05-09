import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { getDashboardData, markSleepDone } from '../services/coach';
import type { OwlMood } from '../types';
import { cancelAllReminders } from '../services/notifications';

interface Dashboard {
  config: { bedtime: string; name: string | null };
  streak: { currentStreak: number; bestStreak: number };
  minutesToBedtime: number | null;
  todayLog: { completed: boolean } | null;
  sleepHabit: { id: number } | null;
}

function formatCountdown(mins: number): { value: string; unit: string } {
  if (mins < 0) {
    const late = Math.abs(mins);
    if (late < 60) return { value: `${late}`, unit: 'min atrasado' };
    return { value: `${Math.floor(late / 60)}h${late % 60}`, unit: 'atrasado' };
  }
  if (mins < 60) return { value: `${mins}`, unit: 'min até dormir' };
  return { value: `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`, unit: 'até dormir' };
}

function moodForState(d: Dashboard | null): OwlMood {
  if (!d) return 'calm';
  if (d.todayLog?.completed) return 'sleeping';
  if (d.minutesToBedtime !== null && d.minutesToBedtime < -30) return 'serious';
  if (d.minutesToBedtime !== null && d.minutesToBedtime < 0) return 'worried';
  if (d.streak.currentStreak >= 3 && d.streak.currentStreak % 7 === 0) return 'celebrating';
  return 'calm';
}

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [data, setData] = useState<Dashboard | null>(null);
  const [marking, setMarking] = useState(false);

  const reload = useCallback(async () => {
    const d = await getDashboardData();
    setData({
      config: { bedtime: d.config.bedtime, name: d.config.name },
      streak: d.streak,
      minutesToBedtime: d.minutesToBedtime,
      todayLog: d.todayLog ? { completed: d.todayLog.completed } : null,
      sleepHabit: d.sleepHabit ? { id: d.sleepHabit.id } : null,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      const interval = setInterval(reload, 30_000);
      return () => clearInterval(interval);
    }, [reload]),
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const handleMarkDone = async () => {
    if (!data?.sleepHabit) return;
    setMarking(true);
    try {
      await markSleepDone(data.sleepHabit.id);
      await cancelAllReminders();
      await reload();
    } finally {
      setMarking(false);
    }
  };

  const mood = moodForState(data);
  const countdown = data?.minutesToBedtime !== null && data?.minutesToBedtime !== undefined
    ? formatCountdown(data.minutesToBedtime)
    : null;
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={[typography.body, { color: colors.text.secondary }]}>
            {greeting}{data?.config.name ? `, ${data.config.name}` : ''}
          </Text>
          <Pressable onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settingsLink}>⚙</Text>
          </Pressable>
        </View>

        <View style={styles.owlWrap}>
          <Owl mood={mood} size={180} />
        </View>

        {data?.todayLog?.completed ? (
          <Card style={styles.bigCard}>
            <Text style={[typography.subtitle, { color: colors.accent.gold, textAlign: 'center' }]}>
              Boa noite! 🌙
            </Text>
            <Text style={[typography.body, styles.cardBody]}>
              Você marcou que dormiu hoje. Vai bem, descanse fundo. A gente se vê amanhã.
            </Text>
          </Card>
        ) : countdown ? (
          <Card style={styles.bigCard}>
            <Text style={[typography.label, styles.label]}>
              {data?.minutesToBedtime !== null && data!.minutesToBedtime < 0 ? 'ATRASADO' : 'PRÓXIMO LEMBRETE'}
            </Text>
            <View style={styles.countdownRow}>
              <Text
                style={[
                  styles.countdownValue,
                  data?.minutesToBedtime !== null && data!.minutesToBedtime < 0 && {
                    color: colors.accent.warning,
                  },
                ]}
              >
                {countdown.value}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
                {countdown.unit}
              </Text>
            </View>
            <Text style={[typography.small, { color: colors.text.tertiary, textAlign: 'center' }]}>
              horário-alvo: {data?.config.bedtime}
            </Text>
          </Card>
        ) : null}

        <View style={styles.streakRow}>
          <Card style={styles.streakCard}>
            <Text style={styles.streakNumber}>{data?.streak.currentStreak ?? 0}</Text>
            <Text style={styles.streakLabel}>Streak atual</Text>
          </Card>
          <Card style={styles.streakCard}>
            <Text style={styles.streakNumber}>{data?.streak.bestStreak ?? 0}</Text>
            <Text style={styles.streakLabel}>Melhor</Text>
          </Card>
        </View>

        {!data?.todayLog?.completed && (
          <View style={styles.actions}>
            <Button
              label="Conversar com a Corujinha"
              onPress={() => navigation.navigate('Chat')}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              label="Vou dormir agora 🌙"
              variant="secondary"
              onPress={handleMarkDone}
              loading={marking}
            />
          </View>
        )}

        <Pressable onPress={() => navigation.navigate('History')} style={styles.historyLink}>
          <Text style={[typography.bodyMedium, { color: colors.accent.gold }]}>
            Ver histórico →
          </Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  settingsLink: {
    fontSize: 24,
    color: colors.text.secondary,
  },
  owlWrap: {
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  bigCard: {
    marginBottom: spacing.lg,
    paddingVertical: spacing.xl,
  },
  cardBody: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  label: {
    color: colors.text.tertiary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  countdownValue: {
    ...typography.hero,
    color: colors.accent.gold,
    fontSize: 48,
    lineHeight: 56,
  },
  streakRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  streakCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
  },
  streakNumber: {
    ...typography.hero,
    color: colors.accent.gold,
    fontSize: 36,
    lineHeight: 44,
  },
  streakLabel: {
    ...typography.label,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  actions: {
    marginBottom: spacing.xl,
  },
  historyLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
});
