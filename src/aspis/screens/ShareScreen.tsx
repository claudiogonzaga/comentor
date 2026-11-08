// Destino do menu Compartilhar (caso de uso CENTRAL): recebe o link do
// YouTube, busca metadados (oEmbed → videos.list se logado), obtém o conteúdo
// em camadas (Gemini assiste o vídeo → legendas → metadados) e mostra a
// síntese com as ações. Vídeo já analisado vem direto do cache (SQLite).
// Compartilhar é dizer "quero isto": o vídeo entra no feed do Escudo (no topo
// por um dia, mesmo abaixo do limiar) e ganha 👍 na rede local.
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { learnThumb } from '../services/neural';
import { compartilharComIA } from '../services/filaIA';
import { fetchOEmbed } from '../services/oembed';
import { getVideoDetails } from '../services/youtube';
import { useAppStore } from '../store/useAppStore';
import { useTranscribeStore } from '../store/useTranscribeStore';
import type { RootStackParamList } from '../navigation/types';
import type { VideoMeta, VideoRecord } from '../types';
import { colors, spacing, typography } from '../theme';
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
  // o 👍 foi dado por este compartilhamento (e não já existia)?
  const autoThumbed = useRef(false);
  // o link já foi para a fila da IA do Mac (não repete no "tentar de novo")
  const enviadoIA = useRef<string | null>(null);

  /** Compartilhar = quero isto: vai para o feed do Escudo e ganha 👍 na rede local. */
  const intoShield = useCallback((video: VideoRecord): VideoRecord => {
    db.markShared(video.video_id);
    if (db.getThumbValue(video.video_id) !== 1) {
      learnThumb(video, 1);
      autoThumbed.current = true;
    }
    useAppStore.getState().bumpFeed();
    return db.getVideo(video.video_id) ?? video;
  }, []);

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

    // A IA do Mac também escreve o card deste vídeo, na próxima execução agendada
    // (06h, 13h ou 21h) — mesmo que a análise daqui falhe (filaIA.ts).
    if (enviadoIA.current !== videoId) {
      enviadoIA.current = videoId;
      compartilharComIA({ id: videoId, source: 'youtube', url: watchUrl(videoId) });
    }

    // cache: já analisado → mostra direto, sem reprocessar
    const cached = db.getVideo(videoId);
    if (cached) {
      setState({ status: 'done', video: intoShield(cached) });
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
      if (saved) setState({ status: 'done', video: intoShield(saved) });
      if (r.source === 'metadata') useTranscribeStore.getState().runAuto();
    } catch (e) {
      const keyError =
        e instanceof NoGeminiKeyError || (e instanceof GeminiError && e.isKeyError);
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        keyError,
        // "tentar de novo" também depois de trocar a chave: a do Claude não refaz a análise sozinha
        canRetry: true,
      });
    }
  }, [sharedText, geminiKey, model, pillars, rules, noteLang, learnedPrefs, user, intoShield]);

  useEffect(() => {
    run();
  }, [run]);

  // Descartar ou pular aqui desfaz o 👍 que o compartilhamento deu.
  const undoShare = (video: VideoRecord) => {
    if (autoThumbed.current) learnThumb(video, 0);
    autoThumbed.current = false;
    useAppStore.getState().bumpFeed();
    navigation.popToTop();
  };

  const goSettings = () => navigation.navigate('Settings');

  return (
    <ScreenContainer>
      <View style={styles.topbar}>
        <Text style={styles.wordmark}>Escudo</Text>
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
              style={[styles.stars, { color: colors.text.primary }]}
            >
              {'★'.repeat(scoreToStars(state.video.score)) || '☆'}
            </Text>
            <Text style={styles.scoreText}>
              score {state.video.score} ·{' '}
              {pillars.find((p) => p.id === state.video.pillar)?.mocName || 'nenhum'}
            </Text>
          </View>
          <Text style={styles.added}>No feed do Escudo, com 👍</Text>
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
            onDiscard={() => undoShare(state.video)}
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
  added: { ...typography.small, color: colors.accent.success, marginBottom: spacing.xs },
  title: { ...typography.title, color: colors.text.primary },
  subline: { ...typography.small, color: colors.text.secondary, marginTop: 6 },
  errorBox: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  errorTitle: { ...typography.title, color: colors.text.primary, marginBottom: spacing.md },
  errorMsg: { ...typography.body, color: colors.text.secondary },
});
