import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { Button } from './Button';
import { GreekIcon, type GreekIconName } from './GreekIcon';
import { colors, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import {
  formatSleepDuration,
  getHealthDiagnostics,
  getHealthSnapshot,
  hasExtraHealthPermissions,
  hasHealthPermissions,
  isHealthConnectAvailable,
  openHealthSettings,
  requestHealthPermissions,
  type HealthSnapshot,
} from '../services/health';

type Status = 'loading' | 'unavailable' | 'denied' | 'granted';

interface MetricRowProps {
  icon: GreekIconName;
  label: string;
  value: string;
}

function MetricRow({ icon, label, value }: MetricRowProps) {
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricIcon}>
        <GreekIcon name={icon} size={24} />
      </View>
      <View style={styles.metricMain}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * Cartão de saúde (Android/Health Connect). Mostra sono, exercício da SEMANA
 * (zera segunda), passos, FC alta (>80% da máxima — precisa do ano de
 * nascimento), massa magra e % de gordura. Sem permissão, oferece o botão para
 * conectar; some por completo se o Health Connect não estiver disponível.
 */
export function HealthCard() {
  const { config, setConfig } = useAppStore();
  const [status, setStatus] = useState<Status>('loading');
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [hasExtras, setHasExtras] = useState(true);
  const [yearDraft, setYearDraft] = useState('');

  const birthYear = config?.birthYear ?? null;

  const load = useCallback(async () => {
    if (!(await isHealthConnectAvailable())) {
      setStatus('unavailable');
      return;
    }
    if (!(await hasHealthPermissions())) {
      setStatus('denied');
      return;
    }
    setHasExtras(await hasExtraHealthPermissions());
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
        'Não consegui abrir o pedido de permissão por aqui. Quer abrir o Health Connect para liberar o acesso manualmente?',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Abrir Health Connect', onPress: () => openHealthSettings() },
        ],
      );
    } finally {
      setConnecting(false);
    }
  };

  // Libera as permissões EXTRAS (FC + composição corporal) pra quem conectou
  // antes — reaproveita o mesmo fluxo (pede todas; as já dadas não re-perguntam).
  const handleGrantExtras = async () => {
    setConnecting(true);
    try {
      await requestHealthPermissions();
      await load();
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveYear = async () => {
    const y = parseInt(yearDraft, 10);
    const nowYear = new Date().getFullYear();
    if (!Number.isFinite(y) || y < nowYear - 110 || y > nowYear - 10) {
      Alert.alert('Ano de nascimento', 'Digite um ano válido (ex.: 1975).');
      return;
    }
    await setConfig({ birthYear: y });
    setYearDraft('');
    await load();
  };

  if (status === 'loading' || status === 'unavailable') return null;

  return (
    <Card style={styles.card}>
      <Pressable
        style={styles.sectionRow}
        onLongPress={async () => {
          const diag = await getHealthDiagnostics();
          Alert.alert('Diagnóstico do Health Connect', diag);
        }}
        delayLongPress={600}
      >
        <GreekIcon name="heart" size={20} />
        <Text style={styles.section}>Saúde</Text>
      </Pressable>

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
            icon="moon"
            label="Sono na última noite"
            value={
              snapshot?.sleepMinutesLastNight != null
                ? formatSleepDuration(snapshot.sleepMinutesLastNight)
                : 'sem registro'
            }
          />
          {birthYear != null && (
            <MetricRow
              icon="heart"
              label="Zona 2 na semana (zera segunda)"
              value={
                snapshot?.zone2MinutesWeek != null
                  ? `${snapshot.zone2MinutesWeek} min`
                  : 'sem registro'
              }
            />
          )}
          {birthYear != null && (
            <MetricRow
              icon="heart"
              label="FC alta na semana (>80% da máxima)"
              value={
                snapshot?.hrHighMinutesWeek != null
                  ? `${snapshot.hrHighMinutesWeek} min`
                  : 'sem registro'
              }
            />
          )}
          <MetricRow
            icon="footsteps"
            label="Passos (hoje)"
            value={
              snapshot && snapshot.stepsToday > 0
                ? snapshot.stepsToday.toLocaleString('pt-BR')
                : 'sem registro'
            }
          />
          <MetricRow
            icon="activity"
            label="Peso"
            value={snapshot?.weightKg != null ? `${snapshot.weightKg} kg` : 'sem registro'}
          />
          <MetricRow
            icon="activity"
            label="Gordura corporal"
            value={snapshot?.bodyFatPct != null ? `${snapshot.bodyFatPct}%` : 'sem registro'}
          />

          {birthYear == null && (
            <View style={styles.yearRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metricLabel}>
                  Ano de nascimento (para a métrica de FC alta)
                </Text>
                <TextInput
                  value={yearDraft}
                  onChangeText={(t) => setYearDraft(t.replace(/[^0-9]/g, '').slice(0, 4))}
                  placeholder="ex.: 1975"
                  placeholderTextColor={colors.text.tertiary}
                  keyboardType="number-pad"
                  maxLength={4}
                  style={styles.yearInput}
                />
              </View>
              <Pressable
                onPress={handleSaveYear}
                disabled={yearDraft.length !== 4}
                style={[styles.yearBtn, yearDraft.length !== 4 && { opacity: 0.4 }]}
              >
                <Text style={styles.yearBtnText}>Salvar</Text>
              </Pressable>
            </View>
          )}

          {!hasExtras && (
            <Pressable onPress={handleGrantExtras} hitSlop={6} style={styles.manageBtn}>
              {connecting ? (
                <ActivityIndicator size="small" color={colors.accent.gold} />
              ) : (
                <Text style={styles.manageText}>
                  Liberar FC e composição corporal no Health Connect →
                </Text>
              )}
            </Pressable>
          )}

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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
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
  metricIcon: {
    width: 32,
    alignItems: 'center',
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
  yearRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  yearInput: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 4,
    marginTop: 2,
  },
  yearBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.bg.surfaceStrong,
  },
  yearBtnText: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
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
