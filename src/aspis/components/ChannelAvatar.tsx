import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

interface Props {
  uri?: string;
  channel: string;
  size?: number;
}

// Avatar redondo do canal com fallback para a inicial (port do .chan-icon).
export function ChannelAvatar({ uri, channel, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (!uri || failed) {
    const initial = (channel || '?').trim().charAt(0).toUpperCase() || '?';
    return (
      <View style={[styles.fallback, round]}>
        <Text style={[styles.initial, { fontSize: size * 0.43 }]}>{initial}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={round} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.bg.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.text.secondary,
  },
});
