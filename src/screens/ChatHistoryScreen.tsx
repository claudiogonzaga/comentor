import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { ChatBubble } from '../components/ChatBubble';
import { GreekIcon } from '../components/GreekIcon';
import { colors, spacing, typography } from '../theme';
import { getSleepHabitId } from '../services/coach';
import { getAllChat } from '../services/database';
import type { ChatMessage } from '../types';

// Histórico de conversas: TODAS as mensagens salvas no aparelho, agrupadas por
// dia. Somente leitura — a conversa do dia continua no "Chat com Comentora".

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoje';
  if (dayKey(iso) === dayKey(yest.toISOString())) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

export function ChatHistoryScreen() {
  const navigation = useNavigation<any>();
  const [groups, setGroups] = useState<{ label: string; items: ChatMessage[] }[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const hid = await getSleepHabitId();
        const all = await getAllChat(hid);
        // agrupa por dia mantendo a ordem cronológica
        const out: { label: string; key: string; items: ChatMessage[] }[] = [];
        for (const m of all) {
          const k = dayKey(m.createdAt);
          const last = out[out.length - 1];
          if (last && last.key === k) last.items.push(m);
          else out.push({ label: dayLabel(m.createdAt), key: k, items: [m] });
        }
        setGroups(out.map(({ label, items }) => ({ label, items })));
      } catch {
        setGroups([]);
      }
    })();
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.back}>
          <GreekIcon name="chevronRight" size={22} color={colors.text.primary} />
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>
          Conversas anteriores
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {groups === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>Ainda não há conversas salvas.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {groups.map((g, gi) => (
            <View key={gi} style={styles.group}>
              <Text style={styles.dayLabel}>{g.label}</Text>
              {g.items.map((m) => (
                <ChatBubble key={m.id} role={m.role} content={m.content} />
              ))}
            </View>
          ))}
          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  back: { transform: [{ rotate: '180deg' }] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: spacing.xxl },
  empty: { ...typography.body, color: colors.text.tertiary },
  scroll: { paddingTop: spacing.sm },
  group: { marginBottom: spacing.lg },
  dayLabel: {
    ...typography.small,
    color: colors.text.tertiary,
    textTransform: 'capitalize',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
});
