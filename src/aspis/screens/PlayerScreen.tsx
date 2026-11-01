// Player do Aspis: toca o áudio ou o vídeo BAIXADO no celular — nunca o app do
// YouTube (sem feed, sem recomendações). Áudio segue tocando com a tela
// apagada e tem controles na tela de bloqueio; retoma de onde parou.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';

import { ScreenContainer } from '../components/ScreenContainer';
import * as db from '../services/db';
import {
  expiresLabel,
  findMedia,
  formatBytes,
  formatClock,
  getPosition,
  savePosition,
  type MediaFile,
} from '../services/media';
import { useMediaStore } from '../store/useMediaStore';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

// Só retoma se parou no meio (nem no começo, nem quase no fim).
function resumeAt(saved: number, duration: number): number {
  if (saved < 5) return 0;
  if (duration > 0 && saved > duration - 10) return 0;
  return saved;
}

function SeekBar({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const at = (e: GestureResponderEvent) => {
    if (!width || !duration) return 0;
    const x = Math.max(0, Math.min(width, e.nativeEvent.locationX));
    return (x / width) * duration;
  };

  const shown = drag ?? position;
  const pct = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;

  return (
    <View>
      <View
        style={styles.seekHit}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDrag(at(e))}
        onResponderMove={(e) => setDrag(at(e))}
        onResponderRelease={(e) => {
          onSeek(at(e));
          setDrag(null);
        }}
        onResponderTerminate={() => setDrag(null)}
      >
        <View style={styles.seekTrack} pointerEvents="none">
          <View style={[styles.seekFill, { width: `${pct}%` }]} />
        </View>
        <View style={[styles.seekKnob, { left: `${pct}%` }]} pointerEvents="none" />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatClock(shown)}</Text>
        <Text style={styles.time}>-{formatClock(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  );
}

function AudioPlayerView({
  file,
  title,
  channel,
}: {
  file: MediaFile;
  title: string;
  channel: string;
}) {
  const player = useAudioPlayer({ uri: file.uri }, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState(1);
  const started = useRef(false);

  // Primeiro carregamento: modo de fundo + tela de bloqueio + retomar + tocar.
  useEffect(() => {
    if (!status.isLoaded || started.current) return;
    started.current = true;
    (async () => {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      }).catch(() => {});
      try {
        player.setActiveForLockScreen(
          true,
          { title, artist: channel, albumTitle: 'Aspis' },
          { showSeekBackward: true, showSeekForward: true },
        );
      } catch {
        // controles de bloqueio são um extra
      }
      const from = resumeAt(getPosition(file.videoId, 'audio'), status.duration);
      if (from > 0) await player.seekTo(from).catch(() => {});
      player.play();
    })();
  }, [status.isLoaded, status.duration, player, file.videoId, title, channel]);

  // Guarda a posição a cada ~5 s e ao sair.
  const lastSaved = useRef(0);
  useEffect(() => {
    if (!started.current) return;
    if (status.didJustFinish) {
      savePosition(file.videoId, 'audio', 0);
      return;
    }
    if (Math.abs(status.currentTime - lastSaved.current) >= 5) {
      lastSaved.current = status.currentTime;
      savePosition(file.videoId, 'audio', status.currentTime);
    }
  }, [status.currentTime, status.didJustFinish, file.videoId]);

  useEffect(
    () => () => {
      try {
        savePosition(file.videoId, 'audio', player.currentTime);
        player.clearLockScreenControls();
      } catch {
        // player já liberado
      }
    },
    [player, file.videoId],
  );

  const skip = (delta: number) => {
    Haptics.selectionAsync();
    const to = Math.max(0, Math.min(status.duration || 0, status.currentTime + delta));
    player.seekTo(to).catch(() => {});
  };

  const togglePlay = () => {
    Haptics.selectionAsync();
    if (status.playing) player.pause();
    else {
      if (status.duration > 0 && status.currentTime >= status.duration - 0.5) {
        player.seekTo(0).catch(() => {});
      }
      player.play();
    }
  };

  const cycleSpeed = () => {
    Haptics.selectionAsync();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    player.setPlaybackRate(next);
  };

  return (
    <View style={styles.audioWrap}>
      <Image source={require('../../../assets/aspis/logo-mark.png')} style={styles.art} />
      <Text style={styles.audioTitle}>{title}</Text>
      {!!channel && <Text style={styles.audioChannel}>{channel}</Text>}

      <View style={styles.seekWrap}>
        {status.isLoaded ? (
          <SeekBar
            position={status.currentTime}
            duration={status.duration}
            onSeek={(s) => player.seekTo(s).catch(() => {})}
          />
        ) : (
          <ActivityIndicator color={colors.accent.gold} />
        )}
      </View>

      <View style={styles.controls}>
        <Pressable onPress={() => skip(-15)} hitSlop={10} style={styles.skipBtn}>
          <Text style={styles.skipLabel}>↺ 15</Text>
        </Pressable>
        <Pressable
          onPress={togglePlay}
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.playLabel}>{status.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable onPress={() => skip(30)} hitSlop={10} style={styles.skipBtn}>
          <Text style={styles.skipLabel}>30 ↻</Text>
        </Pressable>
      </View>

      <Pressable onPress={cycleSpeed} style={styles.speedChip} hitSlop={8}>
        <Text style={styles.speedLabel}>{`${speed}×`.replace('.', ',')}</Text>
      </Pressable>
    </View>
  );
}

function VideoPlayerView({ file }: { file: MediaFile }) {
  const player = useVideoPlayer({ uri: file.uri }, (p) => {
    p.timeUpdateEventInterval = 5;
    const from = getPosition(file.videoId, 'video');
    if (from >= 5) p.currentTime = from;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const d = player.duration;
      savePosition(file.videoId, 'video', d > 0 && currentTime > d - 10 ? 0 : currentTime);
    });
    return () => {
      sub.remove();
      try {
        const d = player.duration;
        const t = player.currentTime;
        savePosition(file.videoId, 'video', d > 0 && t > d - 10 ? 0 : t);
      } catch {
        // player já liberado
      }
    };
  }, [player, file.videoId]);

  return (
    <View style={styles.videoBox}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}

export function PlayerScreen({ route, navigation }: Props) {
  const { videoId, kind } = route.params;
  const version = useMediaStore((s) => s.version);
  const remove = useMediaStore((s) => s.remove);
  const file = useMemo(() => findMedia(videoId, kind), [videoId, kind, version]);
  const video = useMemo(() => db.getVideo(videoId), [videoId]);
  const title = video?.neutral_title || video?.original_title || videoId;
  const channel = video?.channel || '';

  const handleDelete = () => {
    Haptics.selectionAsync();
    remove(videoId, kind);
    navigation.goBack();
  };

  return (
    <ScreenContainer meander={kind === 'audio'}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={styles.topTitle}>{kind === 'audio' ? 'Ouvindo' : 'Assistindo'}</Text>
        <View style={{ width: 60 }} />
      </View>

      {!file ? (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Arquivo não está mais no celular</Text>
          <Text style={styles.missingText}>
            Ele venceu o prazo e foi apagado, ou você o excluiu. Volte e toque em
            {kind === 'audio' ? ' “Ouvir áudio”' : ' “Assistir vídeo”'} para baixar de novo.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {kind === 'audio' ? (
            <AudioPlayerView file={file} title={title} channel={channel} />
          ) : (
            <>
              <VideoPlayerView file={file} />
              <Text style={styles.videoTitle}>{title}</Text>
              {!!channel && <Text style={styles.audioChannel}>{channel}</Text>}
            </>
          )}

          <View style={styles.fileBox}>
            <Text style={styles.fileText}>
              Salvo só neste celular · {formatBytes(file.size)} · {expiresLabel(file.expiresAt)}
            </Text>
            <Pressable onPress={handleDelete} hitSlop={8}>
              <Text style={styles.deleteLabel}>Apagar agora</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  back: { ...typography.body, color: colors.accent.gold, minWidth: 60 },
  topTitle: { ...typography.subtitle, color: colors.text.primary },
  scroll: { padding: spacing.xl, paddingTop: spacing.lg, gap: spacing.lg },

  audioWrap: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg },
  art: { width: 168, height: 168, borderRadius: 84, marginBottom: spacing.lg },
  audioTitle: { ...typography.title, fontSize: 21, lineHeight: 28, color: colors.text.primary, textAlign: 'center' },
  audioChannel: { ...typography.small, color: colors.text.secondary, textAlign: 'center' },
  seekWrap: { alignSelf: 'stretch', marginTop: spacing.xl, minHeight: 48, justifyContent: 'center' },
  seekHit: { height: 28, justifyContent: 'center' },
  seekTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bg.surfaceStrong,
    overflow: 'hidden',
  },
  seekFill: { height: 4, backgroundColor: colors.accent.gold },
  seekKnob: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.accent.gold,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  time: { ...typography.label, letterSpacing: 0, color: colors.text.secondary },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
    marginTop: spacing.md,
  },
  skipBtn: { minWidth: 56, alignItems: 'center' },
  skipLabel: { ...typography.bodyMedium, color: colors.text.primary },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playLabel: { fontSize: 26, color: colors.text.onGold },
  speedChip: {
    marginTop: spacing.md,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speedLabel: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.text.primary },

  videoBox: {
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  video: { flex: 1 },
  videoTitle: { ...typography.subtitle, color: colors.text.primary },

  fileBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  fileText: { ...typography.small, color: colors.text.secondary, flex: 1 },
  deleteLabel: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.accent.danger },

  missing: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  missingTitle: { ...typography.title, color: colors.text.primary, marginBottom: spacing.md },
  missingText: { ...typography.body, color: colors.text.secondary },
});
