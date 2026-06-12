import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import type { OwlMood } from '../types';
import { useAppStore } from '../store/useAppStore';
import { OwlVector } from './OwlVector';

// A Comentora é a coruja de Atena num medalhão de vaso grego — agora DESENHADA
// EM PARTES (OwlVector, SVG): a cabeça gira de verdade, as asas levantam, os
// olhos piscam (~3×/min) e as pupilas olham de lado. Este wrapper cuida da
// flutuação suave e do estado de SONO: depois do horário de dormir (config) e
// até as 6h — ou quando o mood é 'sleeping' — ela fica de olhos fechados.

/** Estamos na janela de sono? (horário de dormir → 6h da manhã, hora local) */
function isSleepWindowNow(bedtime: string | null | undefined): boolean {
  if (!bedtime) return false;
  const [h, m] = bedtime.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(h)) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = h * 60 + (Number.isFinite(m) ? m : 0);
  const end = 6 * 60; // acorda às 6h
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

interface OwlProps {
  mood?: OwlMood;
  size?: number;
  animated?: boolean;
}

export function Owl({ mood = 'calm', size = 160, animated = true }: OwlProps) {
  const { config } = useAppStore();
  const float = useRef(new Animated.Value(0)).current;

  // Re-avalia a janela de sono a cada minuto (com a tela ligada).
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const asleep = mood === 'sleeping' || isSleepWindowNow(config?.bedtime);
  const lively = animated && !asleep;

  useEffect(() => {
    if (!lively) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [lively, float]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY }] }}>
      <OwlVector size={size} asleep={asleep} animated={animated} />
    </Animated.View>
  );
}
