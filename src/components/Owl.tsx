import { useEffect, useRef } from 'react';
import { Animated, Easing, Image } from 'react-native';
import type { OwlMood } from '../types';

// A Comentora é representada pela coruja de Atena num medalhão de vaso grego
// (figura negra sobre terracota, cercada por louro e meandro). A imagem é um
// emblema fixo; quando animada, flutua suavemente.

const MASCOT = require('../../assets/owl-mascot.png');

interface OwlProps {
  mood?: OwlMood;
  size?: number;
  animated?: boolean;
}

export function Owl({ mood = 'calm', size = 160, animated = true }: OwlProps) {
  const float = useRef(new Animated.Value(0)).current;
  const asleep = mood === 'sleeping';
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
      <Image
        source={MASCOT}
        resizeMode="contain"
        style={{ width: size, height: size, opacity: asleep ? 0.78 : 1 }}
      />
    </Animated.View>
  );
}
