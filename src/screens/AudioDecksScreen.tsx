import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  AUDIO_CLIP_MAX_MS,
  getKV,
  listAudioClips,
  listAudioDecks,
  setAudioDeckEnabled,
  setAudioDeckMode,
  setKV,
} from '../services/database';
import {
  AUDIO_DECK_SPEC,
  clipAvailable,
  deleteAudioDeck,
  exportAudioDeck,
  importAudioDeckFromZip,
  stopClip,
  subscribeClipPlayback,
  toggleClip,
} from '../services/audioDecks';
import { rateAudioClip, scheduleInspirationNotifications } from '../services/inspiration';
import { useAppStore } from '../store/useAppStore';
import type { AudioClip, AudioDeck } from '../types';

/**
 * Baralhos de ÁUDIO: trechos curtos (ex.: passagens de um audiolivro) que a pessoa
 * importa num ZIP e o app toca nos alertas de inspiração — sem gastar a API. Cada
 * baralho é independente, toca aleatório ou na sequência, e cada trecho conta os
 * 👍/👎 recebidos e as vezes que tocou. Dá para exportar o baralho com essas
 * estatísticas (backup) e importar de volta.
 */

const MIX_KEY = 'inspiration_mix_text';

function fmtDur(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

export function AudioDecksScreen() {
  const navigation = useNavigation<any>();
  const config = useAppStore((s) => s.config);
  const [decks, setDecks] = useState<AudioDeck[] | null>(null);
  const [mixText, setMixText] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<AudioDeck | null>(null);
  const [clips, setClips] = useState<AudioClip[] | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setDecks(await listAudioDecks());
    } catch {
      setDecks([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      void getKV(MIX_KEY).then((v) => setMixText(v === '1'));
      return () => stopClip();
    }, [reload]),
  );
  useEffect(() => subscribeClipPlayback(setPlayingId), []);

  const reschedule = () => {
    void scheduleInspirationNotifications().catch(() => {});
  };

  const openDeck = async (deck: AudioDeck) => {
    setOpen(deck);
    setClips(null);
    setClips(await listAudioClips(deck.id));
  };

  const reloadClips = async () => {
    if (!open) return;
    setClips(await listAudioClips(open.id));
    await reload();
  };

  const handleImport = async () => {
    if (busy) return;
    setBusy('Escolhendo o arquivo…');
    try {
      const r = await importAudioDeckFromZip((m) => setBusy(m));
      if (r.error) {
        Alert.alert('Importar baralho de áudio', r.error);
        return;
      }
      if (!r.deckId) return; // cancelou
      await reload();
      reschedule();
      const lines = [`"${r.name}": ${r.imported} trechos importados.`];
      if (r.restoredStats) lines.push('As estatísticas (👍, 👎, execuções) foram restauradas.');
      if (r.tooLong) lines.push(`${r.tooLong} trecho(s) passam de ${AUDIO_DECK_SPEC.maxClipSeconds} s e não vão tocar nos alertas.`);
      if (r.skipped.length) {
        lines.push(
          `${r.skipped.length} arquivo(s) ignorado(s): ` +
            r.skipped.slice(0, 4).map((s) => `${s.name} (${s.reason})`).join('; ') +
            (r.skipped.length > 4 ? '…' : ''),
        );
      }
      Alert.alert('Baralho importado', lines.join('\n\n'));
    } catch (e) {
      Alert.alert('Importar baralho de áudio', e instanceof Error ? e.message : 'Algo deu errado na importação.');
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async (deck: AudioDeck) => {
    if (busy) return;
    setBusy('Preparando o zip…');
    try {
      const r = await exportAudioDeck(deck.id);
      if (!r.ok && r.error) Alert.alert('Exportar baralho', r.error);
    } catch (e) {
      Alert.alert('Exportar baralho', e instanceof Error ? e.message : 'Algo deu errado na exportação.');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = (deck: AudioDeck) => {
    if (busy) return;
    Alert.alert(
      'Excluir baralho',
      `Remover "${deck.name}", os ${deck.clipCount} trechos e as estatísticas? Exporte antes se quiser guardar o backup.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            await deleteAudioDeck(deck.id);
            setOpen(null);
            await reload();
            reschedule();
          },
        },
      ],
    );
  };

  const toggleMix = async (v: boolean) => {
    setMixText(v);
    await setKV(MIX_KEY, v ? '1' : '0');
    reschedule();
  };

  const rate = async (clip: AudioClip, rating: -1 | 0 | 1) => {
    await rateAudioClip(clip.id, rating);
    await reloadClips();
  };

  const spokenOff = !config?.spokenNudgesEnabled || !!config?.silentMode;
  const inspirationOff = !config?.inspirationModeEnabled;

  // ——— Vista de TRECHOS de um baralho ———
  if (open) {
    return (
      <ScreenContainer>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              stopClip();
              setOpen(null);
              void reload();
            }}
          >
            <Text style={styles.back}>‹ Baralhos</Text>
          </Pressable>
          <Text style={[typography.subtitle, { color: colors.text.primary }]} numberOfLines={1}>
            {open.name}
          </Text>
          <View style={{ width: 60 }} />
        </View>
        {clips === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        ) : (
          <FlatList
            data={clips}
            keyExtractor={(c) => String(c.id)}
            contentContainerStyle={styles.scroll}
            ListHeaderComponent={
              <Text style={styles.hint}>
                {open.playMode === 'random'
                  ? '👍 faz o trecho tocar mais vezes; 👎 o elimina dos alertas (dá para desfazer). Sem nota, ele toca com a probabilidade normal. '
                  : 'Na sequência, 👎 pula o trecho (dá para desfazer); 👍 só conta nas estatísticas. '}
                Os contadores só crescem: guardam cada 👍/👎 e cada vez que tocou (as execuções por alerta com o app
                fechado são contadas quando você o abre).
              </Text>
            }
            renderItem={({ item }) => {
              const tooLong = item.durationMs != null && item.durationMs > AUDIO_CLIP_MAX_MS;
              const missing = !clipAvailable(item);
              return (
                <Card style={StyleSheet.flatten([styles.clipRow, item.rating < 0 && styles.dim])}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={playingId === item.id ? 'Parar' : 'Ouvir'}
                    disabled={missing}
                    onPress={() => toggleClip(item)}
                    style={[styles.playBtn, playingId === item.id && styles.playBtnOn, missing && { opacity: 0.35 }]}
                  >
                    <Text style={styles.playGlyph}>{playingId === item.id ? '⏹' : '▶'}</Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clipTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {item.text ? (
                      <Text style={styles.clipText} numberOfLines={3}>
                        {item.text}
                      </Text>
                    ) : null}
                    <Text style={styles.clipMeta}>
                      {fmtDur(item.durationMs)}
                      {item.author ? ` · ${item.author}` : ''}
                      {' · '}👍 {item.likes} · 👎 {item.dislikes} · ▶ {item.plays}
                    </Text>
                    {tooLong ? (
                      <Text style={styles.warnText}>Mais de {AUDIO_DECK_SPEC.maxClipSeconds} s — não toca nos alertas.</Text>
                    ) : null}
                    {missing ? <Text style={styles.warnText}>Arquivo de áudio ausente neste aparelho.</Text> : null}
                  </View>
                  <View style={styles.rateCol}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Gostei: toca mais vezes"
                      accessibilityState={{ selected: item.rating > 0 }}
                      onPress={() => rate(item, item.rating > 0 ? 0 : 1)}
                      hitSlop={6}
                      style={[styles.rateBtn, item.rating > 0 && styles.rateBtnOn]}
                    >
                      <Text style={styles.rateGlyph}>👍</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Eliminar do baralho"
                      accessibilityState={{ selected: item.rating < 0 }}
                      onPress={() => rate(item, item.rating < 0 ? 0 : -1)}
                      hitSlop={6}
                      style={[styles.rateBtn, item.rating < 0 && styles.rateBtnOn]}
                    >
                      <Text style={styles.rateGlyph}>👎</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            }}
          />
        )}
      </ScreenContainer>
    );
  }

  // ——— Vista dos BARALHOS ———
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Baralhos de áudio</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>
          Trechos de áudio prontos (por exemplo, passagens de um audiolivro) tocam nos alertas de inspiração no lugar
          da voz sintética — sem gastar a API. Cada baralho é independente.
        </Text>

        {(spokenOff || inspirationOff) && (
          <Card style={styles.warnCard}>
            <Text style={styles.warnText}>
              {inspirationOff
                ? 'O modo inspiração está desligado: nada toca. Ligue em Sons e Notificações.'
                : config?.silentMode
                  ? 'O modo silencioso está ligado: o alerta chega só como notificação, sem tocar o áudio.'
                  : 'Os avisos falados estão desligados: o alerta chega só como notificação, sem tocar o áudio. Ligue "Falar em voz alta" em Sons e Notificações.'}
            </Text>
          </Card>
        )}

        {(decks ?? []).map((d) => (
          <Card key={d.id} style={styles.deckCard}>
            <View style={styles.deckTop}>
              <Pressable style={{ flex: 1 }} onPress={() => void openDeck(d)}>
                <Text style={styles.deckName} numberOfLines={2}>
                  {d.name}
                </Text>
                <Text style={styles.deckSub}>
                  {d.activeCount} de {d.clipCount} trechos ativos · 👍 {d.likes} · 👎 {d.dislikes} · ▶ {d.plays}
                </Text>
              </Pressable>
              <Switch
                value={d.enabled}
                onValueChange={async (v) => {
                  await setAudioDeckEnabled(d.id, v);
                  await reload();
                  reschedule();
                }}
                trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                thumbColor={d.enabled ? colors.text.onGold : colors.text.tertiary}
              />
            </View>
            <View style={styles.chips}>
              {(['random', 'sequence'] as const).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityState={{ selected: d.playMode === m }}
                  onPress={async () => {
                    await setAudioDeckMode(d.id, m);
                    await reload();
                    reschedule();
                  }}
                  style={[styles.chip, d.playMode === m && styles.chipOn]}
                >
                  <Text style={[styles.chipText, d.playMode === m && styles.chipTextOn]}>
                    {m === 'random' ? 'Aleatório' : 'Na sequência'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.deckHint}>
              {d.playMode === 'random'
                ? 'Sorteia os trechos: 👍 pesa 4× mais, 👎 elimina, sem nota é a probabilidade normal.'
                : 'Toca na ordem dos arquivos e continua de onde parou no dia seguinte. 👎 pula o trecho; 👍 só conta nas estatísticas.'}
            </Text>
            <View style={styles.deckActions}>
              <Pressable onPress={() => void openDeck(d)} hitSlop={6}>
                <Text style={styles.link}>Ver trechos</Text>
              </Pressable>
              <Pressable onPress={() => void handleExport(d)} hitSlop={6}>
                <Text style={styles.link}>Exportar (backup)</Text>
              </Pressable>
              <Pressable onPress={() => handleDelete(d)} hitSlop={6}>
                <Text style={styles.linkDanger}>Excluir</Text>
              </Pressable>
            </View>
          </Card>
        ))}

        {decks && decks.length > 0 && (
          <View style={styles.mixRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>Misturar com as frases de texto</Text>
              <Text style={styles.deckHint}>
                Desligado: com baralho de áudio ligado, só os áudios tocam. Ligado: os horários se dividem entre os
                baralhos de áudio e as frases de texto.
              </Text>
            </View>
            <Switch
              value={mixText}
              onValueChange={toggleMix}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={mixText ? colors.text.onGold : colors.text.tertiary}
            />
          </View>
        )}

        <Card style={styles.importCard}>
          <Text style={styles.importTitle}>Importar baralho de áudio</Text>
          <Text style={styles.importLine}>• Um arquivo .zip com os trechos na raiz (ou em uma pasta).</Text>
          <Text style={styles.importLine}>
            • Formatos: MP3 ou M4A (também WAV, OGG, AAC, OPUS, FLAC). Recomendado: MP3 mono, 64–96 kbps.
          </Text>
          <Text style={styles.importLine}>
            • Cada trecho de 5 a 60 s (máximo {AUDIO_DECK_SPEC.maxClipSeconds} s e {AUDIO_DECK_SPEC.maxClipBytes / 1048576} MB),
            começando e terminando em uma frase inteira e com o volume nivelado entre os trechos.
          </Text>
          <Text style={styles.importLine}>
            • Até {AUDIO_DECK_SPEC.maxClips} trechos e {AUDIO_DECK_SPEC.maxZipBytes / 1048576} MB por zip. Vários baralhos são
            independentes: importe um zip para cada.
          </Text>
          <Text style={styles.importLine}>
            • Nomes como 001-titulo.mp3: a ordem alfabética/numérica é a ordem da sequência.
          </Text>
          <Text style={styles.importLine}>
            • Opcional: um deck.csv (Arquivo, Título, Texto, Autor) para mostrar o texto do trecho no card e na
            notificação. Um zip exportado pelo app traz também Nota, Curtidas, Descurtidas, Execuções e Última
            execução — e importar de volta restaura tudo.
          </Text>
          <View style={{ height: spacing.sm }} />
          <Button label="Escolher arquivo .zip" variant="secondary" onPress={handleImport} loading={!!busy} />
          {busy ? <Text style={styles.busy}>{busy}</Text> : null}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { ...typography.bodyMedium, color: colors.accent.gold, minWidth: 60 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  loading: { paddingTop: spacing.xxl, alignItems: 'center' },
  hint: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.md, lineHeight: 18 },
  warnCard: { marginBottom: spacing.md },
  warnText: { ...typography.small, color: colors.accent.gold, lineHeight: 17 },
  deckCard: { marginBottom: spacing.md },
  deckTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  deckName: { ...typography.bodyMedium, color: colors.text.primary },
  deckSub: { ...typography.small, color: colors.text.secondary, marginTop: 2 },
  deckHint: { ...typography.small, color: colors.text.tertiary, marginTop: spacing.xs, lineHeight: 17 },
  chips: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  chipOn: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.12)' },
  chipText: { ...typography.small, color: colors.text.secondary },
  chipTextOn: { color: colors.accent.gold },
  deckActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  link: { ...typography.small, color: colors.accent.gold },
  linkDanger: { ...typography.small, color: colors.accent.danger },
  mixRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  importCard: { marginTop: spacing.sm },
  importTitle: { ...typography.bodyMedium, color: colors.text.primary, marginBottom: spacing.xs },
  importLine: { ...typography.small, color: colors.text.secondary, lineHeight: 18, marginBottom: 3 },
  busy: { ...typography.small, color: colors.text.secondary, textAlign: 'center', marginTop: spacing.sm },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  dim: { opacity: 0.5 },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnOn: { backgroundColor: 'rgba(244,197,83,0.18)' },
  playGlyph: { color: colors.accent.gold, fontSize: 16 },
  clipTitle: { ...typography.bodyMedium, color: colors.text.primary },
  clipText: { ...typography.small, color: colors.text.secondary, marginTop: 2, lineHeight: 17 },
  clipMeta: { ...typography.small, color: colors.text.tertiary, marginTop: 4 },
  rateCol: { gap: spacing.xs },
  rateBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  rateBtnOn: { borderColor: colors.accent.gold, backgroundColor: colors.bg.surfaceStrong },
  rateGlyph: { fontSize: 15 },
});
