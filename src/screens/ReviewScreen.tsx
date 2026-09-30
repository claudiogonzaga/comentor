import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  answerAutomaticity,
  getAutomaticityQuestion,
  getCompleteDaysStreak,
  getPendingItemsToday,
  type AutomaticityQuestion,
  type PendingItem,
} from '../services/review';
import { confirmNudge, skipNudgeToday } from '../services/nudges';
import { confirmMedication, skipMedicationToday } from '../services/medications';

// FECHAR O DIA: um toque por item sem resposta. É a tela que garante a
// completude da coleta sem multiplicar notificações. "Não fiz" pede um motivo
// opcional em chips — é o dado que a análise externa mais aproveita.

const REASONS = ['sem tempo', 'esqueci', 'não quis', 'doente', 'outro'];

export function ReviewScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [streak, setStreak] = useState(0);
  const [askingReason, setAskingReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoQ, setAutoQ] = useState<AutomaticityQuestion | null>(null);
  const [autoThanks, setAutoThanks] = useState(false);

  const reload = useCallback(async () => {
    setItems(await getPendingItemsToday());
    setStreak(await getCompleteDaysStreak());
  }, []);

  useEffect(() => {
    void getAutomaticityQuestion().then(setAutoQ);
  }, []);

  const answerAuto = async (score: number | null) => {
    if (!autoQ) return;
    await answerAutomaticity(autoQ.key, score);
    setAutoQ(null);
    if (score != null) setAutoThanks(true);
  };

  useEffect(() => {
    void reload();
  }, [reload]);

  const close = async (item: PendingItem, done: boolean, reason?: string) => {
    setBusy(item.key);
    try {
      if (item.kind === 'nudge' && item.nudgeType) {
        if (done) await confirmNudge(item.nudgeType, { via: 'review' });
        else await skipNudgeToday(item.nudgeType, { via: 'review', reason: reason ?? null });
      } else if (item.kind === 'med' && item.medId != null) {
        if (done) await confirmMedication(item.medId, { via: 'review' });
        else await skipMedicationToday(item.medId, { via: 'review', reason: reason ?? null });
      }
    } catch (err) {
      console.warn('review close failed:', err);
    } finally {
      setBusy(null);
      setAskingReason(null);
      await reload();
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Fechar o dia</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Só me diz o que aconteceu. Não precisa fazer agora — precisa registrar, para os
          dados valerem alguma coisa quando você for analisá-los.
        </Text>

        {items.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.allDone}>Tudo fechado por hoje ✓</Text>
            <Text style={styles.streak}>
              {streak > 0
                ? `${streak} dia${streak > 1 ? 's' : ''} seguido${streak > 1 ? 's' : ''} com o registro completo.`
                : 'Amanhã começa a contagem de dias com o registro completo.'}
            </Text>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.key} style={styles.card}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.time}</Text>
              {askingReason === item.key ? (
                <View>
                  <Text style={styles.reasonLabel}>Por quê? (opcional)</Text>
                  <View style={styles.chips}>
                    {REASONS.map((r) => (
                      <Pressable
                        key={r}
                        style={styles.chip}
                        disabled={busy === item.key}
                        onPress={() => void close(item, false, r)}
                      >
                        <Text style={styles.chipText}>{r}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={[styles.chip, styles.chipMuted]} disabled={busy === item.key} onPress={() => void close(item, false)}>
                      <Text style={styles.chipText}>sem motivo</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  <Pressable
                    style={[styles.btn, styles.btnDone]}
                    disabled={busy === item.key}
                    onPress={() => void close(item, true)}
                  >
                    <Text style={styles.btnDoneText}>Fiz ✅</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.btnNot]}
                    disabled={busy === item.key}
                    onPress={() => setAskingReason(item.key)}
                  >
                    <Text style={styles.btnNotText}>Não fiz</Text>
                  </Pressable>
                </View>
              )}
            </Card>
          ))
        )}

        {autoQ && (
          <Card style={styles.card}>
            <Text style={styles.reasonLabel}>Pergunta da semana</Text>
            <Text style={styles.title}>
              “{autoQ.title}” é algo que eu faço sem precisar pensar.
            </Text>
            <Text style={styles.meta}>1 = discordo totalmente · 7 = concordo totalmente</Text>
            <View style={styles.scaleRow}>
              {[1, 2, 3, 4, 5, 6, 7].map((v) => (
                <Pressable
                  key={v}
                  style={styles.scaleBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`${v} de 7`}
                  onPress={() => void answerAuto(v)}
                >
                  <Text style={styles.chipText}>{v}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => void answerAuto(null)} hitSlop={6}>
              <Text style={styles.skipAuto}>agora não</Text>
            </Pressable>
          </Card>
        )}
        {autoThanks && !autoQ && (
          <Text style={styles.streak}>Anotado. Daqui a uma semana eu pergunto de novo.</Text>
        )}

        {items.length > 0 && streak > 0 && (
          <Text style={styles.streak}>
            {streak} dia{streak > 1 ? 's' : ''} seguido{streak > 1 ? 's' : ''} com o registro completo — não deixe hoje quebrar.
          </Text>
        )}
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
  back: { ...typography.bodyMedium, color: colors.accent.gold, minWidth: 60 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  intro: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.lg, lineHeight: 18 },
  card: { marginBottom: spacing.md },
  title: { ...typography.bodyMedium, color: colors.text.primary },
  meta: { ...typography.small, color: colors.text.tertiary, marginTop: 2, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1 },
  btnDone: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  btnDoneText: { ...typography.bodyMedium, color: colors.text.onGold },
  btnNot: { borderColor: colors.bg.surfaceStrong },
  btnNotText: { ...typography.bodyMedium, color: colors.text.primary },
  reasonLabel: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  chipMuted: { borderColor: colors.bg.surfaceStrong },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, marginBottom: spacing.xs },
  scaleBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
  },
  skipAuto: { ...typography.small, color: colors.text.tertiary, textAlign: 'right', marginTop: spacing.xs },
  chipText: { ...typography.small, color: colors.text.primary },
  allDone: { ...typography.subtitle, color: colors.text.primary, textAlign: 'center' },
  streak: { ...typography.small, color: colors.text.secondary, textAlign: 'center', marginTop: spacing.sm },
});
