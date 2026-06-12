import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

// A coruja de Atena REDESENHADA EM PARTES (SVG), no mesmo estilo do medalhão
// original (figura negra sobre terracota, louro + greca). Por ser vetorial e
// dividida em grupos, a CABEÇA gira de verdade (pivô no pescoço), as ASAS
// levantam (pivô no ombro), os olhos piscam (pálpebras) e as pupilas olham de
// lado — sem mexer no medalhão. Geometria desenhada/aprovada num SVG estático
// (viewBox 200×200) antes de virar componente.

const BLACK = '#20140C';
const TERRA = '#C2683B';
const TERRA_LIGHT = '#BC571E';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

/** Ramo de louro: haste em arco + pares de folhas (geometria pré-computada). */
function laurelBranch(side: -1 | 1) {
  const a0 = side < 0 ? 128 : 52;
  const a1 = side < 0 ? 252 : -72;
  const steps = 26;
  const r = 77;
  const pts: [number, number, number][] = [];
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
    const x = 100 + r * Math.cos(a);
    const y = 100 + r * Math.sin(a);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    pts.push([x, y, a]);
  }
  const leaves: { x: number; y: number; deg: number }[] = [];
  for (let i = 2; i < steps; i += 3) {
    const [x, y, a] = pts[i];
    const dirSign = side < 0 ? 1 : -1;
    const tang = Math.atan2(Math.cos(a) * dirSign, -Math.sin(a) * dirSign);
    for (const off of [-0.6, 0.6]) {
      const la = tang + off;
      leaves.push({
        x: x + 8.5 * Math.cos(la),
        y: y + 8.5 * Math.sin(la),
        deg: (la * 180) / Math.PI,
      });
    }
  }
  return { d, leaves };
}

const BRANCH_L = laurelBranch(-1);
const BRANCH_R = laurelBranch(1);

/** Padrão da greca (caminho repetido). */
function meanderPath(): string {
  let d = '';
  for (let x = 60; x < 140; x += 10) d += `M${x},169 v-7 h7 v4 h-4 v-2 `;
  return d;
}
const MEANDER_D = meanderPath();

interface OwlVectorProps {
  size: number;
  asleep: boolean;
  animated: boolean;
}

export function OwlVector({ size, asleep, animated }: OwlVectorProps) {
  /** Pálpebras: raio Y de 0 (aberto) a 12 (fechado). */
  const lidRy = useRef(new Animated.Value(0)).current;
  /** Cabeça: graus de rotação (pivô no pescoço). */
  const headRot = useRef(new Animated.Value(0)).current;
  /** Pupilas: deslocamento X (-3..3). */
  const pupilDx = useRef(new Animated.Value(0)).current;
  /** Asas: graus de rotação no ombro (negativo = levanta). */
  const wingLRot = useRef(new Animated.Value(0)).current;
  const wingRRot = useRef(new Animated.Value(0)).current;

  const lively = animated && !asleep;

  useEffect(() => {
    if (asleep) {
      lidRy.setValue(12);
      headRot.setValue(0);
      pupilDx.setValue(0);
      wingLRot.setValue(0);
      wingRRot.setValue(0);
      return;
    }
    lidRy.setValue(0);
    if (!lively) return;

    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => {
      if (alive) timers.push(setTimeout(() => alive && fn(), ms));
    };
    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
      Animated.timing(v, { toValue, duration, easing, useNativeDriver: false });
    const spring = (v: Animated.Value, toValue: number) =>
      Animated.spring(v, { toValue, friction: 6, useNativeDriver: false });

    const blinkOnce = (done?: () => void) => {
      Animated.sequence([
        t(lidRy, 12, 90, Easing.in(Easing.quad)),
        Animated.delay(40),
        t(lidRy, 0, 130, Easing.out(Easing.quad)),
      ]).start(() => done?.());
    };

    // ~3 piscadas por minuto, em segundos sorteados; 30% piscada dupla.
    const scheduleBlink = () => {
      after(5000 + Math.random() * 30000, () => {
        blinkOnce(() => {
          if (Math.random() < 0.3) after(170, () => blinkOnce(scheduleBlink));
          else scheduleBlink();
        });
      });
    };

    // Girar a cabeça e voltar (a cada ~12–35s): pisca, gira até ±10° com as
    // pupilas acompanhando, segura, volta. Só a CABEÇA — o medalhão fica parado.
    const scheduleHeadTurn = () => {
      after(12000 + Math.random() * 23000, () => {
        const dir = Math.random() < 0.5 ? -1 : 1;
        blinkOnce();
        Animated.sequence([
          Animated.parallel([spring(headRot, dir * 10), spring(pupilDx, dir * 2.5)]),
          Animated.delay(500 + Math.random() * 600),
          Animated.parallel([spring(headRot, 0), spring(pupilDx, 0)]),
        ]).start(() => scheduleHeadTurn());
      });
    };

    // Levantar uma asinha (a cada ~40–90s): sobe, dá um tremidinho, desce.
    const scheduleWing = () => {
      after(40000 + Math.random() * 50000, () => {
        const left = Math.random() < 0.5;
        const wing = left ? wingLRot : wingRRot;
        const up = left ? -22 : 22; // gira para fora/cima a partir do ombro
        Animated.sequence([
          spring(wing, up),
          t(wing, up * 0.6, 140),
          t(wing, up, 140),
          Animated.delay(250),
          spring(wing, 0),
        ]).start(() => scheduleWing());
      });
    };

    scheduleBlink();
    scheduleHeadTurn();
    scheduleWing();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      [lidRy, headRot, pupilDx, wingLRot, wingRRot].forEach((v) => {
        v.stopAnimation();
      });
      lidRy.setValue(0);
      headRot.setValue(0);
      pupilDx.setValue(0);
      wingLRot.setValue(0);
      wingRRot.setValue(0);
    };
  }, [lively, asleep, lidRy, headRot, pupilDx, wingLRot, wingRRot]);

  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" opacity={asleep ? 0.82 : 1}>
      {/* Medalhão */}
      <Circle cx={100} cy={100} r={98} fill={BLACK} />
      <Circle cx={100} cy={100} r={91} fill={TERRA} />

      {/* Coroa de louro */}
      <Path d={BRANCH_L.d} stroke={BLACK} strokeWidth={2} fill="none" />
      {BRANCH_L.leaves.map((l, i) => (
        <Ellipse
          key={`l${i}`}
          cx={l.x}
          cy={l.y}
          rx={5.6}
          ry={2.2}
          fill={BLACK}
          transform={`rotate(${l.deg.toFixed(0)} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`}
        />
      ))}
      <Path d={BRANCH_R.d} stroke={BLACK} strokeWidth={2} fill="none" />
      {BRANCH_R.leaves.map((l, i) => (
        <Ellipse
          key={`r${i}`}
          cx={l.x}
          cy={l.y}
          rx={5.6}
          ry={2.2}
          fill={BLACK}
          transform={`rotate(${l.deg.toFixed(0)} ${l.x.toFixed(1)} ${l.y.toFixed(1)})`}
        />
      ))}

      {/* Greca (poleiro) */}
      <Rect x={56} y={158} width={88} height={14} fill={BLACK} />
      <Path d={MEANDER_D} stroke={TERRA} strokeWidth={1.5} fill="none" />

      {/* Cauda + patas (no vão terracota, pousadas na greca) */}
      <Path d="M94,140 L106,140 L104,156 L96,156 Z" fill={BLACK} />
      <Path
        d="M92,144 L90,156 M108,144 L110,156"
        stroke={BLACK}
        strokeWidth={3.2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M90,155 l-5,3 M90,155 l-1,4 M90,155 l4,3 M110,155 l5,3 M110,155 l1,4 M110,155 l-4,3"
        stroke={BLACK}
        strokeWidth={2.2}
        strokeLinecap="round"
        fill="none"
      />

      {/* Corpo + penas do peito */}
      <Path
        d="M100,86 C80,88 73,104 74,124 C75,138 85,146 100,146 C115,146 125,138 126,124 C127,104 120,88 100,86 Z"
        fill={BLACK}
      />
      <Path
        d="M90,102 q4,4 8,0 q4,4 8,0 q4,4 7,0 M87,112 q4,4 8,0 q4,4 8,0 q4,4 8,0 M87,122 q4,4 8,0 q4,4 8,0 q4,4 8,0 M90,132 q4,4 8,0 q4,4 8,0 M95,139 q4,4 9,0"
        stroke={TERRA}
        strokeWidth={1.5}
        fill="none"
      />

      {/* Asa esquerda (pivô no ombro 82,98) */}
      <AnimatedG rotation={wingLRot as unknown as number} origin="82,98">
        <Path
          d="M80,96 C66,104 62,122 68,139 C72,144 79,143 83,137 C76,125 77,108 82,98 Z"
          fill={BLACK}
          stroke={TERRA}
          strokeWidth={1.6}
        />
        <Path
          d="M71,110 q6,2 9,-1 M69,121 q7,2 10,-1 M70,132 q6,2 9,-1"
          stroke={TERRA}
          strokeWidth={1.3}
          fill="none"
        />
      </AnimatedG>

      {/* Asa direita (pivô no ombro 118,98) */}
      <AnimatedG rotation={wingRRot as unknown as number} origin="118,98">
        <Path
          d="M120,96 C134,104 138,122 132,139 C128,144 121,143 117,137 C124,125 123,108 118,98 Z"
          fill={BLACK}
          stroke={TERRA}
          strokeWidth={1.6}
        />
        <Path
          d="M129,110 q-6,2 -9,-1 M131,121 q-7,2 -10,-1 M130,132 q-6,2 -9,-1"
          stroke={TERRA}
          strokeWidth={1.3}
          fill="none"
        />
      </AnimatedG>

      {/* Cabeça inteira gira no pescoço (origin 100,88) */}
      <AnimatedG rotation={headRot as unknown as number} origin="100,88">
        <Path
          d="M72,62 C72,44 86,38 100,38 C114,38 128,44 128,62 C128,80 116,90 100,90 C84,90 72,80 72,62 Z"
          fill={BLACK}
        />
        {/* tufos */}
        <Path d="M80,47 L74,35 L89,42 Z" fill={BLACK} />
        <Path d="M120,47 L126,35 L111,42 Z" fill={BLACK} />
        {/* V da testa (suave) */}
        <Path d="M90,52 L100,59 L110,52" stroke={TERRA} strokeWidth={1.6} fill="none" />
        {/* olhos: íris clara + pupila que olha de lado */}
        <Circle cx={86} cy={66} r={11} fill={TERRA_LIGHT} />
        <Circle cx={114} cy={66} r={11} fill={TERRA_LIGHT} />
        <AnimatedG x={pupilDx as unknown as number}>
          <Circle cx={86} cy={66} r={5.5} fill={BLACK} />
          <Circle cx={114} cy={66} r={5.5} fill={BLACK} />
        </AnimatedG>
        {/* bico */}
        <Path d="M100,70 L96.5,75 L100,82 L103.5,75 Z" fill={TERRA} />
        {/* pálpebras (fecham por cima dos olhos) */}
        <AnimatedEllipse cx={86} cy={66} rx={12} ry={lidRy as unknown as number} fill={BLACK} />
        <AnimatedEllipse cx={114} cy={66} rx={12} ry={lidRy as unknown as number} fill={BLACK} />
      </AnimatedG>
    </Svg>
  );
}
