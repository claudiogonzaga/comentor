// "🎧 Ouvir áudio" / "🎬 Assistir". O vídeo toca em miniatura, sem baixar; só o que o
// dono não deixa tocar fora do YouTube volta a "Baixar e assistir". O áudio pré-baixa
// em segundo plano (conforme a preferência de rede), porque toca de tela apagada.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import {
  expiresLabel,
  findMedia,
  formatBytes,
  mediaBase,
  MEDIA_SUPPORTED,
  type MediaKind,
} from '../services/media';
import { useMediaStore } from '../store/useMediaStore';
import { useMiniPlayer } from '../store/useMiniPlayer';
import type { RootStackParamList } from '../navigation/types';
import type { VideoRecord } from '../types';
import { colors, radius, spacing, typography } from '../theme';

const LABEL: Record<MediaKind, string> = {
  audio: '🎧 Ouvir áudio',
  video: '🎬 Baixar e assistir',
};

function MediaButton({ video, kind }: { video: VideoRecord; kind: MediaKind }) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const base = mediaBase(video.video_id, kind);
  const version = useMediaStore((s) => s.version);
  const dl = useMediaStore((s) => s.downloads[base]);
  const queued = useMediaStore((s) => s.queue.some((j) => mediaBase(j.videoId, j.kind) === base));
  const start = useMediaStore((s) => s.start);
  const cancel = useMediaStore((s) => s.cancel);
  const file = useMemo(() => findMedia(video.video_id, kind), [video.video_id, kind, version]);

  // O usuário pediu para ouvir/assistir: abre assim que o arquivo existir.
  const [wantOpen, setWantOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  useEffect(() => {
    if (!wantOpen) return;
    if (file) {
      setWantOpen(false);
      if (mounted.current && navigation.isFocused()) {
        navigation.navigate('Player', { videoId: video.video_id, kind });
      }
    } else if (!dl && !queued) {
      setWantOpen(false); // cancelado ou falhou (o erro aparece abaixo)
    }
  }, [wantOpen, file, dl, queued, navigation, video.video_id, kind]);

  const onPress = () => {
    Haptics.selectionAsync();
    if (file) {
      navigation.navigate('Player', { videoId: video.video_id, kind });
      return;
    }
    setWantOpen(true);
    start(video.url, video.video_id, kind); // promove o pré-download, se houver
  };

  const onCancel = () => {
    Haptics.selectionAsync();
    setWantOpen(false);
    cancel(video.video_id, kind);
  };

  const downloading = dl?.status === 'downloading';
  const pct = Math.round(dl?.progress ?? 0);
  const waiting = downloading && (wantOpen || !dl.background);

  let sub: string;
  if (file) sub = `no celular · ${formatBytes(file.size)} · ${expiresLabel(file.expiresAt)}`;
  else if (waiting) sub = 'abre quando terminar';
  else if (downloading) sub = 'pré-baixando…';
  else if (queued) sub = 'na fila para pré-baixar';
  else if (dl?.status === 'error') sub = '';
  else sub = kind === 'audio' ? 'baixa só o som' : 'baixa até 720p';

  return (
    <View style={styles.item}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.btn, file && styles.btnReady, pressed && { opacity: 0.7 }]}
      >
        {downloading && <View style={[styles.progressFill, { width: `${Math.max(4, pct)}%` }]} />}
        {waiting ? (
          <View style={styles.progressRow}>
            <ActivityIndicator size="small" color={colors.accent.gold} />
            <Text style={styles.label} numberOfLines={1}>
              {pct > 0 ? `Baixando ${pct}%` : 'Preparando…'}
            </Text>
          </View>
        ) : (
          <Text
            style={[styles.label, file && styles.labelReady]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {LABEL[kind]}
          </Text>
        )}
      </Pressable>
      <View style={styles.subRow}>
        {!!sub && (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        )}
        {(downloading || queued) && (
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancel}>cancelar</Text>
          </Pressable>
        )}
      </View>
      {dl?.status === 'error' && (
        <Text style={styles.err} numberOfLines={4}>
          Não deu para baixar: {dl.error}
        </Text>
      )}
    </View>
  );
}

/** Toca em miniatura, sobre a tela: dá para ler a síntese enquanto o vídeo roda. */
function WatchButton({ video }: { video: VideoRecord }) {
  const open = useMiniPlayer((s) => s.open);
  return (
    <View style={styles.item}>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          open({ videoId: video.video_id, title: video.neutral_title || video.original_title });
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit>
          🎬 Assistir
        </Text>
      </Pressable>
      <View style={styles.subRow}>
        <Text style={styles.sub} numberOfLines={1}>
          em miniatura, sem baixar
        </Text>
      </View>
    </View>
  );
}

export function MediaActions({ video }: { video: VideoRecord }) {
  const prefetch = useMediaStore((s) => s.prefetch);
  const blocked = useMiniPlayer((s) => s.blocked[video.video_id]);
  const version = useMediaStore((s) => s.version);
  const hasVideoFile = useMemo(() => !!findMedia(video.video_id, 'video'), [video.video_id, version]);

  // Abriu o vídeo → pré-baixa o áudio em segundo plano.
  useEffect(() => {
    if (MEDIA_SUPPORTED) prefetch(video.url, video.video_id);
  }, [prefetch, video.url, video.video_id]);

  if (!MEDIA_SUPPORTED) return null;
  return (
    <View style={styles.row}>
      <MediaButton video={video} kind="audio" />
      {blocked || hasVideoFile ? <MediaButton video={video} kind="video" /> : <WatchButton video={video} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  item: { flexGrow: 1, flexBasis: 150, gap: 3 },
  btn: {
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  btnReady: { backgroundColor: colors.accent.gold },
  label: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.text.primary },
  labelReady: { color: colors.text.onGold },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.bg.surfaceStrong,
  },
  subRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.sm },
  sub: {
    ...typography.label,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.text.tertiary,
    flexShrink: 1,
  },
  cancel: { ...typography.label, textTransform: 'none', letterSpacing: 0, color: colors.accent.gold },
  err: { ...typography.small, color: colors.accent.danger },
});
