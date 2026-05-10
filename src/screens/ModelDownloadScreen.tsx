import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import type { LocalModelId } from '../types';
import { getLocalModel, formatModelSize } from '../constants/models';
import {
  MobileDataNotAllowedError,
  startModelDownload,
  type DownloadProgress,
} from '../services/modelDownload';
import { useAppStore } from '../store/useAppStore';

type DownloadParams = {
  ModelDownload: {
    modelId: LocalModelId;
    fromOnboarding?: boolean;
  };
};

type Phase = 'idle' | 'downloading' | 'done' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ModelDownloadScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<DownloadParams, 'ModelDownload'>>();
  const { modelId, fromOnboarding } = route.params;
  const model = getLocalModel(modelId);
  const { config, setConfig } = useAppStore();

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelRef = useRef<(() => Promise<void>) | null>(null);

  const allowMobileData = config?.allowMobileDataDownload ?? false;

  const startDownload = async () => {
    setPhase('downloading');
    setErrorMsg(null);
    setProgress(null);
    try {
      const handle = await startModelDownload(modelId, {
        allowMobileData,
        onProgress: (p) => setProgress(p),
      });
      cancelRef.current = handle.cancel;
      await handle.promise;
      cancelRef.current = null;
      await setConfig({ localModelDownloaded: true });
      setPhase('done');
    } catch (err) {
      cancelRef.current = null;
      if (err instanceof MobileDataNotAllowedError) {
        setPhase('error');
        setErrorMsg(
          'Você está em dados móveis e não autorizou esse tipo de download. Conecte o Wi-Fi ou ative "permitir dados móveis" nas configurações.',
        );
      } else {
        setPhase('error');
        setErrorMsg(err instanceof Error ? err.message : 'Erro desconhecido no download.');
      }
    }
  };

  useEffect(() => {
    if (phase === 'idle') {
      void startDownload();
    }
    return () => {
      if (cancelRef.current) {
        void cancelRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFinish = async () => {
    if (fromOnboarding) {
      navigation.navigate('Interview', { mode: 'onboarding' });
    } else {
      navigation.goBack();
    }
  };

  const handleCancel = async () => {
    if (cancelRef.current) {
      await cancelRef.current();
      cancelRef.current = null;
    }
    Alert.alert('Download cancelado', 'O arquivo parcial foi removido.');
    navigation.goBack();
  };

  const handleRetry = () => {
    setPhase('idle');
  };

  const fraction = progress?.fraction ?? 0;
  const written = progress?.totalBytesWritten ?? 0;
  const expected = progress?.totalBytesExpectedToWrite ?? model.sizeBytes;
  const percent = Math.round(fraction * 100);

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.center}>
          <Owl
            mood={
              phase === 'done'
                ? 'celebrating'
                : phase === 'error'
                ? 'worried'
                : 'serious'
            }
            size={150}
          />
          <Text style={[typography.title, styles.title]}>{model.label}</Text>
          <Text style={[typography.body, styles.subtitle]}>
            {model.vendor} · {formatModelSize(model.sizeBytes)}
          </Text>
        </View>

        {phase === 'downloading' && (
          <View style={styles.progressBox}>
            <Text style={styles.progressLabel}>Baixando…</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percent}%` }]} />
            </View>
            <View style={styles.progressInfoRow}>
              <Text style={styles.progressInfo}>
                {formatBytes(written)} / {formatBytes(expected)}
              </Text>
              <Text style={styles.progressPercent}>{percent}%</Text>
            </View>
            <Text style={styles.hint}>
              Mantenha o app aberto. Se o download for interrompido, você precisa começar de novo.
            </Text>
          </View>
        )}

        {phase === 'done' && (
          <View style={styles.statusBox}>
            <Text style={styles.statusTitle}>✓ Modelo pronto</Text>
            <Text style={styles.statusDesc}>
              O {model.label} foi baixado e está pronto para rodar no seu celular.
              {fromOnboarding ? ' Vamos continuar?' : ''}
            </Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={[styles.statusBox, styles.statusBoxError]}>
            <Text style={[styles.statusTitle, { color: colors.accent.danger }]}>
              ✗ Falha no download
            </Text>
            <Text style={styles.statusDesc}>{errorMsg}</Text>
          </View>
        )}

        <View style={styles.actions}>
          {phase === 'downloading' && (
            <Pressable onPress={handleCancel} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Cancelar</Text>
            </Pressable>
          )}
          {phase === 'done' && (
            <Button
              label={fromOnboarding ? 'Ativar CoMentor 🦉' : 'Pronto'}
              onPress={handleFinish}
            />
          )}
          {phase === 'error' && (
            <>
              <Button label="Tentar de novo" onPress={handleRetry} />
              <View style={{ height: spacing.md }} />
              <Pressable onPress={() => navigation.goBack()} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Voltar</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  center: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subtitle: {
    color: colors.accent.gold,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  progressBox: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressLabel: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  progressTrack: {
    height: 12,
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent.gold,
    borderRadius: radius.pill,
  },
  progressInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  progressInfo: {
    ...typography.small,
    color: colors.text.secondary,
  },
  progressPercent: {
    ...typography.small,
    color: colors.accent.gold,
    fontFamily: typography.bodyMedium.fontFamily,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
  },
  statusBox: {
    backgroundColor: 'rgba(125,211,168,0.1)',
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(125,211,168,0.3)',
  },
  statusBoxError: {
    backgroundColor: 'rgba(228,120,120,0.1)',
    borderColor: 'rgba(228,120,120,0.3)',
  },
  statusTitle: {
    ...typography.bodyMedium,
    color: colors.accent.success,
    marginBottom: spacing.sm,
  },
  statusDesc: {
    ...typography.body,
    color: colors.text.secondary,
  },
  actions: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  secondaryBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryBtnText: {
    ...typography.button,
    color: colors.text.secondary,
  },
});
