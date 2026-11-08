// O DETALHE de um hábito: tudo o que ajuda a entender como ele está indo.
//
// A medida principal é a FORÇA (0–100%, à moda do Loop Habit Tracker): sobe com
// cada repetição e desce devagar com as faltas — uma falta não zera nada, ao
// contrário da sequência clássica, que pune o dia ruim e faz largar tudo. A
// sequência aparece, mas na versão tolerante ("sem falhar duas vezes"). O mapa
// de calor mostra o padrão (e deixa corrigir um dia esquecido); a
// automaticidade diz se já sai sem pensar; os motivos e, nos hábitos de parar,
// os gatilhos mostram onde o plano precisa de ajuste.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { HabitIcon } from '../components/HabitIcon';
import { HabitDaySheet } from '../components/HabitDaySheet';
import { SrbaiSheet } from '../components/SrbaiSheet';
import { PauseSheet, PAUSE_NO_DATE } from '../components/PauseSheet';
import { HabitHeatmap, StrengthChart, TriggerBars } from '../components/HabitCharts';
import { HabitCelebration, milestoneText } from '../components/HabitCelebration';
import {
  STAGE_LABEL,
  ScreenHeader,
  StrengthRing,
  addDays,
  dayLabel,
  planSentence,
  reasonStatusLabel,
  shortDate,
  stageExplain,
} from '../components/habitShared';
import { colors, radius, spacing, typography } from '../theme';
import {
  getHabit,
  getHabitReasons,
  getHabitStats,
  listSlips,
  listSrbai,
  pauseHabit,
} from '../services/habitos';
import type { HabitDef, HabitSlip, HabitStats, MarkResult, SrbaiEntry } from '../types/habits';

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A leitura da média do SRBAI (1..7). */
function srbaiWord(mean: number): string {
  if (mean >= 5.5) return 'automático';
  if (mean >= 4) return 'a caminho';
  return 'ainda pede esforço';
}

const HOUR_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: 'madrugada', from: 0, to: 5 },
  { label: 'manhã', from: 6, to: 11 },
  { label: 'tarde', from: 12, to: 17 },
  { label: 'noite', from: 18, to: 23 },
];

/** Agrupa deslizes e vontades superadas por um campo (emoção, lugar…). */
function tally(slips: HabitSlip[], key: (s: HabitSlip) => string | null) {
  const m = new Map<string, { label: string; resisted: number; slips: number }>();
  for (const s of slips) {
    const k = key(s);
    if (!k) continue;
    const row = m.get(k) ?? { label: k, resisted: 0, slips: 0 };
    if (s.resisted) row.resisted++;
    else row.slips++;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.resisted + b.slips - (a.resisted + a.slips)).slice(0, 6);
}

export function HabitDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const type: string = route.params?.type ?? '';

  const [habit, setHabit] = useState<HabitDef | null>(null);
  const [stats, setStats] = useState<HabitStats | null>(null);
  const [srbai, setSrbai] = useState<SrbaiEntry[]>([]);
  const [reasons, setReasons] = useState<{ date: string; status: string; reason: string }[]>([]);
  const [slips, setSlips] = useState<HabitSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  const [srbaiOpen, setSrbaiOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [party, setParty] = useState<{ title: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const h = await getHabit(type);
      if (!h) {
        setMissing(true);
        return;
      }
      setHabit(h);
      const [st, sr, rs, sl] = await Promise.all([
        getHabitStats(type),
        listSrbai(type).catch(() => [] as SrbaiEntry[]),
        getHabitReasons(type, 30).catch(() => []),
        h.kind === 'parar' ? listSlips(type, 90).catch(() => [] as HabitSlip[]) : Promise.resolve([] as HabitSlip[]),
      ]);
      setStats(st);
      setSrbai(sr);
      setReasons(rs);
      setSlips(sl);
    } catch (err) {
      console.warn('HabitDetail:', err);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const triggers = useMemo(() => {
    const byHour = tally(slips, (s) => {
      const h = new Date(s.at).getHours();
      return HOUR_BUCKETS.find((b) => h >= b.from && h <= b.to)?.label ?? null;
    });
    return {
      emotion: tally(slips, (s) => s.emotion),
      place: tally(slips, (s) => s.place),
      hour: byHour,
      resisted: slips.filter((s) => s.resisted).length,
      slipped: slips.filter((s) => !s.resisted).length,
    };
  }, [slips]);

  const onDayChanged = (r: MarkResult | null) => {
    if (r?.milestone && habit) setParty(milestoneText(r.milestone, habit.title));
    void load();
  };

  if (loading && !habit) {
    return (
      <ScreenContainer>
        <ScreenHeader title="" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      </ScreenContainer>
    );
  }
  if (missing || !habit) {
    return (
      <ScreenContainer>
        <ScreenHeader title="" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Text style={styles.muted}>Não achei este hábito. Talvez tenha sido apagado.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const parar = habit.kind === 'parar';
  const latestSrbai = srbai.length ? srbai[srbai.length - 1] : null;
  const recentSrbai = [...srbai].slice(-5).reverse();

  return (
    <ScreenContainer>
      <ScreenHeader
        title=""
        onBack={() => navigation.goBack()}
        right={
          <Pressable
            onPress={() => navigation.navigate('HabitEdit', { type })}
            hitSlop={12}
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={styles.headerAction}>Editar</Text>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ——— cabeçalho ——— */}
        <View style={styles.head}>
          <View style={styles.headIcon}>
            <HabitIcon emoji={habit.emoji} size={30} color={colors.accent.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} accessibilityRole="header">
              {cap(habit.title)}
            </Text>
            <Text style={styles.plan}>{planSentence(habit)}</Text>
          </View>
        </View>
        {stats && (
          <View style={styles.stageBox}>
            <Text style={styles.stage}>
              {habit.pausedUntil
                ? habit.pausedUntil === PAUSE_NO_DATE
                  ? 'Pausado, sem data'
                  : `Pausado · volta em ${dayLabel(addDays(habit.pausedUntil, 1))}`
                : habit.archived
                  ? 'Arquivado'
                  : !habit.enabled
                    ? 'Desligado'
                    : STAGE_LABEL[stats.stage]}
            </Text>
            {!habit.pausedUntil && !habit.archived && <Text style={styles.stageLine}>{stageExplain(habit, stats)}</Text>}
          </View>
        )}

        {/* ——— força ——— */}
        {stats ? (
          <>
            <View style={styles.ringWrap}>
              <StrengthRing value={stats.strength} size={150} stroke={12} labelSize={40} />
              <Text style={styles.ringLabel}>força do hábito</Text>
            </View>

            <View style={styles.blocks}>
              <Block
                big={`${stats.last30.done} de ${stats.last30.total}`}
                small="nos últimos 30 dias"
              />
              {parar ? (
                <Block big={`${stats.cleanDays ?? 0}`} small={(stats.cleanDays ?? 0) === 1 ? 'dia limpo' : 'dias limpos'} />
              ) : (
                <Block big={`${stats.streak}`} small={`sequência sem falhar duas vezes (melhor: ${stats.best})`} />
              )}
              <Block big={`${stats.total}`} small={stats.total === 1 ? 'dia feito no total' : 'dias feitos no total'} />
            </View>
            {habit.freq === 'semana' && stats.weekDone != null && (
              <Text style={styles.weekLine}>
                Esta semana: {stats.weekDone} de {habit.perWeek ?? '?'}
              </Text>
            )}

            {/* ——— mapa de calor ——— */}
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Últimos 120 dias</Text>
              <Text style={styles.cardHint}>Toque num dia para ver ou corrigir o registro.</Text>
              <View style={{ height: spacing.sm }} />
              <HabitHeatmap heat={stats.heat} createdDay={habit.createdDay} onDayPress={setSheetDay} />
            </Card>

            {/* ——— curva da força ——— */}
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>A força ao longo do tempo</Text>
              <Text style={styles.cardHint}>
                Acima de 50%, firmando; de 80%, quase automático. Uma falta só faz a curva descer um pouco.
              </Text>
              <View style={{ height: spacing.sm }} />
              <StrengthChart series={stats.series} />
            </Card>

            {/* ——— automaticidade ——— */}
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Já sai sem pensar?</Text>
              {latestSrbai ? (
                <Text style={styles.cardHint}>
                  Última resposta: {latestSrbai.mean.toFixed(1)} de 7 — {srbaiWord(latestSrbai.mean)}. Formado é força
                  de 90% e automaticidade de 5,5.
                </Text>
              ) : (
                <Text style={styles.cardHint}>
                  Quatro perguntas, a cada duas semanas, dizem se o hábito já é automático. Ainda sem respostas.
                </Text>
              )}
              {recentSrbai.map((e) => (
                <View key={e.date} style={styles.srbaiRow}>
                  <Text style={styles.srbaiDate}>{shortDate(e.date)}</Text>
                  <View style={styles.srbaiTrack}>
                    <View style={[styles.srbaiFill, { width: `${Math.round(((e.mean - 1) / 6) * 100)}%` }]} />
                  </View>
                  <Text style={styles.srbaiVal}>{e.mean.toFixed(1)}</Text>
                </View>
              ))}
              {stats.srbaiDue && (
                <View style={{ marginTop: spacing.md }}>
                  <Button label="Responder agora" variant="secondary" onPress={() => setSrbaiOpen(true)} />
                </View>
              )}
            </Card>

            {/* ——— motivos ——— */}
            {reasons.length > 0 && (
              <Card style={styles.card}>
                <Text style={styles.cardTitle}>Motivos recentes</Text>
                <Text style={styles.cardHint}>O que se repete aqui costuma pedir um ajuste no plano, não mais esforço.</Text>
                {reasons.slice(0, 8).map((r, i) => (
                  <View key={`${r.date}-${i}`} style={styles.reasonRow}>
                    <Text style={styles.reasonDate}>{shortDate(r.date)}</Text>
                    <Text style={styles.reasonText}>
                      <Text style={styles.reasonStatus}>{reasonStatusLabel(r.status, habit.kind)}</Text> · {r.reason}
                    </Text>
                  </View>
                ))}
              </Card>
            )}

            {/* ——— gatilhos (parar) ——— */}
            {parar && (
              <Card style={styles.card}>
                <Text style={styles.cardTitle}>Mapa de gatilhos</Text>
                <Text style={styles.cardHint}>
                  Últimos 90 dias: {triggers.resisted} {triggers.resisted === 1 ? 'vontade superada' : 'vontades superadas'} e{' '}
                  {triggers.slipped} {triggers.slipped === 1 ? 'deslize' : 'deslizes'}.
                  {triggers.resisted + triggers.slipped === 0
                    ? ' Registre as vontades e os deslizes para ver o padrão aparecer.'
                    : ''}
                </Text>
                {triggers.emotion.length > 0 && (
                  <>
                    <Text style={styles.triggerTitle}>Como você estava</Text>
                    <TriggerBars rows={triggers.emotion} />
                  </>
                )}
                {triggers.place.length > 0 && (
                  <>
                    <Text style={styles.triggerTitle}>Onde</Text>
                    <TriggerBars rows={triggers.place} />
                  </>
                )}
                {triggers.hour.length > 0 && (
                  <>
                    <Text style={styles.triggerTitle}>Hora do dia</Text>
                    <TriggerBars rows={triggers.hour} />
                  </>
                )}
                {triggers.resisted + triggers.slipped > 0 && (
                  <View style={styles.triggerLegend}>
                    <View style={[styles.legendSwatch, { backgroundColor: colors.accent.gold }]} />
                    <Text style={styles.legendText}>vontade superada</Text>
                    <View style={[styles.legendSwatch, { backgroundColor: colors.accent.danger, opacity: 0.5 }]} />
                    <Text style={styles.legendText}>deslize</Text>
                  </View>
                )}
                <View style={{ height: spacing.md }} />
                <Button
                  label="Vontade agora"
                  variant="secondary"
                  onPress={() => navigation.navigate('UrgeSurf', { type })}
                />
              </Card>
            )}
          </>
        ) : (
          <Text style={styles.muted}>As estatísticas não carregaram agora.</Text>
        )}

        <View style={{ height: spacing.md }} />
        <Button label="Editar" onPress={() => navigation.navigate('HabitEdit', { type })} />
        <View style={{ height: spacing.sm }} />
        {habit.pausedUntil ? (
          <Button
            label="Retomar hoje"
            variant="secondary"
            onPress={async () => {
              try {
                await pauseHabit(type, null);
              } catch {
                Alert.alert('Não consegui retomar agora', 'Tente de novo em instantes.');
              }
              void load();
            }}
          />
        ) : (
          <Button label="Pausar" variant="secondary" onPress={() => setPauseOpen(true)} />
        )}
      </ScrollView>

      <HabitDaySheet
        visible={!!sheetDay}
        habit={habit}
        day={sheetDay ?? undefined}
        onClose={() => setSheetDay(null)}
        onChanged={onDayChanged}
      />
      <SrbaiSheet visible={srbaiOpen} habit={habit} onClose={() => setSrbaiOpen(false)} onDone={() => void load()} />
      <PauseSheet
        visible={pauseOpen}
        title={`Pausar "${habit.title}"`}
        subtitle="Os dias pausados não contam: a força fica parada até você voltar."
        onClose={() => setPauseOpen(false)}
        onConfirm={async (until) => {
          try {
            await pauseHabit(type, until);
          } catch {
            Alert.alert('Não consegui pausar agora', 'Tente de novo em instantes.');
          }
          void load();
        }}
      />
      <HabitCelebration
        visible={!!party}
        title={party?.title ?? ''}
        text={party?.text ?? ''}
        onClose={() => setParty(null)}
      />
    </ScreenContainer>
  );
}

function Block({ big, small }: { big: string; small: string }) {
  return (
    <View style={styles.block} accessible accessibilityLabel={`${big} ${small}`}>
      <Text style={styles.blockBig}>{big}</Text>
      <Text style={styles.blockSmall}>{small}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  headerAction: { ...typography.bodyMedium, color: colors.accent.gold },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.title, color: colors.text.primary },
  plan: { ...typography.body, color: colors.text.secondary, marginTop: 2 },
  stageBox: { marginTop: spacing.md },
  stage: { ...typography.label, color: colors.accent.gold, textTransform: 'uppercase' },
  stageLine: { ...typography.small, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  ringWrap: { alignItems: 'center', marginVertical: spacing.xl },
  ringLabel: { ...typography.small, color: colors.text.secondary, marginTop: spacing.sm },
  blocks: { flexDirection: 'row', gap: spacing.sm },
  block: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  blockBig: { ...typography.subtitle, color: colors.text.primary },
  blockSmall: { ...typography.small, color: colors.text.secondary, marginTop: 2 },
  weekLine: { ...typography.bodyMedium, color: colors.text.primary, marginTop: spacing.md, textAlign: 'center' },
  card: { marginTop: spacing.lg },
  cardTitle: { ...typography.subtitle, color: colors.text.primary },
  cardHint: { ...typography.small, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  srbaiRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  srbaiDate: { ...typography.small, color: colors.text.secondary, width: 52 },
  srbaiTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg.surfaceStrong, overflow: 'hidden' },
  srbaiFill: { height: '100%', backgroundColor: colors.accent.gold },
  srbaiVal: { ...typography.small, color: colors.text.primary, width: 28, textAlign: 'right' },
  reasonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
  },
  reasonDate: { ...typography.small, color: colors.text.tertiary, width: 52 },
  reasonText: { ...typography.small, color: colors.text.primary, flex: 1 },
  reasonStatus: { color: colors.text.secondary },
  triggerTitle: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  triggerLegend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  legendSwatch: { width: 10, height: 10, borderRadius: 2, marginLeft: spacing.xs },
  legendText: { ...typography.small, fontSize: 11, color: colors.text.secondary },
});
