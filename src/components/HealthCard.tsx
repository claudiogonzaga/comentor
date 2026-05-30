import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { Button } from './Button';
import { colors, spacing, typography } from '../theme';
import {
  formatSleepDuration,
  getHealthSnapshot,
  hasHealthPermissions,
  isHealthConnectAvailable,
  openHealthSettings,
  requestHealthPermissions,
  type HealthSnapshot,
} from '../services/health';

type Status = 'loading' | 'unavailable' | 'denied' | 'granted';

interface MetricRowProps {
  emoji: string;
  label: string;
  value: string;
}

function MetricRow({ emoji, label, value }: MetricRowProps) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricEmoji}>{emoji}</Text>
      <View style={styles.metricMain}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * Cartão de saúde (Android/Health Connect). Mostra um resumo de sono,
 * exercício e passos quando a permissão está concedida; senão oferece o
 * botão para conectar. Some por completo se o Health Connect não estiver
 * disponível (iOS, build sem o módulo, app não instalado).
 */
export function HealthCard() {
  const [status, setStatus] = useState<Status>('loading');
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    if (!(await isHealthConnectAvailable())) {
      setStatus('unavailable');
      return;
    }
    if (!(await hasHealthPermissions())) {
      setStatus('denied');
      return;
    }
    const snap = await getHealthSnapshot();
    setSnapshot(snap);
    setStatus('granted');
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const ok = await requestHealthPermissions();
      if (ok) {
        await load();
        return;
      }
      // A permissão não foi concedida — pode ter sido recusada OU o sistema
      // não conseguiu abrir o diálogo (alguns aparelhos não mostram o popup
      // direto). Em vez de deixar o botão "sem fazer nada", oferecemos abrir o
      // próprio Health Connect, onde dá pra liberar as permissões na mão.
      Alert.alert(
        'Conectar Health Connect',
        'Não consegui abrir o pedido de permissão por aqui. Quer abrir o Health Connect para liberar o acesso (Sono, Exercício e Passos) manualmente?',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Abrir Health Connect', onPress: () => openHealthSettings() },
        ],
      );
    } finally {
      setConnecting(false);
    }
  };

  if (status === 'loading' || status === 'unavailable') return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.section}>Saúde 💪</Text>

      {status === 'denied' && (
        <>
          <Text style={styles.subtitle}>
            Conecte o Health Connect para a Comentora acompanhar seu sono e
            seus exercícios — e te conhecer melhor nas conversas.
          </Text>
          <Button
            label="Conectar Health Connect"
            variant="secondary"
            loading={connecting}
            onPress={handleConnect}
          />
        </>
      )}

      {status === 'granted' && (
        <>
          <MetricRow
            emoji="😴"
            label="Sono na última noite"
            value={
              snapshot?.sleepMinutesLastNight != null
                ? formatSleepDuration(snapshot.sleepMinutesLastNight)
                : 'sem registro'
            }
          />
          <MetricRow
            emoji="🏃"
            label="Exercício (7 dias)"
            value={
              snapshot && snapshot.exerciseSessions7d > 0
                ? `${snapshot.exerciseSessions7d} ${
                    snapshot.exerciseSessions7d === 1 ? 'sessão' : 'sessões'
                  } · ${snapshot.exerciseMinutes7d} min`
                : 'nenhum registro'
            }
          />
          <MetricRow
            emoji="👟"
            label="Passos (7 dias)"
            value={
              snapshot && snapshot.steps7d > 0
                ? snapshot.steps7d.toLocaleString('pt-BR')
                : 'sem registro'
            }
          />
          <Pressable onPress={openHealthSettings} hitSlop={6} style={styles.manageBtn}>
            <Text style={styles.manageText}>Gerenciar no Health Connect →</Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  metricEmoji: {
    fontSize: 26,
    width: 32,
    textAlign: 'center',
  },
  metricMain: {
    flex: 1,
  },
  metricLabel: {
    ...typography.small,
    color: colors.text.secondary,
  },
  metricValue: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  manageBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  manageText: {
    ...typography.small,
    color: colors.accent.gold,
  },
});
