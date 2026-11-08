// SURFAR A VONTADE (urge surfing, Marlatt): 90 segundos guiados para atravessar
// uma vontade sem lutar com ela nem obedecer. A vontade se comporta como uma
// onda — sobe, chega ao pico e passa, em geral em poucos minutos — e cada onda
// atravessada enfraquece a ligação gatilho → hábito. A tela mostra exatamente
// isso: a onda subindo e descendo enquanto o círculo marca a respiração, com
// frases curtas (e, se a pessoa quiser, faladas).
//
// No fim, "A vontade passou?": sim registra a vontade superada (vai para o mapa
// de gatilhos); ainda forte oferece mais uma onda, o plano de substituição ou o
// registro do deslize — sem culpa em nenhum dos caminhos.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Switch, Text, View, type LayoutChangeEvent } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { SlipSheet, SLIP_EMOTIONS } from '../components/SlipSheet';
import { Chip, ChipRow, ScreenHeader, withAlpha } from '../components/habitShared';
import { colors, spacing, typography } from '../theme';
import { getHabit, logUrgeResisted } from '../services/habitos';
import { speak, stopSpeaking } from '../services/voice';
import type { HabitDef } from '../types/habits';

const DURATION_S = 90;
const INHALE_MS = 4000;
const EXHALE_MS = 6000;

/** As frases, cada uma a partir do segundo indicado. */
const CUES: { at: number; text: string }[] = [
  { at: 0, text: 'Note onde a vontade está no corpo. No peito, na boca, nas mãos?' },
  { at: 12, text: 'Dê um nome a ela: “isto é vontade”. Só nomear já tira um pouco da força.' },
  { at: 25, text: 'Ela está subindo. Tudo bem. Respire junto com o círculo.' },
  { at: 40, text: 'Este é o pico. Você não precisa fazer nada com ela. Só observar.' },
  { at: 55, text: 'Repare: ela já mudou. Está um pouco diferente de antes.' },
  { at: 70, text: 'A onda está descendo. Cada vontade atravessada enfraquece a próxima.' },
  { at: 84, text: 'Quase lá. Mais uma respiração.' },
];

/** A intensidade da onda em p ∈ [0,1]: sobe, pico perto do meio, desce. */
function wave(p: number): number {
  return 0.08 + 0.88 * Math.exp(-((p - 0.45) ** 2) / (2 * 0.17 ** 2));
}

type Phase = 'intro' | 'surf' | 'ask' | 'done' | 'still';

export function UrgeSurfScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const type: string = route.params?.type ?? '';
  const [habit, setHabit] = useState<HabitDef | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [voiceOn, setVoiceOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [inhale, setInhale] = useState(true);
  const [emotion, setEmotion] = useState<string | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waveW, setWaveW] = useState(0);
  const startRef = useRef(0);
  const lastCue = useRef(-1);
  const breath = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    getHabit(type).then(setHabit).catch(() => setHabit(null));
    return () => {
      stopSpeaking().catch(() => {});
    };
  }, [type]);

  // O relógio da onda: medido pelo tempo real, não pela contagem de ticks.
  useEffect(() => {
    if (phase !== 'surf') return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000;
      if (s >= DURATION_S) {
        clearInterval(id);
        setElapsed(DURATION_S);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setPhase('ask');
        return;
      }
      setElapsed(s);
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  // A respiração: o círculo cresce ao inspirar (4 s) e encolhe ao soltar (6 s).
  useEffect(() => {
    if (phase !== 'surf') return;
    let alive = true;
    const cycle = () => {
      if (!alive) return;
      setInhale(true);
      Animated.timing(breath, {
        toValue: 1,
        duration: INHALE_MS,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || !alive) return;
        setInhale(false);
        Animated.timing(breath, {
          toValue: 0.7,
          duration: EXHALE_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }).start(({ finished: f2 }) => f2 && cycle());
      });
    };
    breath.setValue(0.7);
    cycle();
    return () => {
      alive = false;
      breath.stopAnimation();
    };
  }, [phase, breath]);

  const cueIndex = CUES.reduce((acc, c, i) => (elapsed >= c.at ? i : acc), 0);

  // Fala a frase nova (se a voz estiver ligada), uma vez por frase.
  useEffect(() => {
    if (phase !== 'surf' || cueIndex === lastCue.current) return;
    lastCue.current = cueIndex;
    Haptics.selectionAsync().catch(() => {});
    if (voiceOn) speak(CUES[cueIndex].text).catch(() => {});
  }, [cueIndex, phase, voiceOn]);

  const start = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    // Zera antes de trocar de fase: na "Mais 90 segundos", a primeira tela da
    // onda nova não pode herdar o fim da anterior (nem falar a última frase).
    lastCue.current = -1;
    setElapsed(0);
    setPhase('surf');
  }, []);

  const passed = async () => {
    setBusy(true);
    try {
      await logUrgeResisted(type, { emotion });
    } catch (err) {
      console.warn('logUrgeResisted:', err);
    } finally {
      setBusy(false);
      setPhase('done');
    }
  };

  const planB = habit?.planB?.trim();
  const remaining = Math.max(0, Math.ceil(DURATION_S - elapsed));

  return (
    <ScreenContainer>
      <ScreenHeader title="Surfar a vontade" onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        {phase === 'intro' && (
          <>
            <Text style={styles.lead}>
              A vontade é uma onda: sobe, chega ao pico e passa. Você não precisa lutar com ela nem obedecer —
              só observar por 90 segundos.
            </Text>
            {habit && <Text style={styles.habitName}>{habit.title}</Text>}
            {planB ? (
              <Card style={styles.planCard}>
                <Text style={styles.planLabel}>SEU PLANO</Text>
                <Text style={styles.planText}>Quando sentir vontade, eu vou {planB}.</Text>
              </Card>
            ) : null}
            <View style={styles.voiceRow}>
              <Text style={styles.voiceText}>Ouvir as frases em voz</Text>
              <Switch
                value={voiceOn}
                onValueChange={setVoiceOn}
                trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                thumbColor={voiceOn ? colors.text.onGold : colors.text.tertiary}
                accessibilityLabel="Ouvir as frases em voz"
              />
            </View>
            <View style={{ flex: 1 }} />
            <Button label="Começar (90 s)" onPress={start} />
          </>
        )}

        {phase === 'surf' && (
          <>
            <View
              style={styles.waveBox}
              onLayout={(e: LayoutChangeEvent) => setWaveW(Math.floor(e.nativeEvent.layout.width))}
              accessibilityLabel={`Onda da vontade, faltam ${remaining} segundos`}
            >
              {waveW > 0 && <Wave width={waveW} height={120} progress={elapsed / DURATION_S} />}
            </View>
            <Text style={styles.remaining}>{remaining} s</Text>

            <View style={styles.breathBox}>
              <Animated.View style={[styles.breathCircle, { transform: [{ scale: breath }] }]} />
              <Text style={styles.breathText} accessibilityLiveRegion="polite">
                {inhale ? 'Inspire…' : 'Solte…'}
              </Text>
            </View>

            <Text style={styles.cue} accessibilityLiveRegion="polite">
              {CUES[cueIndex].text}
            </Text>
            <View style={{ flex: 1 }} />
            {planB ? <Text style={styles.planSmall}>Seu plano: {planB}.</Text> : null}
            <Button label="Parar" variant="ghost" onPress={() => setPhase('ask')} />
          </>
        )}

        {phase === 'ask' && (
          <>
            <Text style={styles.question}>A vontade passou?</Text>
            <Text style={styles.lead}>Passou ou diminuiu já conta.</Text>
            <Text style={styles.chipsLabel}>O que trouxe a vontade? (opcional)</Text>
            <ChipRow>
              {SLIP_EMOTIONS.map((e) => (
                <Chip key={e} label={e} selected={emotion === e} onPress={() => setEmotion(emotion === e ? null : e)} />
              ))}
            </ChipRow>
            <View style={{ flex: 1 }} />
            <Button label="Passou" onPress={passed} loading={busy} />
            <View style={{ height: spacing.sm }} />
            <Button label="Ainda está forte" variant="secondary" onPress={() => setPhase('still')} />
          </>
        )}

        {phase === 'done' && (
          <>
            <Text style={styles.question}>Você surfou a onda.</Text>
            <Text style={styles.lead}>
              Cada vontade atravessada sem ceder deixa a ligação entre o gatilho e o hábito um pouco mais fraca.
              Ficou registrada no seu mapa de gatilhos.
            </Text>
            {planB ? (
              <Card style={styles.planCard}>
                <Text style={styles.planLabel}>AGORA, O PLANO</Text>
                <Text style={styles.planText}>{planB.charAt(0).toUpperCase() + planB.slice(1)}.</Text>
              </Card>
            ) : null}
            <View style={{ flex: 1 }} />
            <Button label="Voltar" onPress={() => navigation.goBack()} />
          </>
        )}

        {phase === 'still' && (
          <>
            <Text style={styles.question}>Tudo bem — às vezes a onda é longa.</Text>
            <Text style={styles.lead}>
              Dá para pegar mais uma, fazer o seu plano agora ou, se escorregou, registrar o deslize. Nenhum
              caminho é fracasso: todos ensinam alguma coisa sobre o gatilho.
            </Text>
            {planB ? (
              <Card style={styles.planCard}>
                <Text style={styles.planLabel}>SEU PLANO</Text>
                <Text style={styles.planText}>Quando sentir vontade, eu vou {planB}.</Text>
              </Card>
            ) : null}
            <View style={{ flex: 1 }} />
            <Button label="Mais 90 segundos" onPress={start} />
            <View style={{ height: spacing.sm }} />
            <Button label="Registrar deslize" variant="secondary" onPress={() => setSlipOpen(true)} />
            <View style={{ height: spacing.sm }} />
            <Button label="Voltar" variant="ghost" onPress={() => navigation.goBack()} />
          </>
        )}
      </View>

      <SlipSheet
        visible={slipOpen}
        habit={habit}
        onClose={() => {
          setSlipOpen(false);
        }}
      />
    </ScreenContainer>
  );
}

/** A onda: a curva inteira clara, o trecho já percorrido mais forte, e o ponto de agora. */
function Wave({ width, height, progress }: { width: number; height: number; progress: number }) {
  const N = 64;
  const p = Math.max(0, Math.min(1, progress));
  const pt = (t: number) => ({ x: t * width, y: height - wave(t) * (height - 10) - 2 });
  const curve = (to: number) => {
    const steps = Math.max(1, Math.round(N * to));
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const { x, y } = pt((i / steps) * to);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    return d;
  };
  const full = curve(1);
  const done = curve(Math.max(0.001, p));
  const now = pt(p);
  return (
    <Svg width={width} height={height}>
      <Path d={`${full} L${width},${height} L0,${height} Z`} fill={withAlpha(colors.accent.gold, 0.1)} />
      <Path d={`${done} L${now.x.toFixed(1)},${height} L0,${height} Z`} fill={withAlpha(colors.accent.gold, 0.28)} />
      <Path d={full} stroke={withAlpha(colors.accent.gold, 0.5)} strokeWidth={2} fill="none" />
      <Circle cx={now.x} cy={now.y} r={7} fill={colors.accent.gold} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  lead: { ...typography.body, color: colors.text.secondary, marginTop: spacing.md },
  habitName: { ...typography.subtitle, color: colors.text.primary, marginTop: spacing.lg },
  planCard: { marginTop: spacing.lg },
  planLabel: { ...typography.label, color: colors.accent.gold },
  planText: { ...typography.bodyMedium, color: colors.text.primary, marginTop: spacing.xs },
  planSmall: { ...typography.small, color: colors.text.secondary, textAlign: 'center', marginBottom: spacing.sm },
  voiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, minHeight: 48 },
  voiceText: { ...typography.bodyMedium, color: colors.text.primary },
  waveBox: { marginTop: spacing.lg, height: 120 },
  remaining: { ...typography.label, color: colors.text.tertiary, textAlign: 'right', marginTop: spacing.xs },
  breathBox: { alignItems: 'center', justifyContent: 'center', height: 170, marginTop: spacing.md },
  breathCircle: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderColor: colors.accent.gold,
    backgroundColor: withAlpha(colors.accent.gold, 0.1),
  },
  breathText: { ...typography.subtitle, color: colors.text.primary },
  cue: { ...typography.subtitle, color: colors.text.primary, textAlign: 'center', marginTop: spacing.lg, lineHeight: 28 },
  question: { ...typography.title, color: colors.text.primary, marginTop: spacing.lg },
  chipsLabel: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
});
