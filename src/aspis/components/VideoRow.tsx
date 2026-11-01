// Linha da lista ranqueada — port do .row do desktop: indicador de
// alinhamento por cor, avatar do canal, título neutro e sub-linha
// "canal · duração · pill do pilar · sensacionalista".
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { scoreToStars } from '../constants/defaults';
import type { Pillar, VideoRecord } from '../types';
import { colors, spacing, typography } from '../theme';
import { AlignDot } from './AlignDot';
import { ChannelAvatar } from './ChannelAvatar';
import { PillarPill } from './PillarPill';

interface Props {
  video: VideoRecord;
  pillars: Pillar[];
  onPress: () => void;
  expanded: boolean;
  children?: ReactNode; // síntese, quando expandida
}

export function VideoRow({ video, pillars, onPress, expanded, children }: Props) {
  const stars = scoreToStars(video.score);
  const pillarIndex = pillars.findIndex((p) => p.id === video.pillar);
  const pillarLabel =
    pillarIndex >= 0 ? pillars[pillarIndex].mocName || pillars[pillarIndex].nome : '—';
  const isRead = video.read === 1;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && !expanded && { backgroundColor: colors.bg.surface }]}
    >
      <View style={styles.grid}>
        <View style={[styles.dotCell, isRead && styles.dim]}>
          <AlignDot stars={stars} />
        </View>
        <View style={[styles.avatarCell, isRead && styles.dim]}>
          <ChannelAvatar uri={video.channel_thumb} channel={video.channel} />
        </View>
        <View style={styles.main}>
          <Text style={[styles.title, isRead && { color: colors.text.secondary }]}>
            {video.neutral_title}
          </Text>
          <View style={styles.subline}>
            <Text style={styles.subText} numberOfLines={1}>
              {video.channel}
              {video.duration ? `  ·  ${video.duration}` : ''}
            </Text>
            <PillarPill label={pillarLabel} pillarIndex={pillarIndex} />
            {video.is_clickbait === 1 && (
              <Text style={styles.clickbait}>· sensacionalista</Text>
            )}
            {video.content_source === 'metadata' && (
              <Text style={styles.clickbait}>· nota provisória</Text>
            )}
          </View>
          {expanded && children}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  grid: { flexDirection: 'row', gap: spacing.md },
  dotCell: { paddingTop: 4 },
  avatarCell: { paddingTop: 0 },
  dim: { opacity: 0.55 },
  main: { flex: 1 },
  title: {
    ...typography.bodyMedium,
    fontSize: 15.5,
    lineHeight: 21,
    color: colors.text.primary,
  },
  subline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 5,
  },
  subText: { ...typography.small, color: colors.text.secondary, flexShrink: 1 },
  clickbait: { ...typography.label, color: colors.text.tertiary, textTransform: 'none', letterSpacing: 0 },
});
