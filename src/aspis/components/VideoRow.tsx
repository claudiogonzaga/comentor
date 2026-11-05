// Linha da lista ranqueada — port do .row do desktop: indicador de
// alinhamento por cor, avatar do canal, título neutro e sub-linha
// "canal · duração · pill do pilar · sensacionalista".
//
// Deslizar o card para o lado (qualquer direção) o oculta: "não quero isso agora".
// Não é 👎 nem "lido": nenhum sinal vai para a rede. Só o arrasto claramente lateral
// conta — o vertical continua sendo da rolagem, e o toque, de abrir a síntese.
import { ReactNode, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';

import { alignedStars } from '../services/neural';
import type { Pillar, VideoRecord } from '../types';
import { colors, spacing, typography } from '../theme';
import { AlignDot } from './AlignDot';
import { ChannelAvatar } from './ChannelAvatar';
import { PillarPill } from './PillarPill';
import { ThumbButtons } from './ThumbButtons';

interface Props {
  video: VideoRecord;
  pillars: Pillar[];
  onPress: () => void;
  expanded: boolean;
  /** Deslizou para o lado além do limiar: o card já saiu da tela e fechou o espaço. */
  onHide?: (video: VideoRecord) => void;
  children?: ReactNode; // síntese, quando expandida
}

/** Quanto da largura o arrasto precisa passar para ocultar; menos que isso, volta. */
const HIDE_AT = 0.35;
/** Arrasto lateral mínimo (px) e quanto ele precisa ser mais lateral que vertical. */
const SLOP = 14;
const LATERAL = 2;

const isLateral = (dx: number, dy: number) => Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * LATERAL;

export function VideoRow({ video, pillars, onPress, expanded, onHide, children }: Props) {
  const stars = alignedStars(video);
  const pillarIndex = pillars.findIndex((p) => p.id === video.pillar);
  const pillarLabel =
    pillarIndex >= 0 ? pillars[pillarIndex].mocName || pillars[pillarIndex].nome : '—';
  const isRead = video.read === 1;

  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(0)).current;
  const measured = useRef(0);
  const gone = useRef(false);
  const [collapsing, setCollapsing] = useState(false);
  // O PanResponder é criado uma vez: lê o que muda por referência.
  const live = useRef({ width, onHide, video });
  live.current = { width, onHide, video };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          !!live.current.onHide && !gone.current && isLateral(g.dx, g.dy),
        onPanResponderGrant: () => x.stopAnimation(),
        onPanResponderMove: (_, g) => x.setValue(g.dx),
        // Começado o deslize, a rolagem não o toma no meio.
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          const w = live.current.width;
          const far = Math.abs(g.dx) > w * HIDE_AT;
          // Um peteleco rápido na mesma direção também vale, se já andou um bom pedaço.
          const fling = Math.abs(g.vx) > 1.2 && Math.abs(g.dx) > w * 0.2 && g.vx * g.dx > 0;
          if (!far && !fling) {
            Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            return;
          }
          gone.current = true;
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          Animated.timing(x, {
            toValue: Math.sign(g.dx) * w,
            duration: 170,
            useNativeDriver: true,
          }).start(() => {
            // Saiu da tela: fecha o espaço dele e só então avisa a lista.
            height.setValue(measured.current);
            setCollapsing(true);
            Animated.timing(height, { toValue: 0, duration: 170, useNativeDriver: false }).start(() =>
              live.current.onHide?.(live.current.video),
            );
          });
        },
        onPanResponderTerminate: () => {
          if (!gone.current) Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [x, height],
  );

  // Aberta, a síntese guarda para si o arrasto lateral (o campo de pergunta, por
  // exemplo): só a cabeça do card desliza. Ela pega o arrasto antes do card (está mais
  // funda) e não o entrega; a rolagem nativa segue livre.
  const keepInside = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => isLateral(g.dx, g.dy),
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => false,
      }),
    [],
  );

  const fade = x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: [0.15, 1, 0.15],
    extrapolate: 'clamp',
  });
  const hintLeft = x.interpolate({ inputRange: [0, 48], outputRange: [0, 1], extrapolate: 'clamp' });
  const hintRight = x.interpolate({ inputRange: [-48, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Animated.View
      style={collapsing ? { height, overflow: 'hidden' } : undefined}
      onLayout={(e) => {
        if (!collapsing) measured.current = e.nativeEvent.layout.height;
      }}
    >
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {/* "Ocultar" entra pelo lado que o card descobre */}
        <Animated.View style={[styles.hint, styles.hintLeft, { opacity: hintLeft }]} pointerEvents="none">
          <Text style={styles.hintText}>Ocultar</Text>
        </Animated.View>
        <Animated.View style={[styles.hint, styles.hintRight, { opacity: hintRight }]} pointerEvents="none">
          <Text style={styles.hintText}>Ocultar</Text>
        </Animated.View>
        <Animated.View style={{ opacity: fade }}>
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
                    {video.source === 'x' && video.channel_id ? `  ·  @${video.channel_id}` : ''}
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
                {expanded && children ? <View {...keepInside.panHandlers}>{children}</View> : null}
              </View>
              <ThumbButtons video={video} />
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Animated.View>
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
  // A dica fica colada do lado de fora do card e anda com ele.
  hint: { position: 'absolute', top: 0, bottom: 0, width: 120, justifyContent: 'center' },
  hintLeft: { right: '100%', alignItems: 'flex-end', paddingRight: spacing.lg },
  hintRight: { left: '100%', alignItems: 'flex-start', paddingLeft: spacing.lg },
  hintText: { ...typography.label, color: colors.text.secondary, letterSpacing: 0.3 },
});
