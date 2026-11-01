// Destino do menu Compartilhar (caso de uso CENTRAL): recebe o link do
// YouTube, busca metadados (oEmbed → videos.list se logado), obtém o conteúdo
// em camadas (Gemini assiste o vídeo → legendas → metadados) e mostra a
// síntese com as ações. Vídeo já analisado vem direto do cache (SQLite).
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { LoadingAnalysis, type LoadingPhase } from '../components/LoadingAnalysis';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { SynthesisView } from '../components/SynthesisView';
import { scoreToStars } from '../constants/defaults';
import { analyze, GeminiError, NoGeminiKeyError } from '../services/brain';
import { getAccessToken } from '../services/auth';
import * as db from '../services/db';
import { fetchOEmbed } from '../services/oembed';
import { getVideoDetails } from '../services/youtube';
import { useAppStore } from '../store/useAppStore';
import { useTranscribeStore } from '../store/useTranscribeStore';
import type { RootStackParamList } from '../navigation/types';
import type { VideoMeta, VideoRecord } from '../types';
import { alignColor, colors, spacing, typography } from '../theme';
import { extractVideoId, watchUrl } from '../utils/videoId';

type Props = NativeStackScreenProps<RootStackParamList, 'Share'>;

type State =
  | { status: 'loading'; phase: LoadingPhase; title?: string }
  | { status: 'error'; message: string; keyError: boolean; canRetry: boolean }
  | { status: 'done'; video: VideoRecord };

export function ShareScreen({ route, navigation }: Props) {
  const { sharedText } = route.params;
  const { geminiKey, model, pillars, rules, noteLang, learnedPrefs, user } = useAppStore();
  const [state, setState] = useState<State>({ status: 'loading', phase: 'meta' });

  const run = useCallback(async () => {
    setState({ status: 'loading', phase: 'meta' });

    const videoId = extractVideoId(sharedText);
    if (!videoId) {
      setState({
        status: 'error',
        message: 'Não encontrei um link de vídeo do YouTube no que foi compartilhado.',
        keyError: false,
        canRetry: false,
      });
      return;
    }

    // cache: já analisado → mostra direto, sem reprocessar
    const cached = db.getVideo(videoId);
    if (cached) {
      setState({ status: 'done', video: cached });
      return;
    }

    try {
      // metadados: oEmbed (sem quota); se logado, completa com videos.list
      const oembed = await fetchOEmbed(videoId);
      let meta: VideoMeta = {
        video_id: videoId,
        title: oembed?.title || '',
        channel: oembed?.channel || '',
        channel_id: '',
        description: '',
        published_at: '',
        duration: '',
        url: watchUrl(videoId),
        channel_thumb: '',
      };
      if (user) {
        try {
          const token = await getAccessToken();
          const details = await getVideoDetails(token, videoId);
          if (details) meta = { ...details, channel_thumb: meta.channel_thumb };
        } catch {
          // sem detalhes da Data API → segue só com oEmbed
        }
      }
      if (!meta.title) {
        setState({
          status: 'error',
          message: 'Não consegui ler os dados desse vídeo (ele existe e é público?).',
          keyError: false,
          canRetry: true,
        });
        return;
      }

      setState({ status: 'loading', phase: 'video', title: meta.title });
      const r = await analyze(meta, { apiKey: geminiKey, model, pillars, rules, noteLang, learnedPrefs }, true, (phase) =>
        setState({ status: 'loading', phase, title: meta.title }),
      );

      db.upsertVideo({
        ...meta,
        ...r.analysis,
        original_title: meta.title,
        transcript_available: r.transcript?.available ? 1 : 0,
        content_source: r.source,
        transcript_text: r.transcript?.text ?? null,
      });
      const saved = db.getVideo(videoId);
      if (saved) setState({ status: 'done', video: saved });
      if (r.source === 'metadata') useTranscribeStore.getState().runAuto();
    } catch (e) {
      const keyError =
        e instanceof NoGeminiKeyError || (e instanceof GeminiError && e.isKeyError);
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        keyError,
        canRetry: !keyError,
      });
    }
  }, [sharedText, geminiKey, model, pillars, rules, noteLang, learnedPrefs, user]);

  useEffect(() => {
    run();
  }, [run]);

  const goSettings = () => navigation.navigate('Settings');

  return (
    <ScreenContainer>
      <View style={styles.topbar}>
        <Text style={styles.wordmark}>Aspis</Text>
        <Pressable onPress={() => navigation.popToTop()} hitSlop={12}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>

      {state.status === 'loading' && (
        <LoadingAnalysis phase={state.phase} title={state.title} />
      )}

      {state.status === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Não deu para analisar</Text>
          <Text style={styles.errorMsg}>{state.message}</Text>
          {state.keyError && (
            <Button label="Abrir Configurações" onPress={goSettings} style={{ marginTop: spacing.xl }} />
          )}
          {state.canRetry && (
            <Button
              label="Tentar de novo"
              variant="secondary"
              onPress={run}
              style={{ marginTop: spacing.md }}
            />
          )}
        </View>
      )}

      {state.status === 'done' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.scoreRow}>
            <Text
              style={[styles.stars, { color: alignColor(scoreToStars(state.video.score)) }]}
            >
              {'★'.repeat(scoreToStars(state.video.score)) || '☆'}
            </Text>
            <Text style={styles.scoreText}>
              score {state.video.score} ·{' '}
              {pillars.find((p) => p.id === state.video.pillar)?.mocName || 'nenhum'}
            </Text>
          </View>
          <Text style={styles.title}>{state.video.neutral_title}</Text>
          <Text style={styles.subline}>
            {state.video.channel}
            {state.video.duration ? `  ·  ${state.video.duration}` : ''}
            {state.video.is_clickbait === 1 ? '  ·  sensacionalista' : ''}
          </Text>
          <SynthesisView
            video={state.video}
            context="share"
            onNeedSettings={goSettings}
            onDiscard={() => navigation.popToTop()}
          />
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
  wordmark: { ...typography.subtitle, color: colors.text.primary },
  close: { fontSize: 28, color: colors.text.tertiary, lineHeight: 30 },
  scroll: { padding: spacing.xl, paddingTop: spacing.lg },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  stars: { fontSize: 16, letterSpacing: 2 },
  scoreText: { ...typography.small, color: colors.text.secondary },
  title: { ...typography.title, color: colors.text.primary },
  subline: { ...typography.small, color: colors.text.secondary, marginTop: 6 },
  errorBox: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  errorTitle: { ...typography.title, color: colors.text.primary, marginBottom: spacing.md },
  errorMsg: { ...typography.body, color: colors.text.secondary },
});
