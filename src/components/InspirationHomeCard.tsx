import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import { getInspirationCardById, listActiveInspirationCards } from '../services/database';
import { getCurrentInspiration, rateAudioClip, rateInspirationCard } from '../services/inspiration';
import { getAudioClip } from '../services/database';
import { stopClip, subscribeClipPlayback, toggleClip } from '../services/audioDecks';
import type { AudioClip, InspirationCard } from '../types';

// Painel de INSPIRAÇÃO (separado do painel de lembretes).
//
// Mostra o card do ÚLTIMO alerta de inspiração que disparou — falado ou só
// notificação — e o mantém visível até o próximo chegar, para a pessoa poder
// avaliar com 👍/👎 (curtido aparece mais; descurtido nunca mais). Se o modo
// inspiração está desligado (nada disparou), mostra uma frase do dia, como antes.

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000);
}

/** Relê o card atual a cada minuto: o próximo alerta troca o card sem abrir a tela de novo. */
const REFRESH_MS = 60_000;

export function InspirationHomeCard() {
  const [card, setCard] = useState<InspirationCard | null>(null);
  // Trecho de ÁUDIO do último alerta (baralho de áudio) e o nome do baralho.
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckTotal, setDeckTotal] = useState(0);
  const [playingId, setPlayingId] = useState<number | null>(null);
  // true = veio de um alerta disparado; false = frase do dia (modo desligado)
  const [fromAlert, setFromAlert] = useState(false);
  const [dayPool, setDayPool] = useState<InspirationCard[] | null>(null);
  const [idx, setIdx] = useState(0);
  const idxTouched = useRef(false);

  const load = useCallback(async () => {
    try {
      const current = await getCurrentInspiration();
      if (current?.kind === 'clip') {
        setClip(current.clip);
        setDeckName(current.deckName);
        setDeckTotal(current.total);
        setCard(null);
        setFromAlert(true);
        return;
      }
      setClip(null);
      if (current?.kind === 'card') {
        // o card pode ter sido excluído da biblioteca depois do alerta
        if (!current.card.deleted) {
          setCard(current.card);
          setFromAlert(true);
          return;
        }
      }
      setFromAlert(false);
      const pool = await listActiveInspirationCards();
      setDayPool(pool);
      if (!idxTouched.current && pool.length) setIdx(dayOfYear() % pool.length);
      setCard(null);
    } catch {
      setCard(null);
      setDayPool([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(() => void load(), REFRESH_MS);
      return () => {
        clearInterval(t);
        stopClip();
      };
    }, [load]),
  );

  useEffect(() => subscribeClipPlayback(setPlayingId), []);

  const rateClip = useCallback(async (target: AudioClip, rating: -1 | 0 | 1) => {
    setClip((c) => (c && c.id === target.id ? { ...c, rating } : c));
    try {
      await rateAudioClip(target.id, rating);
      const fresh = await getAudioClip(target.id);
      if (fresh) setClip((c) => (c && c.id === fresh.id ? fresh : c));
    } catch {
      /* a nota fica só na tela; tenta de novo no próximo toque */
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);

  const shuffle = useCallback(() => {
    if (dayPool && dayPool.length > 1) {
      idxTouched.current = true;
      setIdx((i) => (i + 1) % dayPool.length);
    }
  }, [dayPool]);

  const rate = useCallback(
    async (target: InspirationCard, rating: -1 | 0 | 1) => {
      // Atualiza na hora; a gravação e o reagendamento seguem em segundo plano.
      setCard((c) => (c && c.id === target.id ? { ...c, rating } : c));
      setDayPool((p) => p && p.map((x) => (x.id === target.id ? { ...x, rating } : x)));
      try {
        await rateInspirationCard(target.id, rating);
        const fresh = await getInspirationCardById(target.id);
        if (fresh) {
          setCard((c) => (c && c.id === fresh.id ? fresh : c));
        }
      } catch {
        /* a nota fica só na tela; tenta de novo no próximo toque */
      }
    },
    [],
  );

  // ——— Trecho de ÁUDIO: toca o arquivo importado (sem API) e deixa avaliar ———
  if (fromAlert && clip) {
    const cDisliked = clip.rating < 0;
    const cLiked = clip.rating > 0;
    return (
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headLeft}>
            <GreekIcon name="sun" size={18} color={colors.accent.gold} />
            <Text style={styles.title}>ÚLTIMA INSPIRAÇÃO · ÁUDIO</Text>
          </View>
        </View>
        {cDisliked ? (
          <View>
            <Text style={styles.dislikedText}>Combinado: este trecho não vai mais tocar.</Text>
            <Pressable onPress={() => void rateClip(clip, 0)} hitSlop={8} style={styles.undo}>
              <Text style={styles.undoText}>desfazer</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.author}>
              {deckName} · trecho {clip.ord + 1} de {deckTotal}
              {clip.reference ? ` · ${clip.reference}` : ''}
            </Text>
            <Text style={styles.text}>{clip.text?.trim() || clip.title}</Text>
            {clip.author ? <Text style={styles.author}>— {clip.author}</Text> : null}
            <View style={styles.rateRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playingId === clip.id ? 'Parar o trecho' : 'Ouvir o trecho'}
                onPress={() => toggleClip(clip)}
                style={[styles.rateBtn, playingId === clip.id && styles.rateBtnOn]}
                hitSlop={6}
              >
                <Text style={[styles.rateText, playingId === clip.id && styles.rateTextOn]}>
                  {playingId === clip.id ? '⏹ Parar' : '▶ Ouvir'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Gostei deste trecho"
                accessibilityState={{ selected: cLiked }}
                onPress={() => void rateClip(clip, cLiked ? 0 : 1)}
                style={[styles.rateBtn, cLiked && styles.rateBtnOn]}
                hitSlop={6}
              >
                <Text style={[styles.rateText, cLiked && styles.rateTextOn]}>👍</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Não quero mais este trecho"
                onPress={() => void rateClip(clip, -1)}
                style={styles.rateBtn}
                hitSlop={6}
              >
                <Text style={styles.rateText}>👎</Text>
              </Pressable>
            </View>
          </>
        )}
      </Card>
    );
  }

  const shown: InspirationCard | null = fromAlert ? card : dayPool?.[idx] ?? null;
  if (!shown) return null;

  // Alguns cards já trazem o autor embutido no texto (ex.: '"…" — Fulano') e
  // também no campo author — então só mostramos a linha do autor se ela ainda
  // NÃO estiver no texto. Também não adicionamos aspas se o texto já tem.
  const text = shown.text.trim();
  const hasOwnQuotes = /["“”']/.test(text.charAt(0));
  const display = shown.type === 'quote' && !hasOwnQuotes ? `“${text}”` : text;
  const showAuthor = !!shown.author && !text.includes(shown.author);
  const disliked = shown.rating < 0;
  const liked = shown.rating > 0;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <GreekIcon name="sun" size={18} color={colors.accent.gold} />
          <Text style={styles.title}>{fromAlert ? 'ÚLTIMA INSPIRAÇÃO' : 'INSPIRAÇÃO'}</Text>
        </View>
        {!fromAlert ? (
          <Pressable onPress={shuffle} hitSlop={8}>
            <Text style={styles.another}>outra ↻</Text>
          </Pressable>
        ) : null}
      </View>

      {disliked ? (
        <View>
          <Text style={styles.dislikedText}>Combinado: esta frase não vai mais aparecer.</Text>
          <Pressable onPress={() => void rate(shown, 0)} hitSlop={8} style={styles.undo}>
            <Text style={styles.undoText}>desfazer</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.text}>{display}</Text>
          {showAuthor ? <Text style={styles.author}>— {shown.author}</Text> : null}
          <View style={styles.rateRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Gostei desta frase"
              accessibilityState={{ selected: liked }}
              onPress={() => void rate(shown, liked ? 0 : 1)}
              style={[styles.rateBtn, liked && styles.rateBtnOn]}
              hitSlop={6}
            >
              <Text style={[styles.rateText, liked && styles.rateTextOn]}>👍 {liked ? 'Vai aparecer mais' : 'Gostei'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Não quero mais ver esta frase"
              onPress={() => void rate(shown, -1)}
              style={styles.rateBtn}
              hitSlop={6}
            >
              <Text style={styles.rateText}>👎 Não quero mais</Text>
            </Pressable>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.label, color: colors.accent.gold, letterSpacing: 1 },
  another: { ...typography.small, color: colors.text.tertiary },
  text: { ...typography.body, color: colors.text.primary, lineHeight: 22 },
  author: { ...typography.small, color: colors.text.secondary, marginTop: spacing.sm },
  rateRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  rateBtn: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  rateBtnOn: { borderColor: colors.accent.gold, backgroundColor: colors.bg.surfaceStrong },
  rateText: { ...typography.small, color: colors.text.secondary },
  rateTextOn: { color: colors.accent.gold },
  dislikedText: { ...typography.body, color: colors.text.secondary },
  undo: { alignSelf: 'flex-start', marginTop: spacing.xs },
  undoText: { ...typography.small, color: colors.accent.gold },
});
