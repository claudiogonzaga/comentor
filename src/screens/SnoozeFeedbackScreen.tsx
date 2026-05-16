import { useEffect, useState } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  addSnoozeFeedback,
  getLatestCompletedInterview,
  getOrCreateLog,
} from '../services/database';
import { getSnoozeArgument } from '../services/coach';
import { snoozeFor } from '../services/notifications';
import { useAppStore } from '../store/useAppStore';
import { format } from 'date-fns';
import type { IntensityLevel } from '../types';

type SnoozeParams = {
  SnoozeFeedback: {
    habitId: number;
    level: IntensityLevel;
  };
};

const FALLBACK_REASONS = [
  'estou no celular',
  'não estou com sono',
  'ansiedade',
  'trabalho atrasado',
];

export function SnoozeFeedbackScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<SnoozeParams, 'SnoozeFeedback'>>();
  const { habitId, level } = route.params;
  const { config } = useAppStore();

  const [reasons, setReasons] = useState<string[]>(FALLBACK_REASONS);
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void loadDerivedReasons();
  }, []);

  const loadDerivedReasons = async () => {
    const interview = await getLatestCompletedInterview();
    if (interview?.summary?.derivedReasons && interview.summary.derivedReasons.length > 0) {
      setReasons(interview.summary.derivedReasons);
    }
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      const log = await getOrCreateLog(habitId, today, config?.bedtime ?? '23:00');
      await addSnoozeFeedback(
        habitId,
        log.id,
        15,
        selected,
        customText.trim() || null,
      );
      // Gera o contra-argumento (que agora vai usar entrevista + feedback)
      await getSnoozeArgument(habitId, level, 15);
      await snoozeFor(15, level, habitId);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Erro', err instanceof Error ? err.message : 'Falha ao registrar.');
    } finally {
      setSubmitting(false);
    }
  };

  const skipFeedback = async () => {
    setSubmitting(true);
    try {
      await getSnoozeArgument(habitId, level, 15);
      await snoozeFor(15, level, habitId);
      navigation.goBack();
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!selected || customText.trim().length > 0;

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Owl mood="serious" size={120} />
            <Text style={[typography.title, styles.title]}>Antes de adiar…</Text>
            <Text style={[typography.body, styles.subtitle]}>
              O que está te segurando agora? Vai me ajudar a te conhecer melhor.
            </Text>
          </View>

          <View style={styles.reasonsList}>
            {reasons.map((r) => (
              <Pressable
                key={r}
                onPress={() => setSelected(selected === r ? null : r)}
                style={[styles.reasonChip, selected === r && styles.reasonChipActive]}
              >
                <Text
                  style={[
                    styles.reasonChipText,
                    selected === r && styles.reasonChipTextActive,
                  ]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Algo mais? (opcional)</Text>
          <TextInput
            value={customText}
            onChangeText={setCustomText}
            placeholder="conte em uma frase..."
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            multiline
            maxLength={300}
          />

          <View style={{ height: spacing.xl }} />
          <Button
            label={submitting ? 'Registrando…' : 'Adiar 15min com esse motivo'}
            onPress={submit}
            loading={submitting}
            disabled={!canSubmit || submitting}
          />
          <Pressable onPress={skipFeedback} disabled={submitting} style={styles.skipBtn}>
            <Text style={styles.skipText}>Pular e adiar mesmo assim</Text>
          </Pressable>
          {submitting && (
            <View style={styles.busyBox}>
              <ActivityIndicator color={colors.accent.gold} />
              <Text style={[typography.small, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                A Comentora está pensando no contra-argumento…
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  reasonsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  reasonChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  reasonChipActive: {
    backgroundColor: colors.accent.gold,
    borderColor: colors.accent.gold,
  },
  reasonChipText: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  reasonChipTextActive: {
    color: colors.text.onGold,
  },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  input: {
    ...typography.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  skipText: {
    ...typography.small,
    color: colors.text.secondary,
  },
  busyBox: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
});
