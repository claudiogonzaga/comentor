import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { GreekIcon } from '../components/GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { deleteApiKey } from '../services/secureStore';
import { deleteAllDownloadedModels } from '../services/modelDownload';
import { releaseModel } from '../services/localModel';
import { resetAllUserData } from '../services/database';
import { checkForUpdate, getCurrentVersion, type UpdateInfo } from '../services/updateChecker';
import type { Tone } from '../types';

const TONES: { value: Tone; label: string }[] = [
  { value: 'gentle', label: 'Gentil' },
  { value: 'firm', label: 'Firme' },
  { value: 'brutal', label: 'Brutal' },
];

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig, setApiKey, refreshConfig } = useAppStore();

  const [tone, setTone] = useState<Tone>(config?.tone ?? 'firm');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (config) {
      setTone(config.tone);
    }
  }, [config]);


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
        <Pressable onPress={() => navigation.navigate('AboutYou')}>
          <Card style={styles.linkCard}>
            <View style={styles.linkIcon}>
              <GreekIcon name="owl" size={24} color={colors.accent.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Sobre você</Text>
              <Text style={styles.linkSub}>
                Nome, sexo, idade, conexão com o Health Connect e a entrevista.
              </Text>
            </View>
            <GreekIcon name="chevronRight" size={20} color={colors.text.tertiary} />
          </Card>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('Reminders')}>
          <Card style={styles.linkCard}>
            <View style={styles.linkIcon}>
              <GreekIcon name="bell" size={24} color={colors.accent.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Hábitos saudáveis</Text>
              <Text style={styles.linkSub}>
                Sol, luz azul, respiração, cardio, remédios, água, jejum… + nudge
                de trabalho sentado. A coruja insiste até você marcar que fez.
              </Text>
            </View>
            <GreekIcon name="chevronRight" size={20} color={colors.text.tertiary} />
          </Card>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('SonsVozes')}>
          <Card style={styles.linkCard}>
            <View style={styles.linkIcon}>
              <GreekIcon name="sound" size={24} color={colors.accent.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Configurar Sons e Notificações</Text>
              <Text style={styles.linkSub}>
                Canto da coruja, voz da Comentora, avisos falados, lembretes do
                dia, modo inspiração, Não Perturbe e volume.
              </Text>
            </View>
            <GreekIcon name="chevronRight" size={20} color={colors.text.tertiary} />
          </Card>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('BrainVoice')}>
          <Card style={styles.linkCard}>
            <View style={styles.linkIcon}>
              <GreekIcon name="brain" size={24} color={colors.accent.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Cérebro e Voz da Comentora</Text>
              <Text style={styles.linkSub}>
                A voz com que ela fala, a inteligência (API ou no celular) e o
                prompt com a personalidade dela.
              </Text>
            </View>
            <GreekIcon name="chevronRight" size={20} color={colors.text.tertiary} />
          </Card>
        </Pressable>

        <Card style={styles.card}>
          <Text style={styles.section}>Tom da Comentora</Text>
          <View style={styles.row}>
            {TONES.map((t) => (
              <Pressable
                key={t.value}
                onPress={() => {
                  setTone(t.value);
                  void setConfig({ tone: t.value });
                }}
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
              <View style={styles.updateTitleRow}>
                <GreekIcon name="sparkle" size={16} color={colors.accent.gold} />
                <Text style={[typography.bodyMedium, { color: colors.accent.gold }]}>
                  Nova versão disponível: v{updateInfo.latestVersion}
                </Text>
              </View>
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
    // Desce abaixo da faixa do meandro (desenhada full-screen atrás), senão
    // "Voltar"/"Configurações" sobrepõem a borda grega do topo.
    marginTop: spacing.xl,
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
  quietTimesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  quietDaysLabel: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  quietDaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  quietDayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  quietDayChipOn: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.12)',
  },
  quietDayText: {
    ...typography.small,
    color: colors.text.secondary,
  },
  quietDayTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
  quietHint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
    lineHeight: 16,
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
  updateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  linkTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  linkSub: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 18,
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
