// Estado da sincronização com a Noosfera do Mac, nos ajustes.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getConfigSyncStatus, syncConfigNow, type ConfigSyncStatus } from '../services/configSync';
import { colors, radius, spacing, typography } from '../theme';

function describe(s: ConfigSyncStatus): string {
  if (s.state === 'ok') {
    const when = new Date(s.last).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `Em dia, última passada às ${when}. Hábitos, lembretes, marcas do dia, Escudo e Kinesis vão pelo arquivo askesis-sync.json, na pasta Askesis do seu Google Drive. As chaves de API não passam por lá.`;
  }
  if (s.state === 'signed-out') return 'Conecte a conta do Google na aba Escudo: é por ela que as configurações chegam ao Mac.';
  if (s.state === 'error') return `Não consegui sincronizar agora: ${s.message}`;
  return 'Ainda não sincronizou.';
}

export function ConfigSyncRow() {
  const [status, setStatus] = useState(getConfigSyncStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setStatus(getConfigSyncStatus()), 3000);
    return () => clearInterval(id);
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    await syncConfigNow();
    setStatus(getConfigSyncStatus());
    setBusy(false);
  }, []);

  return (
    <View>
      <Text style={styles.text}>{describe(status)}</Text>
      <Pressable
        onPress={run}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.text.onGold} />
        ) : (
          <Text style={styles.buttonText}>Sincronizar agora</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.sm },
  button: {
    backgroundColor: colors.accent.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  buttonText: { ...typography.bodyMedium, color: colors.text.onGold },
});
