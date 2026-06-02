import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors, spacing, typography } from '../theme';
import { speak, stopSpeaking } from '../services/voice';
import { playBreathingSound, stopBreathingSound } from '../services/breathingSound';
import { useAppStore } from '../store/useAppStore';

type Phase = 'inhale1' | 'inhale2' | 'exhale' | 'rest';

interface Cue {
  phase: Phase;
  label: string;
  duration: number;
  toScale: number;
}

const CYCLE: Cue[] = [
  { phase: 'inhale1', label: 'inspire curto', duration: 1500, toScale: 1.25 },
  { phase: 'inhale2', label: 'mais um inspirar curto', duration: 1500, toScale: 1.45 },
  { phase: 'exhale', label: 'expire devagar', duration: 5000, toScale: 0.7 },
  { phase: 'rest', label: 'pausa', duration: 600, toScale: 0.7 },
];

const TARGET_CYCLES = 5;

export function BreathingScreen() {
  const navigation = useNavigation<any>();
  const { config } = useAppStore();
  const [running, setRunning] = useState(false);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [cueIdx, setCueIdx] = useState(0);
  const scale = useRef(new Animated.Value(1)).current;
  const cueIdxRef = useRef(0);
  const cycleIdxRef = useRef(0);
  const stoppedRef = useRef(false);
  const autoStartedRef = useRef(false);

  const start = async () => {
    stoppedRef.current = false;
    cueIdxRef.current = 0;
    cycleIdxRef.current = 0;
    setCycleIdx(0);
    setCueIdx(0);
    setRunning(true);
    // Trilha de fundo escolhida nas configurações (em loop durante o exercício).
    playBreathingSound({
      id: config?.breathingSoundId ?? 'cello',
      customUri: config?.breathingSoundUri ?? null,
    });
    if (config?.voiceModeEnabled) {
      speak('Vamos respirar. Duas inspiradas curtas e uma expirada longa.');
    }
    runNext();
  };

  const runNext = () => {
    if (stoppedRef.current) return;
    if (cycleIdxRef.current >= TARGET_CYCLES) {
      finish();
      return;
    }
    const cue = CYCLE[cueIdxRef.current];
    setCueIdx(cueIdxRef.current);
    if (config?.voiceModeEnabled && cue.phase !== 'rest') {
      speak(cue.label);
    }
    Animated.timing(scale, {
      toValue: cue.toScale,
      duration: cue.duration,
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    }).start(() => {
      if (stoppedRef.current) return;
      cueIdxRef.current += 1;
      if (cueIdxRef.current >= CYCLE.length) {
        cueIdxRef.current = 0;
        cycleIdxRef.current += 1;
        setCycleIdx(cycleIdxRef.current);
      }
      runNext();
    });
  };

  const finish = async () => {
    setRunning(false);
    stoppedRef.current = true;
    Animated.timing(scale, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).stop();
    stopBreathingSound();
    if (config?.voiceModeEnabled) {
      await speak('Bom trabalho. Agora bora pra cama.');
    }
  };

  const stop = () => {
    stoppedRef.current = true;
    setRunning(false);
    stopSpeaking();
    stopBreathingSound();
    scale.stopAnimation();
  };

  // Começa sozinho ao abrir (a partir do botão da Home ou do lembrete): o som
  // e o guia já tocam — sem precisar de um segundo toque. Espera a config
  // carregar para usar a trilha escolhida pelo usuário, e só dispara uma vez.
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
    };
  }, []);

  const cue = CYCLE[cueIdx];

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
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Respiração 2-2-4</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <Text style={[typography.body, styles.intro]}>
          Duas inspiradas rápidas pelo nariz, uma expirada longa pela boca. Repete 5 ciclos.
        </Text>

        <View style={styles.circleWrap}>
          <Animated.View style={[styles.circle, { transform: [{ scale }] }]} />
          <Text style={[typography.title, styles.cueLabel]}>
            {running ? cue.label : 'pronto?'}
          </Text>
        </View>

        <Text style={[typography.body, styles.counter]}>
          {running ? `Ciclo ${Math.min(cycleIdx + 1, TARGET_CYCLES)} de ${TARGET_CYCLES}` : ' '}
        </Text>

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
  circleWrap: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.xxl,
  },
  circle: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.accent.gold,
    opacity: 0.85,
  },
  cueLabel: {
    color: colors.text.onGold,
    fontSize: 18,
  },
  counter: {
    color: colors.text.secondary,
  },
  actions: {
    width: '100%',
    marginTop: spacing.xxl,
  },
});
