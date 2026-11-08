// As 4 perguntas de AUTOMATICIDADE (SRBAI — Gardner, Abraham, Lally & de Bruijn,
// 2012): é o que decide se um hábito se formou, junto com a força. A força diz
// que você REPETE; a automaticidade, que já não precisa pensar para isso — e é
// esse o ponto em que a coruja pode ficar quieta.
//
// O formulário existe em dois jeitos: dentro de uma folha (Home, detalhe) e
// solto, no meio da revisão da semana.

import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { withAlpha } from './habitShared';
import { colors, radius, spacing, typography } from '../theme';
import { recordSrbai } from '../services/habitos';
import type { HabitDef } from '../types/habits';

export const SRBAI_ITEMS = [
  'faço automaticamente.',
  'faço sem precisar lembrar conscientemente.',
  'faço sem pensar.',
  'começo a fazer antes de perceber.',
];

export type SrbaiResult = { graduated: boolean; regressed: boolean };

/** O formulário: "{título} é algo que eu…" + 4 escalas de 1 a 7. */
export function SrbaiForm({
  habit,
  onSaved,
  compact,
}: {
  habit: HabitDef;
  onSaved: (r: SrbaiResult) => void;
  compact?: boolean;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>([null, null, null, null]);
  const [busy, setBusy] = useState(false);
  const complete = answers.every((a) => a != null);

  const save = async () => {
    if (!complete) return;
    setBusy(true);
    try {
      const r = await recordSrbai(habit.type, answers as [number, number, number, number]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onSaved(r);
    } catch (err) {
      console.warn('recordSrbai:', err);
      Alert.alert('Não consegui salvar agora', 'Tente de novo em instantes.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={[styles.lead, compact && { marginTop: spacing.sm }]}>
        <Text style={styles.leadStrong}>{habit.title}</Text> é algo que eu…
      </Text>
      {SRBAI_ITEMS.map((item, qi) => (
        <View key={qi} style={styles.question}>
          <Text style={styles.qText}>
            {qi + 1}. {item}
          </Text>
          <View style={styles.scale} accessibilityRole="radiogroup" accessibilityLabel={item}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => {
              const on = answers[qi] === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setAnswers((a) => a.map((v, i) => (i === qi ? n : v)));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${n} de 7`}
                  style={[styles.scaleItem, on && styles.scaleItemOn]}
                >
                  <Text style={[styles.scaleText, on && styles.scaleTextOn]}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.ends}>
            <Text style={styles.endText}>discordo totalmente</Text>
            <Text style={styles.endText}>concordo totalmente</Text>
          </View>
        </View>
      ))}
      <View style={{ height: spacing.md }} />
      <Button label="Salvar respostas" onPress={save} loading={busy} disabled={!complete} />
    </View>
  );
}

/** Mensagem depois de salvar: comemora a graduação, acolhe a regressão. */
export function srbaiOutcomeText(habit: HabitDef, r: SrbaiResult): { title: string; text: string } | null {
  if (r.graduated) {
    return {
      title: 'Hábito formado',
      text: `"${habit.title}" já sai sem pensar. A coruja vai ficar em silêncio nele — e a cada duas semanas pergunta de novo, só para conferir.`,
    };
  }
  if (r.regressed) {
    return {
      title: 'Vamos reforçar um pouco',
      text: `"${habit.title}" está pedindo mais atenção agora — acontece, a vida muda. A coruja volta a lembrar por um tempo, sem pressa. Nada do que você construiu se perdeu.`,
    };
  }
  return null;
}

/** A folha com o formulário (Home, detalhe do hábito). */
export function SrbaiSheet({
  visible,
  habit,
  onClose,
  onDone,
}: {
  visible: boolean;
  habit: HabitDef | null;
  onClose: () => void;
  onDone?: (r: SrbaiResult) => void;
}) {
  if (!habit) return null;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Quatro perguntas rápidas"
      subtitle="Responda pelo que sente hoje. Não há resposta certa."
    >
      <SrbaiForm
        habit={habit}
        onSaved={(r) => {
          onClose();
          const out = srbaiOutcomeText(habit, r);
          if (out) Alert.alert(out.title, out.text);
          onDone?.(r);
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { ...typography.body, color: colors.text.primary, marginTop: spacing.lg },
  leadStrong: { fontFamily: typography.bodyMedium.fontFamily },
  question: { marginTop: spacing.lg },
  qText: { ...typography.bodyMedium, color: colors.text.primary, marginBottom: spacing.sm },
  scale: { flexDirection: 'row', gap: 4 },
  scaleItem: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleItemOn: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  scaleText: { ...typography.bodyMedium, color: colors.text.secondary },
  scaleTextOn: { color: colors.text.onGold },
  ends: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  endText: { ...typography.small, fontSize: 11, color: withAlpha(colors.text.primary, 0.55) },
});
