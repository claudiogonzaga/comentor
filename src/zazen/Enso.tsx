// O ensō a pincel. Parado: inteiro e quieto. Na preparação: só a gota de tinta
// onde o pincel vai pousar, pulsando muito devagar. Sentado: o traço pintado até
// a fração do tempo já sentada, do topo, no sentido horário.

import { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { PALETA, type Paleta } from './arte';
import { ensoCaminhos, gota, misturar, pousoDoPincel } from './pincel';

export type EnsoModo = 'inteiro' | 'pintando' | 'ponto';

/** O traço só é refeito a cada 1/720 do círculo: meio grau, invisível a olho. */
const DEGRAUS = 720;

function Traco({ size, frac, p }: { size: number; frac: number; p: Paleta }) {
  const passo = Math.round(Math.max(0, Math.min(1, frac)) * DEGRAUS);
  const c = useMemo(() => ensoCaminhos(size, passo / DEGRAUS), [size, passo]);
  const tons = useMemo(() => c.fios.map((x) => misturar(p.tinta, p.papel, 1 - x.tom)), [c, p]);
  return (
    <Svg width={size} height={size}>
      <G>
        {c.lavados.map((d, i) => (
          <Path key={`l${i}`} d={d} fill={p.tinta} fillOpacity={p.noturno ? 0.03 : 0.035} />
        ))}
      </G>
      {!!c.corpo && <Path d={c.corpo} fill={p.corpo} />}
      {c.fios.map((x, i) => (
        <Path key={`f${i}`} d={x.d} fill={tons[i]} />
      ))}
      {c.nucleos && <Path d={c.nucleos[0]} fill={p.meio} />}
      {c.nucleos && <Path d={c.nucleos[1]} fill={p.tinta} />}
    </Svg>
  );
}

/** A gota da preparação: respira em uns 5 segundos, quase parada. */
function Gota({ size, p }: { size: number; p: Paleta }) {
  const pulso = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulso, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulso]);
  const { x, y, r } = pousoDoPincel(size);
  const caixa = r * 3.2;
  const d = useMemo(() => gota(caixa / 2, caixa / 2, r), [caixa, r]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - caixa / 2,
        top: y - caixa / 2,
        width: caixa,
        height: caixa,
        opacity: pulso.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.92] }),
        transform: [{ scale: pulso.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.06] }) }],
      }}
    >
      <Svg width={caixa} height={caixa}>
        <Path d={gota(caixa / 2, caixa / 2, r * 1.35)} fill={p.tinta} fillOpacity={0.06} />
        <Path d={d} fill={p.tinta} />
      </Svg>
    </Animated.View>
  );
}

export const Enso = memo(function Enso({
  size,
  modo,
  frac,
  p = PALETA,
}: {
  size: number;
  modo: EnsoModo;
  frac: number;
  p?: Paleta;
}) {
  return (
    <View style={[styles.caixa, { width: size, height: size }]} pointerEvents="none">
      {modo === 'ponto' ? (
        <Gota size={size} p={p} />
      ) : (
        // Logo depois do primeiro sino já há o pouso do pincel: a gota vira traço, sem vazio.
        <Traco size={size} frac={modo === 'inteiro' ? 1 : Math.max(frac, 0.004)} p={p} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  caixa: { position: 'relative' },
});
