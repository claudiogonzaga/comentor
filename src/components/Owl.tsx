import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import type { OwlMood } from '../types';

// A Comentora é representada pela coruja de Atena num medalhão de vaso grego
// (figura negra sobre terracota, cercada por louro e meandro). A imagem é um
// emblema fixo; a vida vem de animações por cima: flutuação suave e PISCADAS
// raras e aleatórias (pálpebras desenhadas sobre os olhos) — raras de
// propósito, pra deixar a dúvida se ela pisca ou não. Dormindo, fica de olhos
// fechados. (Girar só a cabeça não dá: a arte é uma imagem única.)

const MASCOT = require('../../assets/owl-mascot.png');

// Geometria dos olhos MEDIDA no owl-mascot.png (943×943): centros das pupilas
// em (418,319) e (526,319); pupila r≈24, íris clara r≈26–40, anel externo
// escuro r≈42–48. As frações abaixo posicionam as pálpebras em qualquer size.
const EYE_LEFT_X = 0.4433;
const EYE_RIGHT_X = 0.5578;
const EYE_Y = 0.3383;
/** Raio da pálpebra (cobre pupila + íris + borda do anel): 49/943. */
const LID_R = 0.052;
/** Cor da pálpebra — plumagem da cabeça amostrada entre os olhos. */
const LID_COLOR = '#4C2812';

interface OwlProps {
  mood?: OwlMood;
  size?: number;
  animated?: boolean;
}

export function Owl({ mood = 'calm', size = 160, animated = true }: OwlProps) {
  const float = useRef(new Animated.Value(0)).current;
  /** 0 = olhos abertos, 1 = fechados (escala Y das pálpebras). */
  const lid = useRef(new Animated.Value(0)).current;
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

  // Vida da coruja: piscadas em intervalos aleatórios (às vezes dupla) e, mais
  // raramente, uma inclinação curiosa de cabeça acompanhada de uma piscada.
  // Dormindo: pálpebras fechadas, sem timers.
  useEffect(() => {
    if (asleep) {
      lid.setValue(1);
      return;
    }
    lid.setValue(0);
    if (!lively) return;

    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      if (alive) timers.push(setTimeout(() => alive && fn(), ms));
    };

    const blinkOnce = (done?: () => void) => {
      Animated.sequence([
        Animated.timing(lid, {
          toValue: 1,
          duration: 90,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(40),
        Animated.timing(lid, {
          toValue: 0,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start(() => done?.());
    };

    // Piscar RARO, pra deixar a dúvida se ela pisca ou não: cada piscada cai
    // num segundo sorteado (≈4–60s; média ~2 por minuto), às vezes dupla.
    const scheduleBlink = () => {
      after(4000 + Math.random() * 56000, () => {
        blinkOnce(() => {
          if (Math.random() < 0.35) after(170, () => blinkOnce(scheduleBlink));
          else scheduleBlink();
        });
      });
    };

    scheduleBlink();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      lid.stopAnimation();
      lid.setValue(0);
    };
  }, [lively, asleep, lid]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const lidR = size * LID_R;
  const eyelid = (cxFrac: number) => (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: size * cxFrac - lidR,
        top: size * EYE_Y - lidR,
        width: lidR * 2,
        height: lidR * 2,
        borderRadius: lidR,
        backgroundColor: LID_COLOR,
        transform: [{ scaleY: lid }],
      }}
    />
  );

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY }] }}>
      <Image
        source={MASCOT}
        resizeMode="contain"
        style={{ width: size, height: size, opacity: asleep ? 0.78 : 1 }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
        {eyelid(EYE_LEFT_X)}
        {eyelid(EYE_RIGHT_X)}
      </View>
    </Animated.View>
  );
}
