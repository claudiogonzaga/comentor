// Feed de inscrições ranqueado — port da lista do desktop (ui/index.html):
// chips de pilar, régua de estrelas mínimas, período Dia/Semana/Mês,
// "Mostrar lidos", expansão inline da síntese e rodapé com os filtrados.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { PeriodSegment } from '../components/PeriodSegment';
import { ScreenContainer } from '../components/ScreenContainer';
import { StarsRuler } from '../components/StarsRuler';
import { SynthesisView } from '../components/SynthesisView';
import { VideoRow } from '../components/VideoRow';
import { XHarvester } from '../components/XHarvester';
import { AUTO_REFRESH_AFTER_MS, PERIOD_LABELS, PERIODS, starsToThreshold } from '../constants/defaults';
import { getAccessToken, NotSignedInError } from '../services/auth';
import { GeminiError, NoGeminiKeyError } from '../services/brain';
import { claudeForTask } from '../../services/aiTasks';
import * as db from '../services/db';
import { alignedScore } from '../services/neural';
import { refreshFeed, refreshX } from '../services/pipeline';
import { useXStore, XLoginRequired } from '../services/x';
import type { FeedSource } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useTranscribeStore } from '../store/useTranscribeStore';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Feed'>;

export function FeedScreen({ navigation }: Props) {
  const {
    user,
    geminiKey,
    model,
    pillars,
    rules,
    noteLang,
    learnedPrefs,
    minStars,
    period,
    showRead,
    feedVersion,
    setMinStars,
    setPeriod,
    setShowRead,
    googleSignIn,
    bumpFeed,
  } = useAppStore();

  const [activePillar, setActivePillar] = useState<string | null>(null);
  // YouTube ou X: as duas fontes passam pelo mesmo escudo, cada uma na sua lista.
  const [source, setSource] = useState<FeedSource>('youtube');
  const xConnected = useXStore((s) => s.connected);
  useEffect(() => {
    useXStore.getState().load();
  }, []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'ok' | 'err'; text: string; toSettings?: boolean } | null>(null);

  const sinceIso = useMemo(
    () => new Date(Date.now() - PERIODS[period] * 3600 * 1000).toISOString(),
    [period, feedVersion, refreshing],
  );
  const threshold = starsToThreshold(minStars);

  // A nota de alinhamento é a da IA ajustada pela rede local: quem manda na ordem e
  // no limiar é ela, por isso o filtro é feito aqui, e não na consulta.
  const candidates = useMemo(
    () =>
      db
        .getVideos({ pillar: activePillar, minScore: 0, sinceIso, includeRead: showRead, source })
        .map((v) => ({ video: v, aligned: alignedScore(v) })),
    [activePillar, sinceIso, showRead, feedVersion, source],
  );
  const videos = useMemo(
    () =>
      candidates
        .filter((c) => c.aligned >= threshold || db.isProvisional(c.video))
        .sort(
          (a, b) =>
            b.aligned - a.aligned || (b.video.published_at > a.video.published_at ? 1 : -1),
        )
        .map((c) => c.video),
    [candidates, threshold],
  );
  const alignedById = useMemo(
    () => new Map(candidates.map((c) => [c.video.video_id, c.aligned])),
    [candidates],
  );
  const filteredOut = candidates.length - videos.length;
  // estado vazio: há vídeos no mês fora do período atual? → sugere ampliar
  const outsidePeriod = useMemo(() => {
    if (videos.length > 0 || period === 'month') return 0;
    const monthIso = new Date(Date.now() - PERIODS.month * 3600 * 1000).toISOString();
    return db.countOutsidePeriod(sinceIso, monthIso, threshold);
  }, [videos.length, period, sinceIso, threshold, feedVersion]);
  const newCount = videos.filter((v) => v.read === 0).length;
  // lista vem por score desc: daqui para baixo só há nota provisória abaixo do limiar
  const firstProvisionalBelow = videos.findIndex(
    (v) => (alignedById.get(v.video_id) ?? v.score) < threshold,
  );

  /** O X: lê a sua timeline com a sessão salva e ranqueia os posts novos. */
  const onRefreshX = useCallback(async () => {
    setBanner(null);
    if (!useXStore.getState().connected) {
      navigation.navigate('XLogin');
      return;
    }
    if (!geminiKey && !(await claudeForTask('aspisFeed'))) {
      setBanner({
        kind: 'err',
        text: 'Cole a sua chave do Gemini ou do Claude em Configurações para analisar os posts.',
        toSettings: true,
      });
      return;
    }
    setRefreshing(true);
    try {
      const result = await refreshX(
        { apiKey: geminiKey, model, pillars, rules, noteLang, learnedPrefs },
        period,
        minStars,
        (p) =>
          setBanner({
            kind: 'info',
            text: p.stage === 'reading' ? 'Lendo a sua timeline do X…' : `Analisando… ${p.done}/${p.total} posts`,
          }),
      );
      const bits = [`${result.processed} post(s) analisado(s)`, `${result.above} acima do limiar`];
      if (result.skippedCached) bits.push(`${result.skippedCached} já analisados`);
      if (result.errors) bits.push(`${result.errors} com erro`);
      if (result.capped) bits.push(`${result.capped} ficam para a próxima`);
      setBanner({ kind: 'ok', text: `Pronto · ${bits.join(' · ')}` });
      bumpFeed();
    } catch (e) {
      const keyError =
        e instanceof NoGeminiKeyError || (e instanceof GeminiError && e.isKeyError);
      setBanner({
        kind: 'err',
        text: e instanceof XLoginRequired ? e.message : e instanceof Error ? e.message : String(e),
        toSettings: keyError,
      });
    } finally {
      setRefreshing(false);
    }
  }, [navigation, geminiKey, model, pillars, rules, noteLang, learnedPrefs, period, minStars, bumpFeed]);

  const onRefresh = useCallback(async () => {
    if (source === 'x') {
      await onRefreshX();
      return;
    }
    setBanner(null);
    if (!geminiKey && !(await claudeForTask('aspisFeed'))) {
      setBanner({
        kind: 'err',
        text: 'Cole a sua chave do Gemini ou do Claude em Configurações para analisar vídeos.',
        toSettings: true,
      });
      return;
    }
    setRefreshing(true);
    try {
      let u = user;
      if (!u) u = await googleSignIn();
      if (!u) {
        setBanner({ kind: 'err', text: 'Conecte a sua conta Google para ler as inscrições.' });
        return;
      }
      const token = await getAccessToken();
      const result = await refreshFeed(
        token,
        { apiKey: geminiKey, model, pillars, rules, noteLang, learnedPrefs },
        period,
        minStars,
        (p) => {
          if (p.stage === 'subs') setBanner({ kind: 'info', text: 'Lendo as suas inscrições…' });
          else if (p.stage === 'playlists')
            setBanner({ kind: 'info', text: `Buscando vídeos novos… ${p.done}/${p.total} canais` });
          else setBanner({ kind: 'info', text: `Sintetizando… ${p.done}/${p.total} vídeos` });
        },
      );
      const bits = [
        `${result.processed} processado(s)`,
        `${result.above} acima do limiar`,
      ];
      if (result.skippedCached) bits.push(`${result.skippedCached} já analisados`);
      if (result.errors) bits.push(`${result.errors} com erro`);
      if (result.capped) bits.push(`${result.capped} ficam para a próxima`);
      setBanner({ kind: 'ok', text: `Pronto · ${bits.join(' · ')}` });
      bumpFeed();
      // vídeos sem legenda: transcreve no celular e refaz a triagem
      useTranscribeStore.getState().runAuto();
    } catch (e) {
      const keyError =
        e instanceof NoGeminiKeyError || (e instanceof GeminiError && e.isKeyError);
      setBanner({
        kind: 'err',
        text: e instanceof NotSignedInError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
        toSettings: keyError,
      });
    } finally {
      setRefreshing(false);
    }
  }, [source, onRefreshX, user, geminiKey, model, pillars, rules, noteLang, learnedPrefs, period, minStars, googleSignIn, bumpFeed]);

  // Abrir o app já busca vídeos novos (sem precisar puxar a lista), se a
  // última busca foi há mais de 2h — só com conta e chave já configuradas,
  // para não abrir login/erro sozinho.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !user) return;
    let alive = true;
    void (async () => {
      if (!geminiKey && !(await claudeForTask('aspisFeed'))) return;
      if (!alive || autoRan.current) return;
      autoRan.current = true;
      const last = Date.parse(db.getMeta('last_run') || '');
      if (!Number.isFinite(last) || Date.now() - last > AUTO_REFRESH_AFTER_MS) onRefresh();
    })();
    return () => {
      alive = false;
    };
  }, [user, geminiKey, onRefresh]);

  const header = (
    <View style={styles.header}>
      <View style={styles.topbar}>
        <View style={styles.wordmark}>
          <Image source={require('../../../assets/aspis/logo-mark.png')} style={styles.logo} />
          <Text style={styles.appName}>Aspis</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Media')} hitSlop={10}>
            <Text style={styles.headerAction}>No celular</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Notes')} hitSlop={10}>
            <Text style={styles.headerAction}>Notas</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={10}>
            <Text style={styles.gear}>⚙</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.sources}>
        {(['youtube', 'x'] as FeedSource[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setSource(s);
              setBanner(null);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: source === s }}
            style={[styles.sourceTab, source === s && styles.sourceTabOn]}
          >
            <Text style={[styles.sourceText, source === s && styles.sourceTextOn]}>
              {s === 'youtube' ? 'YouTube' : 'X'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {newCount} {newCount === 1 ? 'novo' : 'novos'}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <PeriodSegment value={period} onChange={setPeriod} />
      </View>

      <View style={styles.chips}>
        <Chip label="Todos" active={activePillar === null} onPress={() => setActivePillar(null)} />
        {pillars.map((p) => (
          <Chip
            key={p.id}
            label={p.mocName || p.nome}
            active={activePillar === p.id}
            onPress={() => setActivePillar(activePillar === p.id ? null : p.id)}
          />
        ))}
        <Chip
          label={showRead ? 'Ocultar lidos' : 'Mostrar lidos'}
          active={showRead}
          onPress={() => setShowRead(!showRead)}
        />
      </View>

      <View style={styles.rulerRow}>
        <StarsRuler value={minStars} onChange={setMinStars} />
      </View>

      {banner && (
        <Pressable
          onPress={banner.toSettings ? () => navigation.navigate('Settings') : undefined}
          style={[styles.banner, banner.kind === 'err' && styles.bannerErr]}
        >
          <Text
            style={[
              styles.bannerText,
              banner.kind === 'ok' && { color: colors.accent.success },
              banner.kind === 'err' && { color: colors.accent.danger },
            ]}
          >
            {banner.text}
            {banner.toSettings ? '  → Configurações' : ''}
          </Text>
        </Pressable>
      )}
    </View>
  );

  const empty = source === 'x' && !xConnected ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>O X, pelo mesmo escudo</Text>
      <Text style={styles.emptyText}>
        Entre na sua conta do X e o Aspis lê a sua timeline "Seguindo", analisa os posts e ranqueia o
        que serve aos seus pilares, como faz com os vídeos. A senha fica na página do X; o app guarda
        só a sessão, neste aparelho.
      </Text>
      <Button
        label="Conectar o X"
        onPress={() => navigation.navigate('XLogin')}
        fullWidth={false}
        style={{ marginTop: spacing.xl, alignSelf: 'center' }}
      />
    </View>
  ) : source === 'x' ? (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>
        {refreshing
          ? 'Lendo a sua timeline do X…'
          : 'Nenhum post analisado no período. Puxe a lista para baixo para ler a timeline.'}
      </Text>
    </View>
  ) : !user ? (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Seu escudo contra o feed</Text>
      <Text style={styles.emptyText}>
        Conecte a sua conta Google para o Aspis ler as SUAS inscrições, analisar os vídeos novos
        e ranquear o que realmente serve aos seus pilares.
      </Text>
      <Button
        label="Conectar conta Google"
        onPress={async () => {
          const u = await googleSignIn().catch(() => null);
          if (u) onRefresh();
        }}
        fullWidth={false}
        style={{ marginTop: spacing.xl, alignSelf: 'center' }}
      />
      <Text style={styles.emptyHint}>
        Dica: você já pode usar o Compartilhar → Noosfera no YouTube, mesmo sem conectar.
      </Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>
        {refreshing
          ? 'Buscando vídeos novos…'
          : filteredOut > 0 || outsidePeriod > 0
            ? 'Nada passou pelos filtros atuais.'
            : 'Nada por aqui no período. Puxe a lista para baixo para buscar vídeos novos.'}
      </Text>
      <View style={styles.emptyActions}>
        {filteredOut > 0 && (
          <Chip
            label={`Ver ${filteredOut} abaixo do limiar`}
            active={false}
            onPress={() => setMinStars(0)}
          />
        )}
        {outsidePeriod > 0 && (
          <Chip
            label={`Ampliar para ${PERIOD_LABELS[period === 'day' ? 'week' : 'month']}`}
            active={false}
            onPress={() => setPeriod(period === 'day' ? 'week' : 'month')}
          />
        )}
        {activePillar && (
          <Chip label="Todos os pilares" active={false} onPress={() => setActivePillar(null)} />
        )}
        {!showRead && (
          <Chip label="Mostrar lidos" active={false} onPress={() => setShowRead(true)} />
        )}
      </View>
    </View>
  );

  return (
    <ScreenContainer>
      <XHarvester />
      <FlatList
        data={videos}
        keyExtractor={(v) => v.video_id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          videos.length > 0 && filteredOut > 0 ? (
            <Pressable onPress={() => setMinStars(0)} hitSlop={8}>
              <Text style={styles.footer}>
                {filteredOut} {source === 'x' ? (filteredOut === 1 ? 'post abaixo' : 'posts abaixo') : filteredOut === 1 ? 'vídeo abaixo' : 'vídeos abaixo'} do limiar ·{' '}
                <Text style={{ color: colors.accent.gold }}>mostrar</Text>
              </Text>
            </Pressable>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent.gold}
            colors={[colors.accent.gold]}
            progressBackgroundColor={colors.bg.gradientEnd}
          />
        }
        renderItem={({ item, index }) => (
          <>
            {index === firstProvisionalBelow && (
              <Text style={styles.divider}>
                Abaixo do limiar, mas com nota provisória (só título e descrição) — a nota
                definitiva vem com a transcrição.
              </Text>
            )}
            <VideoRow
              video={item}
              pillars={pillars}
              expanded={expandedId === item.video_id}
              onPress={() =>
                setExpandedId(expandedId === item.video_id ? null : item.video_id)
              }
            >
              <SynthesisView
                video={item}
                context="feed"
                onChanged={bumpFeed}
                onNeedSettings={() => navigation.navigate('Settings')}
              />
            </VideoRow>
          </>
        )}
        contentContainerStyle={styles.list}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sources: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sourceTab: { paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  sourceTabOn: { borderBottomColor: colors.text.primary },
  sourceText: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.text.tertiary },
  sourceTextOn: { color: colors.text.primary },
  // Recuos maiores que a faixa da grega (~20px) para o conteúdo ficar DENTRO
  // da moldura de meandro, sem o escudo/logo sobrepor a borda.
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  header: { paddingTop: spacing.xl + spacing.xs, paddingBottom: spacing.sm },
  updateBanner: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surfaceStrong,
    borderColor: colors.accent.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  updateBannerText: {
    ...typography.bodyMedium,
    fontSize: 14,
    color: colors.text.primary,
    textAlign: 'center',
  },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: { width: 44, height: 44, borderRadius: 22 },
  appName: { ...typography.title, color: colors.text.primary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  headerAction: { ...typography.bodyMedium, fontSize: 15, color: colors.accent.gold },
  gear: { fontSize: 22, color: colors.text.secondary },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metaText: { ...typography.small, color: colors.text.secondary },
  metaDot: { color: colors.text.tertiary },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.lg,
  },
  rulerRow: { marginTop: spacing.lg },
  banner: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.bg.surface,
  },
  bannerErr: { backgroundColor: 'rgba(228,120,120,0.10)' },
  bannerText: { ...typography.small, color: colors.text.secondary },
  empty: { paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg },
  emptyTitle: {
    ...typography.subtitle,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
  },
  emptyHint: {
    ...typography.small,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  divider: {
    ...typography.small,
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footer: {
    ...typography.small,
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
