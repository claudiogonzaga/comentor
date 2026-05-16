import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';
import type { OwlMood } from '../types';

// A Comentora é representada por uma coruja "de rede": uma malha de nós e
// arestas que, juntos, desenham a silhueta de uma coruja. A ideia é algo
// etéreo e levemente artificial — como as imagens de enxames de estorninhos
// ou cardumes estudadas em sistemas complexos. A malha cintila suavemente
// (cada grupo de nós pisca numa fase diferente) e o conjunto flutua devagar.

interface OwlProps {
  mood?: OwlMood;
  size?: number;
  animated?: boolean;
}

const AnimatedG = Animated.createAnimatedComponent(G);

type NodeKind = 'body' | 'tuft' | 'eye' | 'pupil' | 'beak' | 'inner';

interface GraphNode {
  x: number;
  y: number;
  r: number;
  op: number;
  kind: NodeKind;
  group: number;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EYE_L = { cx: 74, cy: 95, r: 24 };
const EYE_R = { cx: 126, cy: 95, r: 24 };
const BODY = { cx: 100, cy: 116, rx: 60, ry: 66 };

/** Builds the owl-shaped node/edge graph once, deterministically. */
function buildGraph() {
  const rng = mulberry32(7);
  const nodes: GraphNode[] = [];
  const edges: [number, number][] = [];

  const push = (x: number, y: number, r: number, kind: NodeKind): number => {
    nodes.push({ x, y, r, op: 0.6 + rng() * 0.4, kind, group: Math.floor(rng() * 3) });
    return nodes.length - 1;
  };

  // Body — egg-shaped outline.
  const BODY_N = 26;
  const bodyIdx: number[] = [];
  for (let i = 0; i < BODY_N; i++) {
    const a = (i / BODY_N) * Math.PI * 2 - Math.PI / 2;
    const j = 0.93 + rng() * 0.13;
    bodyIdx.push(
      push(
        BODY.cx + Math.cos(a) * BODY.rx * j,
        BODY.cy + Math.sin(a) * BODY.ry * j,
        1.6 + rng() * 1.1,
        'body',
      ),
    );
  }
  for (let i = 0; i < BODY_N; i++) {
    edges.push([bodyIdx[i], bodyIdx[(i + 1) % BODY_N]]);
  }

  // Ear tufts — two triangular clusters above the head.
  const tuft = (corners: [number, number][]) => {
    const idx = corners.map(([x, y]) => push(x, y, 1.5 + rng() * 0.8, 'tuft'));
    for (let e = 0; e < 3; e++) {
      const [x1, y1] = corners[e];
      const [x2, y2] = corners[(e + 1) % 3];
      idx.push(push((x1 + x2) / 2, (y1 + y2) / 2, 1.3 + rng() * 0.7, 'tuft'));
    }
    const order = [idx[0], idx[3], idx[1], idx[4], idx[2], idx[5]];
    for (let i = 0; i < order.length; i++) {
      edges.push([order[i], order[(i + 1) % order.length]]);
    }
  };
  tuft([[60, 22], [44, 66], [86, 60]]);
  tuft([[140, 22], [156, 66], [114, 60]]);

  // Eyes — two rings of nodes with a bright pupil at the centre.
  const eye = (e: { cx: number; cy: number; r: number }) => {
    const N = 12;
    const ring: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      ring.push(
        push(e.cx + Math.cos(a) * e.r, e.cy + Math.sin(a) * e.r, 1.5 + rng() * 0.7, 'eye'),
      );
    }
    for (let i = 0; i < N; i++) edges.push([ring[i], ring[(i + 1) % N]]);
    const pupil = push(e.cx, e.cy, 3.6, 'pupil');
    for (let i = 0; i < N; i += 3) edges.push([pupil, ring[i]]);
    return { ring, pupil };
  };
  const le = eye(EYE_L);
  const re = eye(EYE_R);

  // Beak — a small diamond between and below the eyes.
  const beak = [
    push(100, 106, 1.8, 'beak'),
    push(92, 117, 1.5, 'beak'),
    push(100, 130, 2, 'beak'),
    push(108, 117, 1.5, 'beak'),
  ];
  for (let i = 0; i < 4; i++) edges.push([beak[i], beak[(i + 1) % 4]]);

  // Inner scatter — nodes that fill the body, giving the "network" density.
  const innerIdx: number[] = [];
  let tries = 0;
  while (innerIdx.length < 22 && tries < 600) {
    tries++;
    const x = BODY.cx + (rng() * 2 - 1) * BODY.rx * 0.92;
    const y = BODY.cy + (rng() * 2 - 1) * BODY.ry * 0.92;
    const dx = (x - BODY.cx) / BODY.rx;
    const dy = (y - BODY.cy) / BODY.ry;
    if (dx * dx + dy * dy > 0.88) continue;
    const nearEye =
      Math.hypot(x - EYE_L.cx, y - EYE_L.cy) < EYE_L.r + 3 ||
      Math.hypot(x - EYE_R.cx, y - EYE_R.cy) < EYE_R.r + 3;
    if (nearEye) continue;
    innerIdx.push(push(x, y, 1.1 + rng() * 1.4, 'inner'));
  }

  // Proximity edges — wire body/inner/tuft/beak nodes to nearest neighbours.
  const pool = nodes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.kind !== 'eye' && n.kind !== 'pupil');
  const seen = new Set<string>();
  const mark = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  for (const { n, i } of pool) {
    const near = pool
      .filter((o) => o.i !== i)
      .map((o) => ({ i: o.i, d: Math.hypot(o.n.x - n.x, o.n.y - n.y) }))
      .sort((a, b) => a.d - b.d);
    let added = 0;
    for (const { i: j, d } of near) {
      if (added >= 2 || d > 38) break;
      if (mark(i, j)) edges.push([i, j]);
      added++;
    }
  }

  // Bridge edges — tie each eye ring into the surrounding mesh so the whole
  // owl reads as one connected network rather than floating rings.
  const bridgeTargets = [...bodyIdx, ...innerIdx];
  const bridge = (ring: number[]) => {
    for (let k = 0; k < ring.length; k += 3) {
      const rn = nodes[ring[k]];
      let best = -1;
      let bd = Infinity;
      for (const t of bridgeTargets) {
        const d = Math.hypot(nodes[t].x - rn.x, nodes[t].y - rn.y);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best >= 0 && mark(ring[k], best)) edges.push([ring[k], best]);
    }
  };
  bridge(le.ring);
  bridge(re.ring);

  return { nodes, edges, pupils: [le.pupil, re.pupil] };
}

const GRAPH = buildGraph();

// Sparks shown around the owl when celebrating.
const SPARKS = [
  { x: 28, y: 54 },
  { x: 174, y: 62 },
  { x: 22, y: 140 },
  { x: 180, y: 134 },
  { x: 100, y: 16 },
  { x: 150, y: 178 },
];

const MOOD_COLOR: Record<OwlMood, { eye: string; tint: string }> = {
  calm: { eye: '#F4C553', tint: '#8E8AC8' },
  worried: { eye: '#F0B765', tint: '#9A86C0' },
  serious: { eye: '#FFD56A', tint: '#7E7AB6' },
  sleeping: { eye: '#6E6A9E', tint: '#5C5990' },
  celebrating: { eye: '#FFDC7A', tint: '#B7A0E0' },
};

const GOLD = '#F4C553';

function nodeColor(kind: NodeKind, tint: string): string {
  return kind === 'tuft' || kind === 'inner' ? tint : GOLD;
}

export function Owl({ mood = 'calm', size = 160, animated = true }: OwlProps) {
  const float = useRef(new Animated.Value(0)).current;
  const twinkle = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  const edgePulse = useRef(new Animated.Value(0)).current;

  const asleep = mood === 'sleeping';
  const lively = animated && !asleep;

  useEffect(() => {
    if (!animated) return;
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
  }, [animated, float]);

  useEffect(() => {
    if (!lively) return;
    const fast = mood === 'celebrating';
    const durations = fast ? [900, 1200, 1500] : [1900, 2500, 3100];
    const loops = twinkle.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, {
            toValue: 1,
            duration: durations[i],
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: durations[i],
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    const edge = Animated.loop(
      Animated.sequence([
        Animated.timing(edgePulse, {
          toValue: 1,
          duration: 4200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(edgePulse, {
          toValue: 0,
          duration: 4200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loops.forEach((l) => l.start());
    edge.start();
    return () => {
      loops.forEach((l) => l.stop());
      edge.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lively, mood]);

  const mc = MOOD_COLOR[mood];
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const groupOpacity = twinkle.map((v) =>
    v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
  );
  const edgeOpacity = edgePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.14, 0.32],
  });
  const staticGroup = asleep ? 0.55 : 0.82;

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ flex: 1, transform: [{ translateY }] }}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          {/* Network edges */}
          <AnimatedG opacity={lively ? edgeOpacity : asleep ? 0.12 : 0.22}>
            {GRAPH.edges.map(([a, b], i) => (
              <Line
                key={i}
                x1={GRAPH.nodes[a].x}
                y1={GRAPH.nodes[a].y}
                x2={GRAPH.nodes[b].x}
                y2={GRAPH.nodes[b].y}
                stroke={mc.tint}
                strokeWidth={0.85}
                strokeLinecap="round"
              />
            ))}
          </AnimatedG>

          {/* Soft halo behind each pupil */}
          {GRAPH.pupils.map((p) => (
            <Circle
              key={`halo-${p}`}
              cx={GRAPH.nodes[p].x}
              cy={GRAPH.nodes[p].y}
              r={9}
              fill={mc.eye}
              opacity={asleep ? 0.12 : 0.26}
            />
          ))}

          {/* Nodes — split into three groups that twinkle out of phase */}
          {[0, 1, 2].map((g) => (
            <AnimatedG key={g} opacity={lively ? groupOpacity[g] : staticGroup}>
              {GRAPH.nodes.map((n, i) =>
                n.group === g && n.kind !== 'pupil' ? (
                  <Circle
                    key={i}
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill={nodeColor(n.kind, mc.tint)}
                    opacity={n.op}
                  />
                ) : null,
              )}
            </AnimatedG>
          ))}

          {/* Pupils on top */}
          {GRAPH.pupils.map((p) => (
            <Circle
              key={`pupil-${p}`}
              cx={GRAPH.nodes[p].x}
              cy={GRAPH.nodes[p].y}
              r={GRAPH.nodes[p].r}
              fill={mc.eye}
              opacity={asleep ? 0.5 : 1}
            />
          ))}

          {/* Celebration sparks */}
          {mood === 'celebrating' &&
            SPARKS.map((s, i) => (
              <AnimatedG key={`spark-${i}`} opacity={lively ? groupOpacity[i % 3] : 0.7}>
                <Circle cx={s.x} cy={s.y} r={2.4} fill={mc.eye} />
              </AnimatedG>
            ))}
        </Svg>
      </Animated.View>
    </View>
  );
}
