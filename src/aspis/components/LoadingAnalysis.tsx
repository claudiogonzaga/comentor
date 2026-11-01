// Estado de carregamento da análise (~5–20 s): escudo pulsando + fase atual.
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Image, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';

export type LoadingPhase = 'meta' | 'video' | 'captions' | 'metadata';

const PHASE_TEXT: Record<LoadingPhase, { title: string; hint: string }> = {
  meta: { title: 'Buscando o vídeo…', hint: 'título, canal e duração' },
  video: { title: 'A IA está assistindo o vídeo…', hint: 'isso leva de 10 a 30 segundos' },
  captions: { title: 'Lendo a transcrição…', hint: 'legendas públicas do vídeo' },
  metadata: { title: 'Analisando pelos metadados…', hint: 'vídeo sem transcrição acessível' },
};

interface Props {
  phase: LoadingPhase;
  title?: string; // título do vídeo, quando já conhecido
}

export function LoadingAnalysis({ phase, title }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const t = PHASE_TEXT[phase];
  return (
    <View style={styles.root}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Image source={require('../../../assets/aspis/logo-mark.png')} style={styles.shield} />
      </Animated.View>
      {title ? (
        <Text style={styles.videoTitle} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      <ActivityIndicator color={colors.accent.gold} style={{ marginTop: spacing.lg }} />
      <Text style={styles.phase}>{t.title}</Text>
      <Text style={styles.hint}>{t.hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  shield: { width: 110, height: 110, borderRadius: 55 },
  videoTitle: {
    ...typography.subtitle,
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  phase: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
