import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { colors, spacing, typography } from '../theme';
import { listActiveInspirationCards } from '../services/database';
import type { InspirationCard } from '../types';

// Painel de INSPIRAÇÃO (separado do painel de lembretes). Mostra uma frase/fato
// da biblioteca ativa — uma por dia (determinístico) — e deixa trocar por outra.

function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000);
}

export function InspirationHomeCard() {
  const [cards, setCards] = useState<InspirationCard[] | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    listActiveInspirationCards()
      .then((cs) => {
        setCards(cs);
        if (cs.length) setIdx(dayOfYear() % cs.length);
      })
      .catch(() => setCards([]));
  }, []);

  const shuffle = useCallback(() => {
    if (cards && cards.length > 1) setIdx((i) => (i + 1) % cards.length);
  }, [cards]);

  if (!cards || cards.length === 0) return null;
  const card = cards[idx];
  // Alguns cards já trazem o autor embutido no texto (ex.: '"…" — Fulano') e
  // também no campo author — então só mostramos a linha do autor se ela ainda
  // NÃO estiver no texto. Também não adicionamos aspas se o texto já tem.
  const text = card.text.trim();
  const hasOwnQuotes = /["“”']/.test(text.charAt(0));
  const display = card.type === 'quote' && !hasOwnQuotes ? `“${text}”` : text;
  const showAuthor = !!card.author && !text.includes(card.author);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <GreekIcon name="sun" size={18} color={colors.accent.gold} />
          <Text style={styles.title}>INSPIRAÇÃO</Text>
        </View>
        <Pressable onPress={shuffle} hitSlop={8}>
          <Text style={styles.another}>outra ↻</Text>
        </Pressable>
      </View>
      <Text style={styles.text}>{display}</Text>
      {showAuthor ? <Text style={styles.author}>— {card.author}</Text> : null}
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
});
