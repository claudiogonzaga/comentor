import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { deleteApiKey } from '../services/secureStore';
import { ensureSleepHabit } from '../services/coach';
import {
  ensureChannel,
  ensurePermissions,
  scheduleNightReminders,
} from '../services/notifications';
import { testApiKey } from '../services/gemini';
import {
  DEFAULT_SYSTEM_PROMPT,
  PROMPT_PLACEHOLDERS,
} from '../constants/promptTemplate';
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
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [showPlaceholders, setShowPlaceholders] = useState(false);

  useEffect(() => {
    if (config) {
      setBedtime(config.bedtime);
      setInterval(String(config.reminderIntervalMinutes));
      setName(config.name ?? '');
      setTone(config.tone);
      setModel(config.geminiModel);
      setSystemPrompt(config.systemPrompt);
    }
  }, [config]);

  const trimmedKey = apiKeyInput.trim();
  const hasStoredKey = !!config?.hasApiKey;
  const canSave = hasStoredKey || trimmedKey.length >= 20;

  const handleTestKey = async () => {
    if (!trimmedKey) {
      Alert.alert(
        'Sem chave para testar',
        'Cole uma chave no campo abaixo primeiro. Para testar a chave já salva, basta usar o app — qualquer falha aparece como modo "OFFLINE" no chat.',
      );
      return;
    }
    setTesting(true);
    setKeyError(null);
    const result = await testApiKey(trimmedKey, model);
    setTesting(false);
    if (result.ok) {
      setKeyStatus('ok');
    } else {
      setKeyStatus('error');
      setKeyError(result.error ?? 'erro desconhecido');
    }
  };

  const resetPrompt = () => {
    Alert.alert(
      'Restaurar prompt padrão?',
      'Suas alterações no prompt serão perdidas. Confirme.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          style: 'destructive',
          onPress: () => setSystemPrompt(DEFAULT_SYSTEM_PROMPT),
        },
      ],
    );
  };

  const save = async () => {
    if (!canSave) {
      Alert.alert(
        'Chave de API obrigatória',
        'A Corujinha precisa de uma chave do Google AI Studio para funcionar. Cole a sua no campo abaixo.',
      );
      return;
    }

    setSaving(true);
    try {
      if (trimmedKey) {
        if (keyStatus !== 'ok') {
          const result = await testApiKey(trimmedKey, model);
          if (!result.ok) {
            setKeyStatus('error');
            setKeyError(result.error ?? 'chave inválida');
            Alert.alert(
              'Chave inválida',
              `O Gemini não aceitou: ${result.error ?? 'erro desconhecido'}.`,
            );
            setSaving(false);
            return;
          }
          setKeyStatus('ok');
        }
        await setApiKey(trimmedKey);
        setApiKeyInput('');
      }

      const intervalNum = Math.max(5, Math.min(60, parseInt(interval, 10) || 10));
      const finalPrompt = systemPrompt.trim().length > 0 ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
      await setConfig({
        bedtime,
        reminderIntervalMinutes: intervalNum,
        name: name.trim() || null,
        tone,
        geminiModel: model,
        systemPrompt: finalPrompt,
      });
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
    Alert.alert(
      'Remover chave de API?',
      'A Corujinha precisa da chave para conversar contigo. Sem ela, o app fica em modo offline (mensagens pré-escritas). Você terá que cadastrar uma nova depois.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover mesmo assim',
          style: 'destructive',
          onPress: async () => {
            await deleteApiKey();
            await setConfig({ hasApiKey: false });
            await refreshConfig();
          },
        },
      ],
    );
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
          <Text style={styles.section}>
            Chave de API <Text style={styles.required}>*obrigatória</Text>
          </Text>
          {hasStoredKey ? (
            <View>
              <View style={styles.keyStatus}>
                <Text style={[typography.body, { color: colors.text.primary }]}>
                  ✓ Chave salva e criptografada
                </Text>
              </View>
              <Pressable onPress={removeKey}>
                <Text style={[typography.small, styles.dangerLink]}>
                  Remover chave
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={[typography.small, { color: colors.accent.danger, marginBottom: spacing.sm }]}>
              Nenhuma chave cadastrada. A Corujinha não conseguirá conversar até você cadastrar uma.
            </Text>
          )}
          <TextInput
            value={apiKeyInput}
            onChangeText={(v) => {
              setApiKeyInput(v);
              setKeyStatus('idle');
              setKeyError(null);
            }}
            placeholder={hasStoredKey ? 'cadastrar nova chave (substitui a atual)' : 'cole aqui sua chave'}
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            autoCapitalize="none"
            secureTextEntry
          />
          <View style={styles.keyHelpRow}>
            <Pressable
              onPress={handleTestKey}
              disabled={!trimmedKey || testing}
              style={[styles.testBtn, (!trimmedKey || testing) && { opacity: 0.5 }]}
            >
              {testing ? (
                <ActivityIndicator color={colors.accent.gold} size="small" />
              ) : (
                <Text style={styles.testBtnText}>Testar chave</Text>
              )}
            </Pressable>
            {keyStatus === 'ok' && <Text style={styles.keyOk}>✓ válida</Text>}
            {keyStatus === 'error' && (
              <Text style={styles.keyErr} numberOfLines={2}>
                ✗ {keyError}
              </Text>
            )}
          </View>
          <Pressable onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
            <Text style={[typography.small, styles.linkHint]}>
              Obtenha sua chave grátis →
            </Text>
          </Pressable>
        </Card>

        <Card style={styles.card}>
          <View style={styles.promptHeader}>
            <Text style={styles.section}>Prompt da Corujinha</Text>
            <Pressable onPress={resetPrompt}>
              <Text style={[typography.small, styles.linkHint]}>Restaurar padrão</Text>
            </Pressable>
          </View>
          <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.sm }]}>
            Edite a personalidade e regras da IA. Use os placeholders abaixo no formato {'{nome}'} —
            eles são substituídos a cada chamada com dados reais.
          </Text>
          <Pressable
            onPress={() => setShowPlaceholders((v) => !v)}
            style={styles.placeholdersToggle}
          >
            <Text style={[typography.small, { color: colors.accent.gold }]}>
              {showPlaceholders ? '▼' : '▶'} Placeholders disponíveis
            </Text>
          </Pressable>
          {showPlaceholders && (
            <View style={styles.placeholdersList}>
              {PROMPT_PLACEHOLDERS.map((p) => (
                <View key={p.key} style={styles.placeholderRow}>
                  <Text style={styles.placeholderKey}>{p.key}</Text>
                  <Text style={styles.placeholderDesc}>{p.desc}</Text>
                </View>
              ))}
            </View>
          )}
          <TextInput
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.promptInput]}
            placeholder="Prompt da Corujinha…"
            placeholderTextColor={colors.text.tertiary}
          />
          <Text style={[typography.small, { color: colors.text.tertiary, marginTop: spacing.xs }]}>
            {systemPrompt.length} caracteres
          </Text>
        </Card>

        <View style={{ height: spacing.md }} />
        <Button label="Salvar" onPress={save} loading={saving} disabled={!canSave} />
        {!canSave && (
          <Text style={styles.requiredNote}>
            Cadastre uma chave de API para poder salvar.
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
  dangerLink: {
    color: colors.accent.danger,
    marginBottom: spacing.sm,
  },
  required: {
    ...typography.small,
    color: colors.accent.warning,
  },
  requiredNote: {
    ...typography.small,
    color: colors.accent.warning,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  keyHelpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  testBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    minHeight: 36,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtnText: {
    ...typography.small,
    color: colors.accent.gold,
  },
  keyOk: {
    ...typography.small,
    color: colors.accent.success,
    flexShrink: 1,
  },
  keyErr: {
    ...typography.small,
    color: colors.accent.danger,
    flexShrink: 1,
    flex: 1,
  },
  promptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  promptInput: {
    minHeight: 280,
    paddingTop: spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  placeholdersToggle: {
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  placeholdersList: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  placeholderRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  placeholderKey: {
    ...typography.small,
    color: colors.accent.gold,
    minWidth: 140,
    fontFamily: 'monospace',
  },
  placeholderDesc: {
    ...typography.small,
    color: colors.text.secondary,
    flex: 1,
  },
});
