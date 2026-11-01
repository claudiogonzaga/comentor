// Transcrição do vídeo na síntese:
// - sem transcrição → botão "📝 Transcrever" (legendas do YouTube → senão
//   Parakeet no celular), com etapa e progresso;
// - com transcrição → seção recolhível com os trechos e o tempo de cada um.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import * as db from '../services/db';
import { mediaBase } from '../services/media';
import { TRANSCRIPTION_SUPPORTED } from '../services/transcription';
import { useMediaStore } from '../store/useMediaStore';
import { useTranscribeStore, type TranscribeJob } from '../store/useTranscribeStore';
import type { VideoRecord } from '../types';
import { colors, radius, spacing, typography } from '../theme';

const MB = 1024 * 1024;

function stageLabel(job: TranscribeJob, audioPct: number): string {
  switch (job.stage) {
    case 'captions':
      return 'Procurando legendas…';
    case 'audio':
      return audioPct > 0 ? `Baixando o áudio ${audioPct}%` : 'Baixando o áudio…';
    case 'transcribing':
      return job.progress > 0 ? `Transcrevendo ${Math.round(job.progress * 100)}%` : 'Carregando o modelo…';
    case 'analyzing':
      return 'Refazendo a triagem…';
  }
}

function TranscribeButton({ video }: { video: VideoRecord }) {
  const job = useTranscribeStore((s) => s.jobs[video.video_id]);
  const error = useTranscribeStore((s) => s.errors[video.video_id]);
  const model = useTranscribeStore((s) => s.model);
  const transcribe = useTranscribeStore((s) => s.transcribe);
  const cancel = useTranscribeStore((s) => s.cancel);
  const downloadModel = useTranscribeStore((s) => s.downloadModel);
  const audioPct = useMediaStore((s) =>
    Math.round(s.downloads[mediaBase(video.video_id, 'audio')]?.progress ?? 0),
  );

  const onPress = () => {
    Haptics.selectionAsync();
    if (job) cancel(video.video_id);
    else transcribe(video.video_id);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
      >
        {job ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.accent.gold} />
            <Text style={styles.label}>{stageLabel(job, audioPct)}</Text>
          </View>
        ) : (
          <Text style={styles.label}>📝 Transcrever</Text>
        )}
      </Pressable>
      <Text style={styles.sub}>
        {job
          ? job.auto
            ? 'transcrição automática em andamento · toque para parar'
            : 'toque para cancelar'
          : 'sem transcrição · usa a legenda do YouTube ou transcreve no celular'}
      </Text>

      {!job && error && !model.installed && (
        <View style={styles.modelBox}>
          <Text style={styles.modelText}>
            Este vídeo não tem legenda. Para transcrever no celular, baixe uma vez o modelo
            Parakeet ({Math.round((model.total || 670 * MB) / MB)} MB, de preferência no Wi-Fi).
          </Text>
          {model.downloading ? (
            <Text style={styles.modelText}>
              Baixando o modelo… {model.total ? Math.round((model.received / model.total) * 100) : 0}%
            </Text>
          ) : (
            <Pressable onPress={downloadModel} hitSlop={8}>
              <Text style={styles.link}>Baixar o modelo agora →</Text>
            </Pressable>
          )}
        </View>
      )}
      {!job && error && model.installed && <Text style={styles.err}>{error}</Text>}
    </View>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  youtube: 'legenda do YouTube',
  parakeet: 'transcrita no celular',
};

function TranscriptView({ video }: { video: VideoRecord }) {
  const [open, setOpen] = useState(false);
  const segments = useMemo(() => db.getTranscriptSegments(video), [video]);
  const source = video.transcript_source ? SOURCE_LABEL[video.transcript_source] : 'legenda';

  return (
    <View style={styles.box}>
      <Pressable onPress={() => setOpen((v) => !v)} hitSlop={6} style={styles.head}>
        <Text style={styles.title}>📝 Transcrição</Text>
        <Text style={styles.meta}>
          {source} · {open ? 'recolher ▲' : 'ver ▼'}
        </Text>
      </Pressable>
      {open &&
        (segments.length > 0 ? (
          segments.map((s, i) => (
            <Text key={i} style={styles.seg}>
              <Text style={styles.ts}>{s.ts} </Text>
              {s.text}
            </Text>
          ))
        ) : (
          <Text style={styles.seg}>{video.transcript_text}</Text>
        ))}
    </View>
  );
}

export function TranscriptBlock({ video }: { video: VideoRecord }) {
  if ((video.transcript_text || '').trim()) return <TranscriptView video={video} />;
  if (!TRANSCRIPTION_SUPPORTED) return null;
  return <TranscribeButton video={video} />;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, gap: 3 },
  btn: {
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.text.primary },
  sub: {
    ...typography.label,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  modelBox: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    gap: spacing.sm,
  },
  modelText: { ...typography.small, color: colors.text.secondary, lineHeight: 18 },
  link: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.accent.gold },
  err: { ...typography.small, color: colors.accent.danger },
  box: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.text.primary },
  meta: { ...typography.label, textTransform: 'none', letterSpacing: 0, color: colors.text.tertiary },
  seg: { ...typography.small, fontSize: 13, lineHeight: 19, color: colors.text.primary },
  ts: { color: colors.text.tertiary, fontFamily: 'Inter_500Medium' },
});
