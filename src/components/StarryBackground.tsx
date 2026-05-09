import { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { colors } from '../theme';

interface StarryBackgroundProps {
  showMoon?: boolean;
  density?: number;
}

const { width, height } = Dimensions.get('window');

const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

export function StarryBackground({ showMoon = true, density = 60 }: StarryBackgroundProps) {
  const stars = useMemo(
    () =>
      Array.from({ length: density }, (_, i) => ({
        cx: seededRandom(i * 1.7) * width,
        cy: seededRandom(i * 2.3) * height,
        r: 0.6 + seededRandom(i * 3.1) * 1.4,
        opacity: 0.25 + seededRandom(i * 4.9) * 0.55,
      })),
    [density],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[colors.bg.primary, colors.bg.gradientEnd]}
        style={StyleSheet.absoluteFill}
      />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="moon" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFE9B0" stopOpacity="0.95" />
            <Stop offset="0.6" stopColor="#F4C553" stopOpacity="0.7" />
            <Stop offset="1" stopColor="#F4C553" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {stars.map((s, i) => (
          <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={colors.star} opacity={s.opacity} />
        ))}
        {showMoon && (
          <>
            <Circle cx={width - 60} cy={120} r="80" fill="url(#moon)" opacity="0.35" />
            <Circle cx={width - 60} cy={120} r="32" fill="#FFE9B0" opacity="0.85" />
            <Circle cx={width - 50} cy={112} r="30" fill={colors.bg.primary} opacity="0.95" />
          </>
        )}
      </Svg>
    </View>
  );
}
