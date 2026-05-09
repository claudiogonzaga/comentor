import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import type { Tone } from '../types';
import { useAppStore } from '../store/useAppStore';
import { ensureSleepHabit } from '../services/coach';
import { ensureChannel, ensurePermissions, scheduleNightReminders } from '../services/notifications';

const STEPS = [
  {
    title: 'Olá! Eu sou a Corujinha.',
    subtitle: 'Sua co-mentora de sabedoria.',
    paragraph: 'Vou te ajudar a dormir melhor, ler mais e se mover.',
    cta: 'Me conta mais',
    mood: 'calm' as const,
  },
  {
    title: 'Não sou um alarme.',
    subtitle: 'Sou uma mentora.',
    paragraph: 'Eu argumento, convenço e te lembro por que você começou.',
    cta: 'Gostei',
    mood: 'serious' as const,
  },
  {
    title: 'Uso ciência. E carinho.',
    subtitle: 'Quanto mais você me ignora, mais criativa eu fico.',
    paragraph: 'Mas sempre do seu lado — nunca contra você.',
    cta: 'Vamos começar',
    mood: 'celebrating' as const,
  },
];

const TONE_OPTIONS: { value: Tone; label: string; emoji: string; desc: string }[] = [
  { value: 'gentle', label: 'Gentil', emoji: '🤗', desc: 'leve, acolhedora' },
  { value: 'firm', label: 'Firme', emoji: '💪', desc: 'direta, com dados' },
  { value: 'brutal', label: 'Brutalmente honesta', emoji: '🔥', desc: 'sem panos quentes' },
];

export function OnboardingScreen() {
  const navigation = useNavigation<any>();
  const { setConfig, setApiKey } = useAppStore();
  const [step, setStep] = useState(0);
  const [bedtime, setBedtime] = useState('23:00');
  const [interval, setInterval] = useState('10');
  const [tone, setTone] = useState<Tone>('firm');
  const [name, setName] = useState('');
  const [apiKey, setApiKeyLocal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isIntro = step < STEPS.length;

  const finalize = async () => {
    setSubmitting(true);
    try {
      const intervalNum = Math.max(5, Math.min(60, parseInt(interval, 10) || 10));
      await setConfig({
        name: name.trim() || null,
        bedtime,
        reminderIntervalMinutes: intervalNum,
        tone,
        onboardingDone: true,
      });
      if (apiKey.trim()) {
        await setApiKey(apiKey.trim());
      }
      const habit = await ensureSleepHabit(bedtime);
      const granted = await ensurePermissions();
      if (granted) {
        await ensureChannel();
        await scheduleNightReminders({
          bedtime,
          intervalMinutes: intervalNum,
          maxReminders: 12,
          habitId: habit.id,
        });
      }
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } finally {
      setSubmitting(false);
    }
  };

  if (isIntro) {
    const s = STEPS[step];
    return (
      <ScreenContainer>
        <View style={styles.introWrap}>
          <View style={styles.owlWrap}>
            <Owl mood={s.mood} size={200} />
          </View>
          <Text style={[typography.hero, styles.title]}>{s.title}</Text>
          <Text style={[typography.subtitle, styles.subtitle]}>{s.subtitle}</Text>
          <Text style={[typography.body, styles.paragraph]}>{s.paragraph}</Text>
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === step && styles.dotActive]}
              />
            ))}
          </View>
          <Button label={`${s.cta} →`} onPress={() => setStep(step + 1)} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.formScroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.formHeader}>
            <Owl mood="calm" size={120} />
            <Text style={[typography.title, styles.title]}>Vamos te configurar</Text>
            <Text style={[typography.body, styles.subtitleSmall]}>
              Tudo isso pode ser ajustado depois.
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Como te chamo? (opcional)</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Seu nome ou apelido"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Que horas você quer dormir?</Text>
            <TextInput
              value={bedtime}
              onChangeText={(v) => setBedtime(v.replace(/[^0-9:]/g, '').slice(0, 5))}
              placeholder="23:00"
              placeholderTextColor={colors.text.tertiary}
              style={[styles.input, styles.inputTime]}
              keyboardType="numbers-and-punctuation"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>A cada quantos minutos te lembro?</Text>
            <TextInput
              value={interval}
              onChangeText={(v) => setInterval(v.replace(/[^0-9]/g, '').slice(0, 2))}
              placeholder="10"
              placeholderTextColor={colors.text.tertiary}
              style={[styles.input, styles.inputTime]}
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>Mínimo 5, máximo 60 minutos.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Como quer que eu fale?</Text>
            {TONE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => setTone(opt.value)}
                style={[
                  styles.toneRow,
                  tone === opt.value && styles.toneRowActive,
                ]}
              >
                <Text style={styles.toneEmoji}>{opt.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toneLabel}>{opt.label}</Text>
                  <Text style={styles.toneDesc}>{opt.desc}</Text>
                </View>
                <View style={[styles.radio, tone === opt.value && styles.radioActive]} />
              </Pressable>
            ))}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Chave de API do Google AI Studio</Text>
            <TextInput
              value={apiKey}
              onChangeText={setApiKeyLocal}
              placeholder="cole aqui (opcional, mas recomendado)"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
              autoCapitalize="none"
              secureTextEntry
            />
            <Pressable onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
              <Text style={styles.linkHint}>
                Obtenha uma gratuita em aistudio.google.com →
              </Text>
            </Pressable>
          </View>

          <View style={{ height: spacing.md }} />
          <Button
            label="Ativar CoMentor 🦉"
            onPress={finalize}
            loading={submitting}
          />
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  introWrap: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  owlWrap: {
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.accent.gold,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  subtitleSmall: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  paragraph: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text.tertiary,
  },
  dotActive: {
    backgroundColor: colors.accent.gold,
    width: 24,
  },
  formScroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  formHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  field: {
    marginBottom: spacing.xl,
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
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputTime: {
    fontSize: 22,
    textAlign: 'center',
    fontFamily: typography.title.fontFamily,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
  },
  linkHint: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: spacing.xs,
  },
  toneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  toneRowActive: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.1)',
  },
  toneEmoji: { fontSize: 28 },
  toneLabel: { ...typography.bodyMedium, color: colors.text.primary },
  toneDesc: { ...typography.small, color: colors.text.secondary },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.text.tertiary,
  },
  radioActive: {
    borderColor: colors.accent.gold,
    backgroundColor: colors.accent.gold,
  },
});
