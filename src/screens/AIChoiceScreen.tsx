import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { GreekIcon } from '../components/GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import type { AIBackend, LocalModelId } from '../types';
import { LOCAL_MODEL_LIST, formatModelSize } from '../constants/models';
import { useAppStore } from '../store/useAppStore';
import { testApiKey } from '../services/gemini';

export function AIChoiceScreen() {
  const navigation = useNavigation<any>();
  const { setConfig, setApiKey } = useAppStore();
  const [backend, setBackend] = useState<AIBackend | null>(null);
  const [apiKey, setApiKeyLocal] = useState('');
  const [keyStatus, setKeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedModel, setSelectedModel] = useState<LocalModelId>(
    LOCAL_MODEL_LIST[0].id,
  );
  const [allowMobileData, setAllowMobileData] = useState(false);

  const trimmedKey = apiKey.trim();

  const handleTestKey = async () => {
    if (!trimmedKey) return;
    setTesting(true);
    setKeyError(null);
    const result = await testApiKey(trimmedKey);
    setTesting(false);
    if (result.ok) {
      setKeyStatus('ok');
    } else {
      setKeyStatus('error');
      setKeyError(result.error ?? 'erro desconhecido');
    }
  };

  const submitRemote = async () => {
    if (!trimmedKey) {
      Alert.alert('Chave de API obrigatória', 'Cole a chave do Google AI Studio para continuar.');
      return;
    }
    setSubmitting(true);
    try {
      if (keyStatus !== 'ok') {
        const result = await testApiKey(trimmedKey);
        if (!result.ok) {
          setKeyStatus('error');
          setKeyError(result.error ?? 'chave inválida');
          Alert.alert(
            'Chave inválida',
            `O Gemini não aceitou essa chave: ${result.error ?? 'erro desconhecido'}.`,
          );
          setSubmitting(false);
          return;
        }
        setKeyStatus('ok');
      }
      await setConfig({ aiBackend: 'remote', localModelId: null, localModelDownloaded: false });
      await setApiKey(trimmedKey);
      navigation.navigate('Interview', { mode: 'onboarding' });
    } finally {
      setSubmitting(false);
    }
  };

  const submitLocal = async () => {
    setSubmitting(true);
    try {
      await setConfig({
        aiBackend: 'local',
        localModelId: selectedModel,
        localModelDownloaded: false,
        allowMobileDataDownload: allowMobileData,
      });
      navigation.navigate('ModelDownload', {
        modelId: selectedModel,
        fromOnboarding: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Owl mood="serious" size={120} />
            <Text style={[typography.title, styles.title]}>Como você quer usar?</Text>
            <Text style={[typography.body, styles.subtitle]}>
              Escolha como a Comentora vai pensar.
            </Text>
          </View>

          <Pressable
            onPress={() => setBackend('remote')}
            style={[styles.optionCard, backend === 'remote' && styles.optionCardActive]}
          >
            <View style={styles.optionHeader}>
              <View style={styles.optionIcon}>
                <GreekIcon name="cloud" size={28} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Usar API do Gemini</Text>
                <Text style={styles.optionDesc}>
                  Mais rápida e inteligente. Precisa de uma chave gratuita do Google AI Studio.
                </Text>
              </View>
              <View style={[styles.radio, backend === 'remote' && styles.radioActive]} />
            </View>
            <Text style={styles.optionMeta}>
              ✓ Resposta em ~1-2s   ✓ Sem download   ⚠ Cota gratuita limitada
            </Text>
          </Pressable>

          {backend === 'remote' && (
            <View style={styles.subPanel}>
              <Text style={styles.label}>Cole sua chave</Text>
              <TextInput
                value={apiKey}
                onChangeText={(v) => {
                  setApiKeyLocal(v);
                  setKeyStatus('idle');
                  setKeyError(null);
                }}
                placeholder="cole aqui sua chave"
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
                {keyStatus === 'ok' && <Text style={styles.keyOk}>✓ Chave válida</Text>}
                {keyStatus === 'error' && (
                  <Text style={styles.keyErr} numberOfLines={2}>
                    ✗ {keyError}
                  </Text>
                )}
              </View>

              <Pressable onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
                <Text style={styles.linkHint}>
                  Obtenha uma gratuita em aistudio.google.com →
                </Text>
              </Pressable>
            </View>
          )}

          <Pressable
            onPress={() => setBackend('local')}
            style={[styles.optionCard, backend === 'local' && styles.optionCardActive]}
          >
            <View style={styles.optionHeader}>
              <View style={styles.optionIcon}>
                <GreekIcon name="phone" size={28} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Usar modelo no celular</Text>
                <Text style={styles.optionDesc}>
                  Sem chave, sem internet recorrente, sem cota. O modelo roda direto no aparelho.
                </Text>
              </View>
              <View style={[styles.radio, backend === 'local' && styles.radioActive]} />
            </View>
            <Text style={styles.optionMeta}>
              ✓ 100% privado   ⚠ Download de 2.5–5 GB   ⚠ ~3 GB de RAM em uso
            </Text>
          </Pressable>

          {backend === 'local' && (
            <View style={styles.subPanel}>
              <Text style={styles.label}>Escolha o modelo</Text>
              {LOCAL_MODEL_LIST.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setSelectedModel(m.id)}
                  style={[
                    styles.modelRow,
                    selectedModel === m.id && styles.modelRowActive,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.modelTitleRow}>
                      <Text style={styles.modelLabel}>{m.label}</Text>
                      {m.hasThinking && (
                        <View style={styles.thinkingBadge}>
                          <GreekIcon name="brain" size={12} color={colors.accent.lavender} />
                          <Text style={styles.thinkingBadgeText}>thinking</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.modelVendor}>{m.vendor} · {formatModelSize(m.sizeBytes)}</Text>
                    <Text style={styles.modelDesc}>{m.description}</Text>
                  </View>
                  <View style={[styles.radio, selectedModel === m.id && styles.radioActive]} />
                </Pressable>
              ))}

              <Pressable
                onPress={() => setAllowMobileData((v) => !v)}
                style={[styles.toggleRow, allowMobileData && styles.toggleRowActive]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Permitir download via dados móveis</Text>
                  <Text style={styles.toggleDesc}>
                    {allowMobileData
                      ? 'Vai usar 4G/5G se Wi-Fi não estiver disponível.'
                      : 'Apenas Wi-Fi (recomendado para evitar consumo do plano).'}
                  </Text>
                </View>
                <View style={[styles.checkbox, allowMobileData && styles.checkboxActive]}>
                  {allowMobileData && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </Pressable>

              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>⚠ O que você precisa saber</Text>
                <Text style={styles.warningItem}>• O download leva alguns minutos em Wi-Fi</Text>
                <Text style={styles.warningItem}>• Modelo ocupa espaço permanente no celular</Text>
                <Text style={styles.warningItem}>• Respostas levam 5–10s em vez de 1–2s</Text>
                <Text style={styles.warningItem}>• Pode trocar pra API depois em Configurações</Text>
              </View>
            </View>
          )}

          <View style={{ height: spacing.lg }} />
          {backend === 'remote' && (
            <Button
              label="Ativar com Gemini"
              onPress={submitRemote}
              loading={submitting}
              disabled={!trimmedKey || submitting}
            />
          )}
          {backend === 'local' && (
            <Button
              label="Baixar modelo e continuar →"
              onPress={submitLocal}
              loading={submitting}
            />
          )}
          {!backend && (
            <Text style={styles.hintCenter}>Escolha uma opção acima para continuar.</Text>
          )}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.text.secondary,
    textAlign: 'center',
  },
  optionCard: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionCardActive: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  optionIcon: {
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  optionDesc: {
    ...typography.small,
    color: colors.text.secondary,
  },
  optionMeta: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
  },
  subPanel: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
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
  linkHint: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: spacing.sm,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  modelRowActive: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.1)',
  },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modelLabel: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  modelVendor: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: 2,
  },
  modelDesc: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 4,
  },
  thinkingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(167,139,250,0.2)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  thinkingBadgeText: {
    ...typography.small,
    color: colors.accent.lavender,
    fontSize: 11,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  toggleRowActive: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
  toggleLabel: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  toggleDesc: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.text.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    borderColor: colors.accent.gold,
    backgroundColor: colors.accent.gold,
  },
  checkmark: {
    color: colors.text.onGold,
    fontWeight: '900',
    fontSize: 16,
  },
  warningBox: {
    backgroundColor: 'rgba(245,158,92,0.1)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(245,158,92,0.3)',
  },
  warningTitle: {
    ...typography.bodyMedium,
    color: colors.accent.warning,
    marginBottom: spacing.sm,
  },
  warningItem: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: 2,
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
  hintCenter: {
    ...typography.small,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
