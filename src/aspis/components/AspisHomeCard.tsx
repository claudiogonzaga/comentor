import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { Card } from '../../components/Card';
import { GreekIcon } from '../../components/GreekIcon';
import { colors, spacing, typography } from '../../theme';
import { startAspis } from '../bootstrap';
import * as db from '../services/db';
import type { VideoRecord } from '../types';

const WINDOW_MS = 3 * 86_400_000;

// A Home mostra UMA coisa do Aspis: o melhor vídeo não lido dos últimos dias,
// já com o título neutro. O resto fica dentro da seção — a Home não vira feed.
export function AspisHomeCard() {
  const navigation = useNavigation<any>();
  const [top, setTop] = useState<VideoRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void startAspis().then(() => {
        if (!alive) return;
        try {
          const list = db.getVideos({
            sinceIso: new Date(Date.now() - WINDOW_MS).toISOString(),
            includeRead: false,
          });
          setTop([...list].sort((a, b) => b.score - a.score)[0] ?? null);
        } catch {
          setTop(null);
        }
        setLoaded(true);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!loaded) return null;
  return (
    <Pressable onPress={() => navigation.navigate('Aspis')} accessibilityRole="button">
      <Card style={styles.card}>
        <View style={styles.head}>
          <GreekIcon name="sparkle" size={18} color={colors.accent.gold} />
          <Text style={styles.title}>ASPIS · O MELHOR DE HOJE</Text>
        </View>
        {top ? (
          <>
            <Text style={styles.text} numberOfLines={3}>
              {top.neutral_title || top.original_title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {top.channel} · abrir a síntese ›
            </Text>
          </>
        ) : (
          <Text style={styles.meta}>Nada novo por aqui. Abra a aba Aspis para buscar, ou compartilhe um vídeo do YouTube ›</Text>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...typography.label, color: colors.accent.gold, letterSpacing: 1 },
  text: { ...typography.body, color: colors.text.primary, lineHeight: 22 },
  meta: { ...typography.small, color: colors.text.secondary, marginTop: spacing.xs },
});
