import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors, spacing, typography } from '../theme';
import { speak, stopSpeaking } from '../services/voice';
import { playBreathingSound, stopBreathingSound } from '../services/breathingSound';
import { useAppStore } from '../store/useAppStore';

const DEFAULT_BREATHING_MINUTES = 16;

/** Formata milissegundos como m:ss para o cronômetro regressivo. */
function formatMMSS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Exercício de respiração: toca a trilha calma escolhida (em loop) por alguns
 * minutos, com um cronômetro regressivo. O guia visual (círculo + texto) foi
 * removido por enquanto porque não ficava em sincronia com o som — a ideia é
 * retomar um gráfico bem sincronizado no futuro. Por ora, é só a trilha + tempo.
 */
export function BreathingScreen() {
  const navigation = useNavigation<any>();
  const { config } = useAppStore();
  const [running, setRunning] = useState(false);
  // "Em seguida, ler o texto" — encadeia respiração → leitura.
  const [thenRead, setThenRead] = useState(false);
  const stoppedRef = useRef(false);
  const autoStartedRef = useRef(false);
  const thenReadRef = useRef(thenRead);
  thenReadRef.current = thenRead;

  const durationMin = config?.breathingDurationMinutes ?? DEFAULT_BREATHING_MINUTES;
  const [remainingMs, setRemainingMs] = useState(durationMin * 60000);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const finish = async () => {
    setRunning(false);
    stoppedRef.current = true;
    clearTick();
    setRemainingMs(0);
    stopBreathingSound();
    if (thenReadRef.current) {
      // Encadeamento: ao terminar a respiração, abre a leitura e já toca.
      setTimeout(() => navigation.navigate('ReadAloud', { autostart: true }), 600);
    } else if (config?.voiceModeEnabled) {
      await speak('Bom trabalho. Agora bora pra cama.');
    }
  };

  const start = () => {
    stoppedRef.current = false;
    setRunning(true);
    const minutes = config?.breathingDurationMinutes ?? DEFAULT_BREATHING_MINUTES;
    const totalMs = Math.max(1, minutes) * 60000;
    const startedAt = Date.now();
    setRemainingMs(totalMs);
    clearTick();
    tickRef.current = setInterval(() => {
      if (stoppedRef.current) {
        clearTick();
        return;
      }
      const left = Math.max(0, totalMs - (Date.now() - startedAt));
      setRemainingMs(left);
      if (left <= 0) {
        clearTick();
        void finish();
      }
    }, 500);
    // Trilha de fundo escolhida nas configurações (em loop durante o exercício).
    playBreathingSound({
      id: config?.breathingSoundId ?? 'cello',
      customUri: config?.breathingSoundUri ?? null,
    });
  };

  const stop = () => {
    stoppedRef.current = true;
    setRunning(false);
    stopSpeaking();
    stopBreathingSound();
    clearTick();
  };

  // Começa sozinho ao abrir (a partir do botão da Home ou do encadeamento): a
  // trilha já toca, sem precisar de um segundo toque. Espera a config carregar e
  // dispara uma vez.
  useEffect(() => {
    if (autoStartedRef.current || !config) return;
    autoStartedRef.current = true;
    const t = setTimeout(() => start(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      stopSpeaking();
      stopBreathingSound();
      clearTick();
    };
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            stop();
            navigation.goBack();
          }}
        >
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Respiração</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <Text style={[typography.body, styles.intro]}>
          Respire fundo e devagar, no seu ritmo, acompanhando a trilha. Deixe o
          ar sair lentamente a cada expiração. Sessão de {durationMin} min.
        </Text>

        <View style={styles.timerWrap}>
          <Text style={styles.timer}>
            {formatMMSS(running ? remainingMs : durationMin * 60000)}
          </Text>
          <Text style={styles.timerSub}>{running ? 'respirando…' : 'pronto?'}</Text>
        </View>

        <View style={styles.actions}>
          {!running ? (
            <Button label="Começar" onPress={start} />
          ) : (
            <Button label="Pausar" variant="secondary" onPress={stop} />
          )}
          <View style={{ height: spacing.sm }} />
          <Button
            label="Pular para dormir"
            variant="ghost"
            onPress={() => navigation.navigate('Chat')}
          />
        </View>

        <View style={styles.chainRow}>
          <Text style={styles.chainLabel}>Em seguida, ler um texto</Text>
          <Switch
            value={thenRead}
            onValueChange={setThenRead}
            trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
            thumbColor={thenRead ? colors.text.onGold : colors.text.tertiary}
          />
        </View>
      </View>
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
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  intro: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  timerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.xxl,
  },
  timer: {
    color: colors.accent.gold,
    fontSize: 64,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timerSub: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: spacing.sm,
  },
  actions: {
    width: '100%',
    marginTop: spacing.xxl,
  },
  chainRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chainLabel: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
});
