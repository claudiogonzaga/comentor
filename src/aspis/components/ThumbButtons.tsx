// 👍/👎 de cada vídeo sugerido, em figura negra. Cada toque treina a rede local.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';

import * as db from '../services/db';
import { learnThumb } from '../services/neural';
import { colors } from '../theme';
import type { VideoRecord } from '../types';

const THUMB =
  'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z';

function ThumbIcon({ down, on }: { down?: boolean; on: boolean }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" style={down ? { transform: [{ rotate: '180deg' }] } : undefined}>
      <Path
        d={THUMB}
        fill={on ? colors.text.primary : 'none'}
        stroke={colors.text.primary}
        strokeWidth={on ? 0 : 1.6}
        opacity={on ? 1 : 0.55}
      />
    </Svg>
  );
}

export function ThumbButtons({ video }: { video: VideoRecord }) {
  const [value, setValue] = useState<number>(() => db.getThumbValue(video.video_id));

  const mark = (next: 1 | -1) => {
    const final = value === next ? 0 : next;
    setValue(final);
    Haptics.selectionAsync();
    // 👎 sai do feed na próxima vez que a lista recarregar; até lá, dá para voltar atrás.
    if (final === -1) db.skipVideo(video.video_id);
    else db.unskipVideo(video.video_id);
    learnThumb(video, final);
  };

  return (
    <View style={styles.col}>
      <Pressable
        onPress={() => mark(1)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Gostei desta sugestão"
        accessibilityState={{ selected: value === 1 }}
        style={styles.btn}
      >
        <ThumbIcon on={value === 1} />
      </Pressable>
      <Pressable
        onPress={() => mark(-1)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Não gostei desta sugestão"
        accessibilityState={{ selected: value === -1 }}
        style={styles.btn}
      >
        <ThumbIcon down on={value === -1} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: 10, paddingTop: 1 },
  btn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});
