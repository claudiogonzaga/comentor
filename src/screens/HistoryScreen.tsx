import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  addExperiment,
  deleteExperiment,
  endExperiment,
  getActiveHabits,
  getRecentLogs,
  getStreak,
  listExperiments,
  type Experiment,
} from '../services/database';
import { copyMarkdownToClipboard, shareExport, type ExportOptions } from '../services/exportData';
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

  // Exportar para a IA
  const [exportOpts, setExportOpts] = useState<ExportOptions>({ days: 30, includeChat: true, includeInterview: true });
  const [exporting, setExporting] = useState(false);
  const runExport = async (kind: 'copy' | 'md' | 'csv' | 'json') => {
    setExporting(true);
    try {
      if (kind === 'copy') {
        const r = await copyMarkdownToClipboard(exportOpts);
        Alert.alert(
          r.ok ? 'Copiado' : 'Não deu para copiar',
          r.ok
            ? `${Math.round(r.chars / 1000)} mil caracteres no clipboard. Cole no chat da IA — o texto já começa com as instruções de análise.`
            : r.error ?? '',
        );
      } else {
        const r = await shareExport(kind, exportOpts);
        if (!r.ok && r.error) Alert.alert('Não deu para exportar', r.error);
      }
    } finally {
      setExporting(false);
    }
  };

  // Experimentos (intervenções)
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [expName, setExpName] = useState('');
  const [expHyp, setExpHyp] = useState('');
  const reloadExperiments = useCallback(async () => {
    setExperiments(await listExperiments().catch(() => []));
  }, []);
  useEffect(() => {
    void reloadExperiments();
  }, [reloadExperiments]);
  const startExperiment = async () => {
    if (!expName.trim()) return;
    await addExperiment(expName, expHyp, format(new Date(), 'yyyy-MM-dd'));
    setExpName('');
    setExpHyp('');
    await reloadExperiments();
  };
  const finishExperiment = (e: Experiment) => {
    Alert.alert('Encerrar experimento', `Encerrar “${e.name}” hoje? Os dias seguintes deixam de contar como “durante”.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Encerrar',
        onPress: () => void endExperiment(e.id, format(new Date(), 'yyyy-MM-dd')).then(reloadExperiments),
      },
    ]);
  };
  const removeExperiment = (e: Experiment) => {
    Alert.alert('Apagar experimento', `Apagar “${e.name}”? Os dados dos dias continuam; só a marcação some.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: () => void deleteExperiment(e.id).then(reloadExperiments) },
    ]);
  };

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
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Estatísticas</Text>
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

        {/* EXPORTAR PARA A IA — o que fecha o loop pessoa + IA externa. */}
        <Card style={styles.card}>
          <Text style={[typography.label, styles.sectionLabel]}>EXPORTAR PARA A IA</Text>
          <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
            Tudo o que a coruja coletou, com as instruções de análise no começo. Copie e cole no
            chat da sua IA.
          </Text>
          <View style={styles.chips}>
            {([14, 30, 90] as const).map((d) => (
              <Pressable
                key={d}
                style={[styles.chip, exportOpts.days === d && styles.chipOn]}
                onPress={() => setExportOpts((o) => ({ ...o, days: d }))}
              >
                <Text style={[styles.chipText, exportOpts.days === d && styles.chipTextOn]}>{d} dias</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.toggleRow}>
            <Text style={[typography.small, { color: colors.text.primary, flex: 1 }]}>Incluir conversas com a coruja</Text>
            <Switch
              value={exportOpts.includeChat}
              onValueChange={(v) => setExportOpts((o) => ({ ...o, includeChat: v }))}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={exportOpts.includeChat ? colors.text.onGold : colors.text.tertiary}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={[typography.small, { color: colors.text.primary, flex: 1 }]}>Incluir entrevista (causas e gatilhos)</Text>
            <Switch
              value={exportOpts.includeInterview}
              onValueChange={(v) => setExportOpts((o) => ({ ...o, includeInterview: v }))}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={exportOpts.includeInterview ? colors.text.onGold : colors.text.tertiary}
            />
          </View>
          <Pressable style={[styles.primaryBtn, exporting && { opacity: 0.6 }]} disabled={exporting} onPress={() => void runExport('copy')}>
            <Text style={styles.primaryBtnText}>Copiar para colar na IA</Text>
          </Pressable>
          <View style={styles.chips}>
            <Pressable style={styles.chip} disabled={exporting} onPress={() => void runExport('md')}>
              <Text style={styles.chipText}>Arquivo .md</Text>
            </Pressable>
            <Pressable style={styles.chip} disabled={exporting} onPress={() => void runExport('csv')}>
              <Text style={styles.chipText}>Planilha .csv</Text>
            </Pressable>
            <Pressable style={styles.chip} disabled={exporting} onPress={() => void runExport('json')}>
              <Text style={styles.chipText}>Dados .json</Text>
            </Pressable>
          </View>
        </Card>

        {/* EXPERIMENTOS — a intervenção proposta pela IA vira um objeto com início e fim. */}
        <Card style={styles.card}>
          <Text style={[typography.label, styles.sectionLabel]}>EXPERIMENTOS</Text>
          <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
            Uma intervenção que você vai testar. A exportação compara o antes e o durante.
          </Text>
          {experiments.map((e) => (
            <View key={e.id} style={styles.expRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>{e.name}</Text>
                <Text style={[typography.small, { color: colors.text.tertiary }]}>
                  {e.startDate} → {e.endDate ?? 'em andamento'}
                  {e.hypothesis ? ` · ${e.hypothesis}` : ''}
                </Text>
              </View>
              {!e.endDate ? (
                <Pressable onPress={() => finishExperiment(e)} hitSlop={8}>
                  <Text style={[typography.small, { color: colors.accent.gold }]}>Encerrar</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => removeExperiment(e)} hitSlop={8}>
                  <Text style={[typography.small, { color: colors.text.tertiary }]}>Apagar</Text>
                </Pressable>
              )}
            </View>
          ))}
          <TextInput
            value={expName}
            onChangeText={setExpName}
            placeholder="Nome (ex.: cafeína só até 14h)"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
          />
          <TextInput
            value={expHyp}
            onChangeText={setExpHyp}
            placeholder="Hipótese (opcional): o que deve mudar?"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
          />
          <Pressable style={[styles.primaryBtn, !expName.trim() && { opacity: 0.5 }]} disabled={!expName.trim()} onPress={() => void startExperiment()}>
            <Text style={styles.primaryBtnText}>Começar hoje</Text>
          </Pressable>
        </Card>

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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  chipOn: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  chipText: { ...typography.small, color: colors.text.primary },
  chipTextOn: { color: colors.text.onGold },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  primaryBtn: {
    backgroundColor: colors.accent.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  primaryBtnText: { ...typography.bodyMedium, color: colors.text.onGold },
  expRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
});
