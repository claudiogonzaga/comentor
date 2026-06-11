import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import {
  hasHealthPermissions,
  isHealthConnectAvailable,
  openHealthSettings,
  requestHealthPermissions,
} from '../services/health';

type HcStatus = 'unavailable' | 'denied' | 'granted';

/**
 * "Sobre você" — nome, sexo e idade (ano de nascimento) + conexão com o
 * Health Connect (sono, exercício, FC, peso, gordura) e a entrevista guiada.
 * Tudo salva automaticamente.
 */
export function AboutYouScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();
  const [name, setName] = useState(config?.name ?? '');
  const [birthYearInput, setBirthYearInput] = useState(
    config?.birthYear != null ? String(config.birthYear) : '',
  );
  const [hcStatus, setHcStatus] = useState<HcStatus>('unavailable');
  const [connecting, setConnecting] = useState(false);

  const sex = config?.sex ?? null;

  useEffect(() => {
    if (config) {
      setName(config.name ?? '');
      setBirthYearInput(config.birthYear != null ? String(config.birthYear) : '');
    }
  }, [config]);

  const refreshHc = useCallback(async () => {
    if (!(await isHealthConnectAvailable())) {
      setHcStatus('unavailable');
      return;
    }
    setHcStatus((await hasHealthPermissions()) ? 'granted' : 'denied');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshHc();
    }, [refreshHc]),
  );

  const saveName = async () => {
    try {
      await setConfig({ name: name.trim() || null });
    } catch (err) {
      console.warn('save name failed:', err);
    }
  };

  const saveBirthYear = async () => {
    const nowYear = new Date().getFullYear();
    const y = parseInt(birthYearInput, 10);
    if (birthYearInput.length === 0) {
      await setConfig({ birthYear: null });
      return;
    }
    if (birthYearInput.length !== 4 || y < nowYear - 110 || y > nowYear - 5) {
      Alert.alert('Ano de nascimento', 'Digite um ano válido (ex.: 1975).');
      return;
    }
    await setConfig({ birthYear: y });
  };

  const handleConnectHc = async () => {
    setConnecting(true);
    try {
      const ok = await requestHealthPermissions();
      if (ok) {
        await refreshHc();
        return;
      }
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

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Sobre você</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <Text style={styles.label}>Como te chamo</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={() => void saveName()}
            placeholder="Seu nome (opcional)"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
          />

          <Text style={styles.label}>Sexo</Text>
          <View style={styles.row}>
            {(
              [
                { value: 'feminino', label: 'Feminino' },
                { value: 'masculino', label: 'Masculino' },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.value}
                onPress={async () => {
                  // tocar de novo na opção marcada desmarca (volta a null)
                  await setConfig({ sex: sex === opt.value ? null : opt.value });
                }}
                style={[styles.chip, sex === opt.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, sex === opt.value && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Ano de nascimento</Text>
          <TextInput
            value={birthYearInput}
            onChangeText={(v) => setBirthYearInput(v.replace(/[^0-9]/g, '').slice(0, 4))}
            onEndEditing={() => void saveBirthYear()}
            placeholder="ex.: 1975"
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, styles.inputCenter]}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Text style={styles.hint}>
            Usado para calcular suas faixas de frequência cardíaca (zona 2 e FC
            alta) no painel de Saúde. Salva automaticamente.
          </Text>
        </Card>

        {hcStatus !== 'unavailable' && (
          <Card style={styles.card}>
            <Text style={styles.section}>Health Connect</Text>
            {hcStatus === 'granted' ? (
              <>
                <Text style={[typography.body, { color: colors.text.primary }]}>
                  ✓ Conectado
                </Text>
                <Text style={styles.hint}>
                  A Comentora acompanha seu sono, zona 2, FC alta, passos, peso e
                  gordura corporal no painel de Saúde da tela inicial.
                </Text>
                <Pressable onPress={openHealthSettings} hitSlop={6} style={{ marginTop: spacing.sm }}>
                  <Text style={[typography.small, { color: colors.accent.gold }]}>
                    Gerenciar no Health Connect →
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.hint}>
                  Conecte o Health Connect para a Comentora acompanhar seu sono,
                  exercícios (zona 2 e FC alta), passos, peso e gordura corporal
                  — e te conhecer melhor nas conversas.
                </Text>
                <View style={{ height: spacing.sm }} />
                <Button
                  label="Conectar Health Connect"
                  variant="secondary"
                  loading={connecting}
                  onPress={handleConnectHc}
                />
              </>
            )}
          </Card>
        )}

        <Card style={styles.card}>
          <Text style={styles.section}>Entrevista</Text>
          <Text style={styles.hint}>
            {config?.interviewCompletedAt
              ? 'Você já fez a entrevista inicial. Pode refazer ou aprofundar a qualquer momento.'
              : 'Faça uma entrevista guiada para a Comentora entender melhor suas dificuldades.'}
          </Text>
          <View style={{ height: spacing.sm }} />
          <Button
            label={
              config?.interviewCompletedAt ? 'Refazer / aprofundar entrevista' : 'Fazer entrevista'
            }
            variant="secondary"
            onPress={() => navigation.navigate('Interview', { mode: 'redo' })}
          />
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
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputCenter: {
    textAlign: 'center',
    width: 120,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.accent.gold,
    backgroundColor: colors.bg.surfaceStrong,
  },
  chipText: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
  chipTextActive: {
    color: colors.accent.gold,
  },
});
