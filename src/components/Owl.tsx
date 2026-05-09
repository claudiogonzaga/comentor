import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { OwlMood } from '../types';
import { colors } from '../theme';

interface OwlProps {
  mood?: OwlMood;
  size?: number;
  animated?: boolean;
}

const AnimatedG = Animated.createAnimatedComponent(G);

export function Owl({ mood = 'calm', size = 160, animated = true }: OwlProps) {
  const blink = useRef(new Animated.Value(1)).current;
  const float = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return;
    if (mood !== 'sleeping') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(2400),
          Animated.timing(blink, { toValue: 0, duration: 90, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [mood, animated, blink]);

  useEffect(() => {
    if (!animated) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, float]);

  useEffect(() => {
    if (!animated || mood !== 'celebrating') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkle, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(sparkle, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mood, animated, sparkle]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const sparkleOpacity = sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

  const eyesOpen = mood === 'serious' || mood === 'worried';
  const eyesClosed = mood === 'sleeping';
  const wingsOpen = mood === 'celebrating';

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ flex: 1, transform: [{ translateY }] }}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <LinearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#3D3A6B" />
              <Stop offset="1" stopColor="#2A2750" />
            </LinearGradient>
            <LinearGradient id="bellyGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#F4C553" />
              <Stop offset="1" stopColor="#D9A844" />
            </LinearGradient>
            <LinearGradient id="wingGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#4A4680" />
              <Stop offset="1" stopColor="#322F5C" />
            </LinearGradient>
          </Defs>

          {wingsOpen && (
            <>
              <Path
                d="M 50 95 Q 18 60, 28 35 Q 48 70, 68 100 Z"
                fill="url(#wingGrad)"
              />
              <Path
                d="M 150 95 Q 182 60, 172 35 Q 152 70, 132 100 Z"
                fill="url(#wingGrad)"
              />
            </>
          )}

          {/* Ear tufts */}
          <Path d="M 60 50 L 70 28 L 82 50 Z" fill="url(#bodyGrad)" />
          <Path d="M 140 50 L 130 28 L 118 50 Z" fill="url(#bodyGrad)" />

          {/* Body (head + body merged into rounded shape) */}
          <Ellipse cx="100" cy="110" rx="58" ry="62" fill="url(#bodyGrad)" />

          {/* Belly patch */}
          <Ellipse cx="100" cy="130" rx="32" ry="36" fill="url(#bellyGrad)" opacity="0.85" />

          {/* Wings (folded against body) */}
          {!wingsOpen && (
            <>
              <Path d="M 48 100 Q 38 140, 62 158 Q 60 130, 70 110 Z" fill="url(#wingGrad)" />
              <Path d="M 152 100 Q 162 140, 138 158 Q 140 130, 130 110 Z" fill="url(#wingGrad)" />
            </>
          )}

          {/* Eye discs (white) */}
          <Circle cx="78" cy="92" r="22" fill="rgba(255,255,255,0.95)" />
          <Circle cx="122" cy="92" r="22" fill="rgba(255,255,255,0.95)" />

          {/* Eyes */}
          {eyesClosed ? (
            <G>
              <Path
                d="M 60 92 Q 78 100, 96 92"
                stroke="#1B1F3B"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
              <Path
                d="M 104 92 Q 122 100, 140 92"
                stroke="#1B1F3B"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
            </G>
          ) : (
            <AnimatedG opacity={blink}>
              {/* Iris */}
              <Circle cx="78" cy="92" r={eyesOpen ? 14 : 11} fill="#F4C553" />
              <Circle cx="122" cy="92" r={eyesOpen ? 14 : 11} fill="#F4C553" />
              {/* Pupils */}
              <Circle cx={mood === 'worried' ? 80 : 78} cy="92" r="6" fill="#1B1F3B" />
              <Circle cx={mood === 'worried' ? 124 : 122} cy="92" r="6" fill="#1B1F3B" />
              {/* Highlight */}
              <Circle cx="82" cy="88" r="2" fill="rgba(255,255,255,0.9)" />
              <Circle cx="126" cy="88" r="2" fill="rgba(255,255,255,0.9)" />
            </AnimatedG>
          )}

          {/* Eyebrows for worried/serious */}
          {mood === 'worried' && (
            <G>
              <Path
                d="M 62 70 L 90 78"
                stroke="#1B1F3B"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <Path
                d="M 138 70 L 110 78"
                stroke="#1B1F3B"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </G>
          )}
          {mood === 'serious' && (
            <G>
              <Path
                d="M 60 76 L 92 70"
                stroke="#1B1F3B"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
              <Path
                d="M 140 76 L 108 70"
                stroke="#1B1F3B"
                strokeWidth="3.5"
                strokeLinecap="round"
              />
            </G>
          )}

          {/* Beak */}
          <Path
            d="M 100 108 L 92 122 L 108 122 Z"
            fill="#F4C553"
            stroke="#C99A3A"
            strokeWidth="1"
          />

          {/* Smile (calm only) */}
          {mood === 'calm' && (
            <Path
              d="M 92 130 Q 100 134, 108 130"
              stroke="rgba(27,31,59,0.4)"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* Feet */}
          <Path d="M 84 168 L 80 178 L 92 174 Z" fill="#F4C553" />
          <Path d="M 116 168 L 120 178 L 108 174 Z" fill="#F4C553" />

          {/* Sleeping zzz */}
          {mood === 'sleeping' && (
            <SvgText
              x="155"
              y="60"
              fontSize="22"
              fontWeight="bold"
              fill="rgba(255,255,255,0.7)"
            >
              z
            </SvgText>
          )}
        </Svg>

        {mood === 'celebrating' && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              inset: 0,
              opacity: sparkleOpacity,
            }}
          >
            <Svg width={size} height={size} viewBox="0 0 200 200">
              <G fill={colors.accent.gold}>
                <Path d="M 30 40 L 32 46 L 38 48 L 32 50 L 30 56 L 28 50 L 22 48 L 28 46 Z" />
                <Path d="M 170 50 L 172 56 L 178 58 L 172 60 L 170 66 L 168 60 L 162 58 L 168 56 Z" />
                <Path d="M 40 150 L 42 156 L 48 158 L 42 160 L 40 166 L 38 160 L 32 158 L 38 156 Z" />
                <Path d="M 165 145 L 167 151 L 173 153 L 167 155 L 165 161 L 163 155 L 157 153 L 163 151 Z" />
              </G>
            </Svg>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}
