// Aviso curto no pé da tela, com uma ação opcional ("Desfazer", "Refazer").
// Marcar um hábito é um toque só — e todo toque só precisa de um jeito igualmente
// fácil de voltar atrás, sem diálogo de confirmação no caminho.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';

interface SnackState {
  key: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function useSnackbar(durationMs = 4500) {
  const [state, setState] = useState<SnackState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setState(null);
    });
  }, [opacity]);

  const show = useCallback(
    (message: string, action?: { label: string; onPress: () => void }) => {
      if (timer.current) clearTimeout(timer.current);
      setState({ key: Date.now(), message, actionLabel: action?.label, onAction: action?.onPress });
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, durationMs);
    },
    [opacity, hide, durationMs],
  );

  // Sem isto o timer dispararia num componente já desmontado.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const node = state ? (
    <Animated.View
      key={state.key}
      style={[styles.bar, { opacity }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={styles.text} numberOfLines={2}>
        {state.message}
      </Text>
      {state.actionLabel ? (
        <Pressable
          onPress={() => {
            state.onAction?.();
            hide();
          }}
          hitSlop={8}
          style={styles.action}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>{state.actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  ) : null;

  return { show, hide, node };
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent.gold,
    // Sombra leve para descolar do conteúdo que rola por baixo.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  text: { ...typography.bodyMedium, color: colors.text.onGold, flex: 1 },
  action: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  actionText: { ...typography.button, color: colors.text.onGold, textDecorationLine: 'underline' },
});
