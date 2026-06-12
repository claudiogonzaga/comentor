import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import type { OwlMood } from '../types';
import { useAppStore } from '../store/useAppStore';

// A Comentora é representada pela coruja de Atena num medalhão de vaso grego
// (figura negra sobre terracota, cercada por louro e meandro). A ARTE ORIGINAL
// É INTOCÁVEL — toda a vida vem de camadas desenhadas POR CIMA dela, com
// posições medidas pixel a pixel no PNG:
//  - flutuação suave (sempre);
//  - PISCADAS (~3 por minuto, em segundos sorteados, às vezes dupla);
//  - olhar de lado e voltar: pupilas desenhadas deslizam (o emblema NÃO se
//    move — sem balanço, a pedido);
//  - DORMIR: depois do horário de dormir (config) e até as 6h, ou quando o
//    mood é 'sleeping', ela fica de olhos fechados e esmaecida.
// Girar a cabeça / levantar asa exigiria redesenhar a arte em partes — o
// redesenho foi testado (v1.61) e DESCARTADO: o design original prevalece.

const MASCOT = require('../../assets/owl-mascot.png');

// Geometria dos olhos MEDIDA no owl-mascot.png (943×943): centros das pupilas
// em (418,319) e (526,319); pupila r≈24, íris clara r≈26–40, anel externo
// escuro r≈42–48. As frações posicionam pálpebras/pupilas em qualquer size.
const EYE_LEFT_X = 0.4433;
const EYE_RIGHT_X = 0.5578;
const EYE_Y = 0.3383;
/** Raio da pálpebra (cobre pupila + íris + borda do anel): 49/943. */
const LID_R = 0.052;
/** Disco de íris desenhado durante o olhar (cobre a pupila real): 31/943. */
const IRIS_R = 0.0329;
/** Pupila falsa (menor que a real, para deslizar dentro da íris): 21/943. */
const PUPIL_R = 0.0223;
/** Quanto a pupila desliza ao olhar de lado (fração do size). */
const GAZE_SHIFT = 0.011;
// Cores amostradas pixel a pixel no PNG.
const LID_COLOR = '#4C2812'; // plumagem da cabeça
const IRIS_COLOR = '#BC571E'; // anel claro do olho
const PUPIL_COLOR = '#131210'; // pupila

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
  /** 0 = olhos abertos, 1 = fechados (escala Y das pálpebras). */
  const lid = useRef(new Animated.Value(0)).current;
  /** -1..1 → direção do olhar (só as pupilas; o emblema não se move). */
  const gaze = useRef(new Animated.Value(0)).current;
  /** 0/1 → mostra os olhos desenhados só DURANTE o olhar (senão fica o PNG). */
  const gazeOn = useRef(new Animated.Value(0)).current;

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

  // Vida da coruja: piscadas (~3/min) e, de vez em quando, um olhar de lado.
  // Dormindo: pálpebras fechadas, nada de timers.
  useEffect(() => {
    if (asleep) {
      lid.setValue(1);
      gaze.setValue(0);
      gazeOn.setValue(0);
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

    // ~3 piscadas por minuto: a próxima cai num segundo sorteado (5–35s).
    const scheduleBlink = () => {
      after(5000 + Math.random() * 30000, () => {
        blinkOnce(() => {
          if (Math.random() < 0.3) after(170, () => blinkOnce(scheduleBlink));
          else scheduleBlink();
        });
      });
    };

    // Olhar de lado e voltar (a cada ~12–35s): pisca, os olhos desenhados
    // aparecem e as pupilas deslizam pro lado, seguram um instante e voltam.
    // O EMBLEMA NÃO SE MOVE.
    const scheduleGaze = () => {
      after(12000 + Math.random() * 23000, () => {
        const dir = Math.random() < 0.5 ? -1 : 1;
        blinkOnce();
        Animated.sequence([
          Animated.timing(gazeOn, { toValue: 1, duration: 80, useNativeDriver: true }),
          Animated.spring(gaze, { toValue: dir, friction: 6, useNativeDriver: true }),
          Animated.delay(500 + Math.random() * 500),
          Animated.spring(gaze, { toValue: 0, friction: 6, useNativeDriver: true }),
          Animated.timing(gazeOn, { toValue: 0, duration: 120, useNativeDriver: true }),
        ]).start(() => scheduleGaze());
      });
    };

    scheduleBlink();
    scheduleGaze();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      lid.stopAnimation();
      gaze.stopAnimation();
      gazeOn.stopAnimation();
      lid.setValue(0);
      gaze.setValue(0);
      gazeOn.setValue(0);
    };
  }, [lively, asleep, lid, gaze, gazeOn]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const pupilShift = gaze.interpolate({
    inputRange: [-1, 1],
    outputRange: [-size * GAZE_SHIFT, size * GAZE_SHIFT],
  });

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

  const irisR = size * IRIS_R;
  const pupilR = size * PUPIL_R;
  const drawnEye = (cxFrac: number) => (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: size * cxFrac - irisR,
        top: size * EYE_Y - irisR,
        width: irisR * 2,
        height: irisR * 2,
        borderRadius: irisR,
        backgroundColor: IRIS_COLOR,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          width: pupilR * 2,
          height: pupilR * 2,
          borderRadius: pupilR,
          backgroundColor: PUPIL_COLOR,
          transform: [{ translateX: pupilShift }],
        }}
      />
    </View>
  );

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY }] }}>
      <Image
        source={MASCOT}
        resizeMode="contain"
        style={{ width: size, height: size, opacity: asleep ? 0.78 : 1 }}
      />
      {/* Olhos desenhados — visíveis só durante o olhar de lado. */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, opacity: gazeOn }}
      >
        {drawnEye(EYE_LEFT_X)}
        {drawnEye(EYE_RIGHT_X)}
      </Animated.View>
      {/* Pálpebras por último: cobrem tudo ao piscar/dormir. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
        {eyelid(EYE_LEFT_X)}
        {eyelid(EYE_RIGHT_X)}
      </View>
    </Animated.View>
  );
}
