import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing, typography } from '../theme';

interface Props {
  state: 'idle' | 'listening' | 'processing';
  onPressIn: () => void;
  onPressOut: () => void;
  onCancel?: () => void;
  hint?: string;
}

export function MicButton({ state, onPressIn, onPressOut, hint }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state === 'listening') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 600,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
  }, [state, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.0, 0.55] });

  return (
    <View style={styles.wrap}>
      <View style={styles.btnWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              transform: [{ scale }],
              opacity: ringOpacity,
            },
          ]}
        />
        <Pressable
          onPressIn={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onPressIn();
          }}
          onPressOut={() => {
            Haptics.selectionAsync();
            onPressOut();
          }}
          disabled={state === 'processing'}
          style={({ pressed }) => [
            styles.btn,
            state === 'listening' && styles.btnActive,
            state === 'processing' && styles.btnProcessing,
            pressed && state === 'idle' && { transform: [{ scale: 0.95 }] },
          ]}
        >
          <Text style={styles.icon}>
            {state === 'processing' ? '...' : '🎤'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.label}>
        {state === 'listening'
          ? 'Falando... solte para enviar'
          : state === 'processing'
            ? 'Processando...'
            : hint ?? 'Segure para falar com a Corujinha'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  btnWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.18)',
  },
  btn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.bg.surfaceStrong,
    borderWidth: 2,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: colors.accent.gold,
  },
  btnProcessing: {
    opacity: 0.6,
  },
  icon: { fontSize: 32 },
  label: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
