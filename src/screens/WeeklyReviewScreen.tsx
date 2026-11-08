// REVISÃO DA SEMANA (domingo à tarde / segunda): cinco minutos para olhar a
// semana com calma e ajustar o PLANO do que emperrou. O fim de semana é o
// momento do "recomeço" (fresh start, Dai et al. 2014) — a pessoa está mais
// disposta a mudar algo.
//
// Por hábito: feitos/esperados e a força no começo e no fim da semana. As 4
// perguntas de automaticidade pendentes entram aqui mesmo, sem abrir outra tela.
// A Comentora (se houver IA) lê tudo e sugere ajustes concretos — pista, versão
// mínima, plano B, horário — cada um com "Aplicar", que abre a edição já
// preenchida. A revisão fica guardada: reabrir não gasta outra chamada.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { GreekIcon } from '../components/GreekIcon';
import { HabitIcon } from '../components/HabitIcon';
import { SrbaiForm, srbaiOutcomeText } from '../components/SrbaiSheet';
import { FieldLabel, ScreenHeader, fieldStyles, pct, reasonStatusLabel, shortDate, withAlpha } from '../components/habitShared';
import { colors, radius, spacing, typography } from '../theme';
import { getDueSrbai, getWeekSummary } from '../services/habitos';
import {
  coachAvailable,
  getWeeklyReview,
  reviewWeekStart,
  saveWeeklyReview,
  weeklyReview,
  type CoachField,
  type WeeklyReviewResult,
  type WeeklySuggestion,
} from '../services/habitCoach';
import type { HabitInput, WeekSummary } from '../types/habits';

const FIELD_LABEL: Record<CoachField, string> = {
  cue: 'Pista',
  minimum: 'Versão mínima',
  planB: 'Plano B',
  scheduleTime: 'Horário',
  perWeek: 'Vezes por semana',
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A sugestão vira o `prefill` da edição. */
function toPrefill(s: WeeklySuggestion): Partial<HabitInput> {
  switch (s.campo) {
    case 'perWeek':
      return { perWeek: parseInt(s.valor, 10), freq: 'semana' };
    case 'scheduleTime':
      return { scheduleTime: s.valor };
    case 'cue':
      return { cue: s.valor };
    case 'minimum':
      return { minimum: s.valor };
    case 'planB':
      return { planB: s.valor };
  }
}

export function WeeklyReviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const weekStart: string = route.params?.weekStart ?? reviewWeekStart();

  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [due, setDue] = useState<Set<string>>(new Set());
  const [openSrbai, setOpenSrbai] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [aiOn, setAiOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WeeklyReviewResult | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await getWeekSummary(weekStart));
    } catch (err) {
      console.warn('getWeekSummary:', err);
      setFailed(true);
    }
    getDueSrbai()
      .then((list) => setDue(new Set(list.map((h) => h.type))))
      .catch(() => {});
    getWeeklyReview(weekStart)
      .then((saved) => {
        if (!saved) return;
        setNote(saved.note);
        setResult(saved.result);
      })
      .catch(() => {});
  }, [weekStart]);

  useEffect(() => {
    void load();
    coachAvailable().then(setAiOn).catch(() => setAiOn(false));
  }, [load]);

  const analyze = async () => {
    if (!summary) return;
    setBusy(true);
    try {
      const r = await weeklyReview(summary, note);
      if (!r) {
        Alert.alert('Não deu agora', 'Não consegui falar com a IA. Você pode concluir a revisão assim mesmo.');
        return;
      }
      setResult(r);
      await saveWeeklyReview(weekStart, note, r).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await saveWeeklyReview(weekStart, note, result).catch(() => {});
    navigation.goBack();
  };

  const rangeLabel = summary ? `${shortDate(summary.weekStart)} a ${shortDate(summary.weekEnd)}` : '';

  return (
    <ScreenContainer>
      <ScreenHeader title="Revisão da semana" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!summary && !failed && (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent.gold} />
            </View>
          )}
          {failed && <Text style={styles.muted}>A semana não carregou agora. Tente reabrir a tela.</Text>}

          {summary && (
            <>
              <Text style={styles.range}>{rangeLabel}</Text>
              <Text style={styles.lead}>
                Olhe sem pressa e sem julgamento. O que emperrou quase sempre pede um ajuste no plano, não mais força
                de vontade.
              </Text>

              {summary.habits.length === 0 && (
                <Text style={styles.muted}>Nenhum hábito ativo nesta semana.</Text>
              )}

              {summary.habits.map((s) => {
                const h = s.habit;
                const parar = h.kind === 'parar';
                const delta = Math.round((s.strengthEnd - s.strengthStart) * 100);
                return (
                  <Card key={h.type} style={styles.card}>
                    <View style={styles.habitHead}>
                      <HabitIcon emoji={h.emoji} size={22} color={colors.accent.gold} />
                      <Text style={styles.habitTitle} numberOfLines={2}>
                        {cap(h.title)}
                      </Text>
                    </View>
                    <View style={styles.numbers}>
                      <View style={styles.num}>
                        <Text style={styles.numBig}>
                          {s.done} de {s.expected}
                        </Text>
                        <Text style={styles.numSmall}>{parar ? 'dias limpos' : 'feitos'}</Text>
                      </View>
                      <View style={styles.num}>
                        <Text style={styles.numBig}>
                          {pct(s.strengthStart)} → {pct(s.strengthEnd)}
                        </Text>
                        <Text style={styles.numSmall}>
                          força {delta > 0 ? `(+${delta})` : delta < 0 ? `(${delta})` : '(estável)'}
                        </Text>
                      </View>
                    </View>
                    {parar && (
                      <Text style={styles.line}>
                        {s.resisted} {s.resisted === 1 ? 'vontade superada' : 'vontades superadas'} · {s.slips}{' '}
                        {s.slips === 1 ? 'deslize' : 'deslizes'}
                      </Text>
                    )}
                    {s.reasons.slice(0, 3).map((r, i) => (
                      <Text key={`${r.date}-${i}`} style={styles.reason}>
                        {shortDate(r.date)} · {reasonStatusLabel(r.status, h.kind)}: {r.reason}
                      </Text>
                    ))}

                    {/* As 4 perguntas pendentes, aqui mesmo. */}
                    {due.has(h.type) && !answered[h.type] && (
                      openSrbai === h.type ? (
                        <View style={styles.srbaiBox}>
                          <SrbaiForm
                            habit={h}
                            compact
                            onSaved={(r) => {
                              const out = srbaiOutcomeText(h, r);
                              setAnswered((a) => ({ ...a, [h.type]: out ? out.text : 'Respostas guardadas. Obrigada!' }));
                              setOpenSrbai(null);
                            }}
                          />
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => setOpenSrbai(h.type)}
                          style={styles.srbaiBtn}
                          accessibilityRole="button"
                        >
                          <GreekIcon name="brain" size={16} color={colors.accent.gold} />
                          <Text style={styles.srbaiBtnText}>Já sai sem pensar? 4 perguntas</Text>
                        </Pressable>
                      )
                    )}
                    {answered[h.type] ? <Text style={styles.answered}>{answered[h.type]}</Text> : null}
                  </Card>
                );
              })}

              <FieldLabel>O que atrapalhou esta semana? (opcional)</FieldLabel>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Ex.: viajei dois dias; fiquei até tarde no trabalho"
                placeholderTextColor={colors.text.tertiary}
                style={[fieldStyles.input, fieldStyles.multiline]}
                multiline
                maxLength={500}
              />

              {result && (
                <Card style={StyleSheet.flatten([styles.card, styles.resultCard])}>
                  <View style={styles.habitHead}>
                    <GreekIcon name="owl" size={20} color={colors.accent.gold} />
                    <Text style={styles.resultLabel}>A COMENTORA</Text>
                  </View>
                  <Text style={styles.resultText}>{result.texto}</Text>
                  {result.sugestoes.map((sg, i) => {
                    const h = summary.habits.find((x) => x.habit.type === sg.type)?.habit;
                    return (
                      <View key={`${sg.type}-${sg.campo}-${i}`} style={styles.sugg}>
                        <Text style={styles.suggHabit}>
                          {h ? cap(h.title) : ''} · {FIELD_LABEL[sg.campo]}
                        </Text>
                        <Text style={styles.suggValue}>{sg.valor}</Text>
                        {sg.motivo ? <Text style={styles.suggWhy}>{sg.motivo}</Text> : null}
                        <Pressable
                          onPress={() => navigation.navigate('HabitEdit', { type: sg.type, prefill: toPrefill(sg) })}
                          style={styles.applyBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Aplicar: ${FIELD_LABEL[sg.campo]} ${sg.valor}`}
                        >
                          <Text style={styles.applyText}>Aplicar</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </Card>
              )}

              <View style={{ height: spacing.lg }} />
              {aiOn && summary.habits.length > 0 && (
                <>
                  <Button
                    label={result ? 'Analisar de novo' : 'Analisar com a Comentora'}
                    variant={result ? 'secondary' : 'primary'}
                    onPress={analyze}
                    loading={busy}
                  />
                  <View style={{ height: spacing.sm }} />
                </>
              )}
              <Button label="Concluir revisão" variant={aiOn && !result ? 'secondary' : 'primary'} onPress={finish} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  muted: { ...typography.body, color: colors.text.secondary, marginTop: spacing.lg },
  range: { ...typography.label, color: colors.accent.gold, textTransform: 'uppercase' },
  lead: { ...typography.body, color: colors.text.secondary, marginTop: spacing.xs },
  card: { marginTop: spacing.lg },
  habitHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  habitTitle: { ...typography.subtitle, color: colors.text.primary, flex: 1 },
  numbers: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  num: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  numBig: { ...typography.bodyMedium, color: colors.text.primary },
  numSmall: { ...typography.small, color: colors.text.secondary },
  line: { ...typography.small, color: colors.text.secondary, marginTop: spacing.sm },
  reason: { ...typography.small, color: colors.text.secondary, marginTop: spacing.xs },
  srbaiBox: { marginTop: spacing.sm },
  srbaiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    marginTop: spacing.sm,
  },
  srbaiBtnText: { ...typography.bodyMedium, color: colors.accent.gold },
  answered: { ...typography.small, color: colors.text.primary, marginTop: spacing.sm },
  resultCard: { borderColor: colors.accent.gold, backgroundColor: withAlpha(colors.accent.gold, 0.06) },
  resultLabel: { ...typography.label, color: colors.accent.gold },
  resultText: { ...typography.body, color: colors.text.primary, marginTop: spacing.sm },
  sugg: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  suggHabit: { ...typography.label, color: colors.text.secondary, textTransform: 'uppercase' },
  suggValue: { ...typography.bodyMedium, color: colors.text.primary, marginTop: 2 },
  suggWhy: { ...typography.small, color: colors.text.secondary, marginTop: 2 },
  applyBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  applyText: { ...typography.bodyMedium, color: colors.accent.gold },
});
