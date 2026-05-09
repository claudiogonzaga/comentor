import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { deleteApiKey, getApiKey } from '../services/secureStore';
import { ensureSleepHabit } from '../services/coach';
import {
  cancelAllReminders,
  ensureChannel,
  ensurePermissions,
  scheduleNightReminders,
} from '../services/notifications';
import type { GeminiModel, Tone } from '../types';

const TONES: { value: Tone; label: string }[] = [
  { value: 'gentle', label: 'Gentil 🤗' },
  { value: 'firm', label: 'Firme 💪' },
  { value: 'brutal', label: 'Brutal 🔥' },
];

const MODELS: { value: GeminiModel; label: string; sub: string }[] = [
  { value: 'gemini-2.0-flash-lite', label: 'Flash Lite', sub: 'mais barato e rápido' },
  { value: 'gemini-2.0-flash', label: 'Flash', sub: 'melhor argumentação' },
];

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig, setApiKey, refreshConfig } = useAppStore();

  const [bedtime, setBedtime] = useState(config?.bedtime ?? '23:00');
  const [interval, setInterval] = useState(String(config?.reminderIntervalMinutes ?? 10));
  const [name, setName] = useState(config?.name ?? '');
  const [tone, setTone] = useState<Tone>(config?.tone ?? 'firm');
  const [model, setModel] = useState<GeminiModel>(config?.geminiModel ?? 'gemini-2.0-flash-lite');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setBedtime(config.bedtime);
      setInterval(String(config.reminderIntervalMinutes));
      setName(config.name ?? '');
      setTone(config.tone);
      setModel(config.geminiModel);
    }
  }, [config]);

  const save = async () => {
    setSaving(true);
    try {
      const intervalNum = Math.max(5, Math.min(60, parseInt(interval, 10) || 10));
      await setConfig({
        bedtime,
        reminderIntervalMinutes: intervalNum,
        name: name.trim() || null,
        tone,
        geminiModel: model,
      });
      if (apiKeyInput.trim()) {
        await setApiKey(apiKeyInput.trim());
        setApiKeyInput('');
      }
      const habit = await ensureSleepHabit(bedtime);
      if (await ensurePermissions()) {
        await ensureChannel();
        await scheduleNightReminders({
          bedtime,
          intervalMinutes: intervalNum,
          maxReminders: 12,
          habitId: habit.id,
        });
      }
      Alert.alert('Salvo', 'Suas preferências foram atualizadas.');
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    Alert.alert('Remover chave de API?', 'Você ficará sem mensagens da IA até cadastrar outra.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          await deleteApiKey();
          await setConfig({ hasApiKey: false });
          await refreshConfig();
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Configurações</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <Text style={styles.section}>Sono</Text>

          <Text style={styles.label}>Como te chamo</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Seu nome (opcional)"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
          />

          <Text style={styles.label}>Horário de dormir</Text>
          <TextInput
            value={bedtime}
            onChangeText={(v) => setBedtime(v.replace(/[^0-9:]/g, '').slice(0, 5))}
            style={[styles.input, styles.inputCenter]}
            keyboardType="numbers-and-punctuation"
          />

          <Text style={styles.label}>Intervalo entre lembretes (min)</Text>
          <TextInput
            value={interval}
            onChangeText={(v) => setInterval(v.replace(/[^0-9]/g, '').slice(0, 2))}
            style={[styles.input, styles.inputCenter]}
            keyboardType="number-pad"
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.section}>Tom da Corujinha</Text>
          <View style={styles.row}>
            {TONES.map((t) => (
              <Pressable
                key={t.value}
                onPress={() => setTone(t.value)}
                style={[styles.chip, tone === t.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, tone === t.value && styles.chipTextActive]}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.section}>Modelo de IA</Text>
          {MODELS.map((m) => (
            <Pressable
              key={m.value}
              onPress={() => setModel(m.value)}
              style={[styles.modelRow, model === m.value && styles.modelRowActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                  {m.label}
                </Text>
                <Text style={[typography.small, { color: colors.text.secondary }]}>{m.sub}</Text>
              </View>
              <View style={[styles.radio, model === m.value && styles.radioActive]} />
            </Pressable>
          ))}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.section}>Chave de API (Google AI Studio)</Text>
          {config?.hasApiKey ? (
            <View>
              <View style={styles.keyStatus}>
                <Text style={[typography.body, { color: colors.text.primary }]}>
                  ✓ Chave salva e criptografada
                </Text>
              </View>
              <Text
                style={[typography.small, styles.linkHint]}
                onPress={removeKey}
              >
                Remover chave
              </Text>
            </View>
          ) : (
            <Text style={[typography.small, { color: colors.accent.warning, marginBottom: spacing.sm }]}>
              Sem chave: a Corujinha usa mensagens pré-escritas (modo offline).
            </Text>
          )}
          <TextInput
            value={apiKeyInput}
            onChangeText={setApiKeyInput}
            placeholder={config?.hasApiKey ? 'cadastrar nova chave (substitui a atual)' : 'cole aqui sua chave'}
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            autoCapitalize="none"
            secureTextEntry
          />
          <Pressable onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
            <Text style={[typography.small, styles.linkHint]}>
              Obtenha sua chave →
            </Text>
          </Pressable>
        </Card>

        <View style={{ height: spacing.md }} />
        <Button label="Salvar" onPress={save} loading={saving} />
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
  card: {
    marginBottom: spacing.lg,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
  inputCenter: {
    textAlign: 'center',
    fontSize: 18,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  chipActive: {
    backgroundColor: colors.accent.gold,
    borderColor: colors.accent.gold,
  },
  chipText: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  chipTextActive: {
    color: colors.text.onGold,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  modelRowActive: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
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
  keyStatus: {
    backgroundColor: 'rgba(125,211,168,0.1)',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  linkHint: {
    color: colors.accent.gold,
    marginTop: spacing.xs,
  },
});
