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
import { TimePickerInput } from '../components/TimePickerInput';
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
  deleteAllDownloadedModels,
  deleteDownloadedModel,
  getDownloadedModelSize,
  isModelDownloaded,
} from '../services/modelDownload';
import { releaseModel } from '../services/localModel';
import { resetAllUserData } from '../services/database';
import {
  LOCAL_MODEL_LIST,
  formatModelSize,
} from '../constants/models';
import {
  DEFAULT_SYSTEM_PROMPT,
  PROMPT_PLACEHOLDERS,
} from '../constants/promptTemplate';
import { checkForUpdate, getCurrentVersion, type UpdateInfo } from '../services/updateChecker';
import type { AIBackend, GeminiModel, LocalModelId, Tone } from '../types';

const TONES: { value: Tone; label: string }[] = [
  { value: 'gentle', label: 'Gentil 🤗' },
  { value: 'firm', label: 'Firme 💪' },
  { value: 'brutal', label: 'Brutal 🔥' },
];

const MODELS: { value: GeminiModel; label: string; sub: string }[] = [
  { value: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite', sub: 'novo, mais econômico (default)' },
  { value: 'gemini-3.1-flash', label: '3.1 Flash', sub: 'novo, melhor argumentação' },
  { value: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite', sub: 'estável, barato' },
  { value: 'gemini-2.5-flash', label: '2.5 Flash', sub: 'estável, mais inteligente' },
  { value: 'gemini-2.0-flash-lite', label: '2.0 Flash Lite', sub: 'fallback antigo' },
  { value: 'gemini-2.0-flash', label: '2.0 Flash', sub: 'fallback antigo' },
];

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig, setApiKey, refreshConfig } = useAppStore();

  const [bedtime, setBedtime] = useState(config?.bedtime ?? '23:00');
  const [interval, setInterval] = useState(String(config?.reminderIntervalMinutes ?? 10));
  const [name, setName] = useState(config?.name ?? '');
  const [tone, setTone] = useState<Tone>(config?.tone ?? 'firm');
  const [model, setModel] = useState<GeminiModel>(config?.geminiModel ?? 'gemini-3.1-flash-lite');
  const [aiBackend, setAIBackend] = useState<AIBackend>(config?.aiBackend ?? 'remote');
  const [localModelId, setLocalModelId] = useState<LocalModelId>(
    (config?.localModelId as LocalModelId | null) ?? LOCAL_MODEL_LIST[0].id,
  );
  const [allowMobileData, setAllowMobileData] = useState(config?.allowMobileDataDownload ?? false);
  const [downloadedSizes, setDownloadedSizes] = useState<Record<string, number>>({});
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState(config?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
  const [prepEnabled, setPrepEnabled] = useState(config?.prepRemindersEnabled ?? true);
  const [voiceEnabled, setVoiceEnabled] = useState(config?.voiceModeEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (config) {
      setBedtime(config.bedtime);
      setInterval(String(config.reminderIntervalMinutes));
      setName(config.name ?? '');
      setTone(config.tone);
      setModel(config.geminiModel);
      setSystemPrompt(config.systemPrompt);
      setPrepEnabled(config.prepRemindersEnabled);
      setVoiceEnabled(config.voiceModeEnabled);
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
      Alert.alert(
        'Sem chave para testar',
        'Cole uma chave no campo abaixo primeiro.',
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
      const msg = aiBackend === 'remote'
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

      const intervalNum = Math.max(5, Math.min(60, parseInt(interval, 10) || 10));
      const finalPrompt = systemPrompt.trim().length > 0 ? systemPrompt : DEFAULT_SYSTEM_PROMPT;
      await setConfig({
        bedtime,
        reminderIntervalMinutes: intervalNum,
        name: name.trim() || null,
        tone,
        geminiModel: model,
        systemPrompt: finalPrompt,
        prepRemindersEnabled: prepEnabled,
        voiceModeEnabled: voiceEnabled,
        aiBackend,
        localModelId: aiBackend === 'local' ? localModelId : config?.localModelId ?? null,
        allowMobileDataDownload: allowMobileData,
      });
      const habit = await ensureSleepHabit(bedtime);
      if (await ensurePermissions()) {
        await ensureChannel();
        await scheduleNightReminders({
          bedtime,
          intervalMinutes: intervalNum,
          maxReminders: 12,
          habitId: habit.id,
          prepRemindersEnabled: prepEnabled,
        });
      }
      Alert.alert('Salvo', 'Suas preferências foram atualizadas.');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const info = await checkForUpdate(true);
      setUpdateInfo(info);
      if (!info.latestVersion) {
        Alert.alert('Sem atualizações', 'Não consegui acessar o GitHub Releases agora. Tente de novo daqui a pouco.');
      } else if (!info.available) {
        Alert.alert('Você está na última versão!', `v${info.currentVersion} é a mais recente.`);
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  const downloadUpdate = () => {
    const url = updateInfo?.downloadUrl ?? updateInfo?.releaseUrl;
    if (!url) return;
    Linking.openURL(url);
  };

  const handleRedoInterview = () => {
    navigation.navigate('Interview', { mode: 'redo' });
  };

  const handleResetAllData = () => {
    Alert.alert(
      'Apagar todos os dados?',
      'Isso vai remover seu histórico, entrevista, feedback e modelos baixados. O app volta ao estado de instalação. Confirma?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, apagar tudo',
          style: 'destructive',
          onPress: async () => {
            try {
              await releaseModel();
              await deleteAllDownloadedModels();
              await deleteApiKey();
              await resetAllUserData();
              await refreshConfig();
              Alert.alert(
                'Dados apagados',
                'Tudo foi limpo. Você vai voltar para o onboarding.',
                [
                  {
                    text: 'OK',
                    onPress: () =>
                      navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] }),
                  },
                ],
              );
            } catch (err) {
              Alert.alert('Erro', err instanceof Error ? err.message : 'Falha ao resetar.');
            }
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

          <View style={{ marginTop: spacing.md }}>
            <TimePickerInput
              label="Horário de dormir"
              value={bedtime}
              onChange={setBedtime}
            />
          </View>

          <Text style={styles.label}>Intervalo entre lembretes (min)</Text>
          <TextInput
            value={interval}
            onChangeText={(v) => setInterval(v.replace(/[^0-9]/g, '').slice(0, 2))}
            style={[styles.input, styles.inputCenter]}
            keyboardType="number-pad"
          />

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Lembrete de preparação
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                {`${interval} min antes da hora, sugiro respiração calmante`}
              </Text>
            </View>
            <Switch
              value={prepEnabled}
              onValueChange={setPrepEnabled}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={prepEnabled ? colors.text.onGold : colors.text.tertiary}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Modo voz 🎤
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                Auto-falar mensagens da Corujinha em pt-BR
              </Text>
            </View>
            <Switch
              value={voiceEnabled}
              onValueChange={setVoiceEnabled}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={voiceEnabled ? colors.text.onGold : colors.text.tertiary}
            />
          </View>
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
          <Text style={styles.section}>Sobre você</Text>
          <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.md }]}>
            {config?.interviewCompletedAt
              ? 'Você já fez a entrevista inicial. Pode refazer ou aprofundar a qualquer momento.'
              : 'Faça uma entrevista guiada para a Corujinha entender melhor suas dificuldades.'}
          </Text>
          <Pressable onPress={handleRedoInterview} style={styles.outlineBtn}>
            <Text style={styles.outlineBtnText}>
              {config?.interviewCompletedAt ? 'Refazer / aprofundar entrevista' : 'Fazer entrevista'}
            </Text>
          </Pressable>
        </Card>

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
              <Text style={styles.backendIcon}>☁️</Text>
              <Text style={[
                styles.backendLabel,
                aiBackend === 'remote' && styles.backendLabelActive,
              ]}>API</Text>
            </Pressable>
            <Pressable
              onPress={() => setAIBackend('local')}
              style={[styles.backendChip, aiBackend === 'local' && styles.backendChipActive]}
            >
              <Text style={styles.backendIcon}>📱</Text>
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
                              <Text style={styles.thinkingBadgeText}>🧠 thinking</Text>
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
                          <Text style={styles.deleteBtnText}>🗑  Deletar</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => handleDownloadModel(m.id)}
                          style={styles.downloadBtn}
                          hitSlop={8}
                        >
                          <Text style={styles.downloadBtnText}>⬇  Baixar</Text>
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

        <Card style={styles.card}>
          <Text style={styles.section}>Atualizações</Text>
          <View style={styles.versionRow}>
            <Text style={[typography.body, { color: colors.text.primary }]}>
              Versão atual
            </Text>
            <Text style={[typography.bodyMedium, { color: colors.accent.gold }]}>
              v{getCurrentVersion()}
            </Text>
          </View>
          {updateInfo?.available && updateInfo.latestVersion ? (
            <View style={styles.updateBox}>
              <Text style={[typography.bodyMedium, { color: colors.accent.gold }]}>
                ✨ Nova versão disponível: v{updateInfo.latestVersion}
              </Text>
              {updateInfo.notes ? (
                <Text style={[typography.small, { color: colors.text.secondary, marginTop: spacing.xs }]} numberOfLines={4}>
                  {updateInfo.notes}
                </Text>
              ) : null}
              <View style={{ height: spacing.sm }} />
              <Button
                label={updateInfo.downloadUrl ? 'Baixar APK' : 'Abrir release no GitHub'}
                onPress={downloadUpdate}
              />
            </View>
          ) : (
            <Pressable
              onPress={handleCheckUpdate}
              disabled={checkingUpdate}
              style={[styles.checkUpdateBtn, checkingUpdate && { opacity: 0.5 }]}
            >
              {checkingUpdate ? (
                <ActivityIndicator color={colors.accent.gold} />
              ) : (
                <Text style={[typography.bodyMedium, { color: colors.accent.gold }]}>
                  Verificar atualização
                </Text>
              )}
            </Pressable>
          )}
          <Text style={[typography.small, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
            Atualizações vêm do GitHub Releases. O download é um APK que substitui o app atual.
          </Text>
        </Card>

        <Card style={{ ...styles.card, ...styles.dangerCard }}>
          <Text style={[styles.section, { color: colors.accent.danger }]}>Zona de perigo</Text>
          <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.md }]}>
            Apaga todo o seu histórico (chat, entrevista, feedbacks de adiamento, streaks)
            e modelos baixados. O app volta ao estado original.
          </Text>
          <Pressable onPress={handleResetAllData} style={styles.dangerBtn}>
            <Text style={styles.dangerBtnText}>Apagar todos os meus dados</Text>
          </Pressable>
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
    fontSize: 20,
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
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  updateBox: {
    backgroundColor: 'rgba(244,197,83,0.1)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  checkUpdateBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineBtnText: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
  },
  dangerCard: {
    borderWidth: 1,
    borderColor: 'rgba(228,120,120,0.3)',
  },
  dangerBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent.danger,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  dangerBtnText: {
    ...typography.bodyMedium,
    color: colors.accent.danger,
  },
});
