import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { GreekIcon } from '../components/GreekIcon';
import { VoiceProviderCard } from '../components/VoiceProviderCard';
import { VoicePicker } from '../components/VoicePicker';
import type { EnrichedVoice } from '../services/voice';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { deleteApiKey } from '../services/secureStore';
import { testApiKey } from '../services/gemini';
import {
  deleteDownloadedModel,
  getDownloadedModelSize,
  isModelDownloaded,
} from '../services/modelDownload';
import { releaseModel } from '../services/localModel';
import { LOCAL_MODEL_LIST, formatModelSize } from '../constants/models';
import { DEFAULT_SYSTEM_PROMPT, PROMPT_PLACEHOLDERS } from '../constants/promptTemplate';
import type { AIBackend, GeminiModel, LocalModelId } from '../types';

const MODELS: { value: GeminiModel; label: string; sub: string }[] = [
  { value: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite', sub: 'novo, mais econômico (default)' },
  { value: 'gemini-3.1-flash', label: '3.1 Flash', sub: 'novo, melhor argumentação' },
  { value: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite', sub: 'estável, barato' },
  { value: 'gemini-2.5-flash', label: '2.5 Flash', sub: 'estável, mais inteligente' },
  { value: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite', sub: 'fallback antigo' },
  { value: 'gemini-2.0-flash', label: '2.0 Flash', sub: 'fallback antigo' },
];

/**
 * "Cérebro e Voz da Comentora" — reúne o que define COMO a Comentora pensa e
 * fala: a voz (provedor sistema/Gemini + voz do sistema), a inteligência
 * (API Gemini ou modelo local) e o prompt. Veio de Configurações.
 */
export function BrainVoiceScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig, setApiKey, refreshConfig } = useAppStore();

  const [model, setModel] = useState<GeminiModel>(config?.geminiModel ?? 'gemini-3.1-flash-lite');
  const [aiBackend, setAIBackend] = useState<AIBackend>(config?.aiBackend ?? 'remote');
  const [localModelId, setLocalModelId] = useState<LocalModelId>(
    (config?.localModelId as LocalModelId | null) ?? LOCAL_MODEL_LIST[0].id,
  );
  const [allowMobileData, setAllowMobileData] = useState(config?.allowMobileDataDownload ?? false);
  const [downloadedSizes, setDownloadedSizes] = useState<Record<string, number>>({});
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  useEffect(() => {
    if (config) {
      setModel(config.geminiModel);
      setSystemPrompt(config.systemPrompt);
      setAIBackend(config.aiBackend);
      setLocalModelId((config.localModelId as LocalModelId | null) ?? LOCAL_MODEL_LIST[0].id);
      setAllowMobileData(config.allowMobileDataDownload);
    }
  }, [config]);

  const refreshLocalModelStatus = async () => {
    const sizes: Record<string, number> = {};
    for (const m of LOCAL_MODEL_LIST) {
      sizes[m.id] = (await isModelDownloaded(m.id)) ? await getDownloadedModelSize(m.id) : 0;
    }
    setDownloadedSizes(sizes);
  };

  useEffect(() => {
    void refreshLocalModelStatus();
  }, []);

  const trimmedKey = apiKeyInput.trim();
  const hasStoredKey = !!config?.hasApiKey;
  const localCurrentDownloaded = !!config?.localModelDownloaded && !!config?.localModelId;
  const canSave =
    (aiBackend === 'remote' && (hasStoredKey || trimmedKey.length >= 20)) ||
    (aiBackend === 'local' && localCurrentDownloaded);

  const handleTestKey = async () => {
    if (!trimmedKey) {
      Alert.alert('Sem chave para testar', 'Cole uma chave no campo abaixo primeiro.');
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

  const handleDownloadModel = async (id: LocalModelId) => {
    await setConfig({
      localModelId: id,
      localModelDownloaded: false,
      allowMobileDataDownload: allowMobileData,
    });
    navigation.navigate('ModelDownload', { modelId: id, fromOnboarding: false });
  };

  const handleDeleteModel = (id: LocalModelId) => {
    const m = LOCAL_MODEL_LIST.find((x) => x.id === id);
    if (!m) return;
    Alert.alert(
      `Deletar ${m.label}?`,
      `Vai liberar ~${formatModelSize(m.sizeBytes)} no celular. Você pode baixar de novo a qualquer momento.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deletar',
          style: 'destructive',
          onPress: async () => {
            await releaseModel();
            await deleteDownloadedModel(id);
            if (config?.localModelId === id) {
              await setConfig({ localModelDownloaded: false });
            }
            await refreshLocalModelStatus();
            await refreshConfig();
          },
        },
      ],
    );
  };

  const removeKey = async () => {
    Alert.alert(
      'Remover chave de API?',
      'Sem ela, o app fica em modo offline (mensagens pré-escritas) ou você precisa trocar para um modelo local.',
      [
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
      ],
    );
  };

  const resetPrompt = () => {
    Alert.alert('Restaurar prompt padrão?', 'Suas alterações no prompt serão perdidas. Confirme.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Restaurar',
        style: 'destructive',
        onPress: () => setSystemPrompt(DEFAULT_SYSTEM_PROMPT),
      },
    ]);
  };

  const save = async () => {
    if (!canSave) {
      const msg =
        aiBackend === 'remote'
          ? 'Cadastre uma chave de API válida para salvar.'
          : 'Baixe um modelo local para usar essa modalidade.';
      Alert.alert('Configuração incompleta', msg);
      return;
    }
    setSaving(true);
    try {
      if (aiBackend === 'remote' && trimmedKey) {
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
      const finalPrompt = systemPrompt.trim().length > 0 ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
      await setConfig({
        geminiModel: model,
        systemPrompt: finalPrompt,
        aiBackend,
        localModelId: aiBackend === 'local' ? localModelId : config?.localModelId ?? null,
        allowMobileDataDownload: allowMobileData,
      });
      Alert.alert('Salvo', 'Suas preferências foram atualizadas.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>
          Cérebro e Voz
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.md }]}>
          A voz com que a Comentora fala, a inteligência que ela usa para pensar
          e o prompt com a personalidade dela.
        </Text>

        {/* ——— Voz da Comentora ——— */}
        <VoiceProviderCard
          provider={config?.voiceProvider ?? 'system'}
          geminiVoiceName={config?.geminiVoiceName ?? 'Aoede'}
          hasApiKey={!!config?.hasApiKey}
          onProviderChange={async (p) => {
            await setConfig({ voiceProvider: p });
          }}
          onGeminiVoiceChange={async (name) => {
            await setConfig({ geminiVoiceName: name });
          }}
        />

        {(config?.voiceProvider ?? 'system') === 'system' ? (
          <VoicePicker
            value={config?.voiceId ?? null}
            onChange={async (v: EnrichedVoice | null) => {
              await setConfig({
                voiceId: v?.identifier ?? null,
                voiceLanguage: v?.language ?? null,
              });
            }}
          />
        ) : null}

        {/* ——— Inteligência ——— */}
        <Card style={styles.card}>
          <Text style={styles.section}>Inteligência</Text>
          <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.md }]}>
            Escolha entre API do Gemini (mais rápida, precisa de chave) ou modelo rodando direto no celular (privado, sem cota).
          </Text>

          <View style={styles.backendRow}>
            <Pressable
              onPress={() => setAIBackend('remote')}
              style={[styles.backendChip, aiBackend === 'remote' && styles.backendChipActive]}
            >
              <View style={styles.backendIcon}>
                <GreekIcon name="cloud" size={22} />
              </View>
              <Text style={[
                styles.backendLabel,
                aiBackend === 'remote' && styles.backendLabelActive,
              ]}>API</Text>
            </Pressable>
            <Pressable
              onPress={() => setAIBackend('local')}
              style={[styles.backendChip, aiBackend === 'local' && styles.backendChipActive]}
            >
              <View style={styles.backendIcon}>
                <GreekIcon name="phone" size={22} />
              </View>
              <Text style={[
                styles.backendLabel,
                aiBackend === 'local' && styles.backendLabelActive,
              ]}>No celular</Text>
            </Pressable>
          </View>

          {aiBackend === 'remote' && (
            <View style={styles.subPanel}>
              <Text style={styles.label}>Modelo Gemini</Text>
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

              <Text style={[styles.label, { marginTop: spacing.lg }]}>Chave de API</Text>
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
                  Nenhuma chave cadastrada.
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
            </View>
          )}

          {aiBackend === 'local' && (
            <View style={styles.subPanel}>
              <Text style={styles.label}>Modelo no celular</Text>
              {LOCAL_MODEL_LIST.map((m) => {
                const isSelected = localModelId === m.id;
                const downloadedSize = downloadedSizes[m.id] ?? 0;
                const isDownloaded = downloadedSize > 0;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.localModelCard,
                      isSelected && styles.localModelCardActive,
                    ]}
                  >
                    <Pressable
                      onPress={() => setLocalModelId(m.id)}
                      style={styles.localModelRow}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.modelTitleRow}>
                          <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                            {m.label}
                          </Text>
                          {m.hasThinking && (
                            <View style={styles.thinkingBadge}>
                              <GreekIcon name="brain" size={12} color={colors.accent.lavender} />
                              <Text style={styles.thinkingBadgeText}>thinking</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[typography.small, { color: colors.accent.gold, marginTop: 2 }]}>
                          {m.vendor} · {formatModelSize(m.sizeBytes)}
                          {isDownloaded ? '  ✓ baixado' : '  · não baixado'}
                        </Text>
                        <Text style={[typography.small, { color: colors.text.secondary, marginTop: 4 }]}>
                          {m.description}
                        </Text>
                      </View>
                      <View style={[styles.radio, isSelected && styles.radioActive]} />
                    </Pressable>
                    <View style={styles.localModelActions}>
                      {isDownloaded ? (
                        <Pressable
                          onPress={() => handleDeleteModel(m.id)}
                          style={styles.deleteBtn}
                          hitSlop={8}
                        >
                          <GreekIcon name="trash" size={14} color={colors.accent.danger} />
                          <Text style={styles.deleteBtnText}>Deletar</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => handleDownloadModel(m.id)}
                          style={styles.downloadBtn}
                          hitSlop={8}
                        >
                          <GreekIcon name="download" size={14} color={colors.accent.gold} />
                          <Text style={styles.downloadBtnText}>Baixar</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                    Permitir download via dados móveis
                  </Text>
                  <Text style={[typography.small, { color: colors.text.secondary }]}>
                    Por padrão só baixa em Wi-Fi (recomendado)
                  </Text>
                </View>
                <Switch
                  value={allowMobileData}
                  onValueChange={setAllowMobileData}
                  trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                  thumbColor={allowMobileData ? colors.text.onGold : colors.text.tertiary}
                />
              </View>

              {!localCurrentDownloaded && aiBackend === 'local' && (
                <Text style={[typography.small, { color: colors.accent.warning, marginTop: spacing.sm }]}>
                  Você precisa baixar o modelo selecionado antes de salvar.
                </Text>
              )}
            </View>
          )}
        </Card>

        {/* ——— Prompt ——— */}
        <Card style={styles.card}>
          <View style={styles.promptHeader}>
            <Text style={styles.section}>Prompt da Comentora</Text>
            <Pressable
              onPress={() => setPromptExpanded((v) => !v)}
              style={styles.promptToggleBtn}
            >
              <Text style={styles.promptToggleText}>
                {promptExpanded ? 'Recolher ▲' : 'Editar prompt ▼'}
              </Text>
            </Pressable>
          </View>
          {!promptExpanded ? (
            <Text style={[typography.small, { color: colors.text.secondary }]}>
              {systemPrompt.length} caracteres. As regras e a personalidade do
              Comentora estão escondidas pra não tomar espaço. Toque em
              &quot;Editar prompt&quot; pra ler ou alterar.
            </Text>
          ) : (
            <>
              <View style={styles.promptHeaderActions}>
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
                placeholder="Prompt da Comentora…"
                placeholderTextColor={colors.text.tertiary}
              />
              <Text style={[typography.small, { color: colors.text.tertiary, marginTop: spacing.xs }]}>
                {systemPrompt.length} caracteres
              </Text>
            </>
          )}
        </Card>

        <View style={{ height: spacing.md }} />
        <Button label="Salvar" onPress={save} loading={saving} disabled={!canSave} />
        {!canSave && (
          <Text style={styles.requiredNote}>
            {aiBackend === 'remote'
              ? 'Cadastre uma chave de API válida para salvar.'
              : 'Baixe o modelo local selecionado para salvar.'}
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
  backendRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  backendChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
    gap: spacing.sm,
  },
  backendChipActive: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.1)',
  },
  backendIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backendLabel: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
  backendLabelActive: {
    color: colors.accent.gold,
  },
  subPanel: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
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
  localModelCard: {
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  localModelCardActive: {
    borderColor: colors.accent.gold,
  },
  localModelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    gap: spacing.md,
  },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  localModelActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.danger,
  },
  deleteBtnText: {
    ...typography.small,
    color: colors.accent.danger,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  downloadBtnText: {
    ...typography.small,
    color: colors.accent.gold,
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
  promptHeaderActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.xs,
  },
  promptToggleBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  promptToggleText: {
    ...typography.small,
    color: colors.accent.gold,
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
});
