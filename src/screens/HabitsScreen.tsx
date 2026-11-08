// "SEUS HÁBITOS": a lista inteira, em quatro gavetas — em formação, formados,
// pausados, arquivados. Cada linha mostra a força, a fase e as duas últimas
// semanas em quadradinhos: dá para ver de relance o que está pegando e o que
// está emperrado, sem abrir nada.
//
// Daqui também sai o modo férias ("Pausar todos"), porque a pausa protege a
// força — e quem viaja sem pausar volta com tudo "vermelho" e desanima.

import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { HabitIcon } from '../components/HabitIcon';
import { PauseSheet, PAUSE_NO_DATE } from '../components/PauseSheet';
import { MiniHeat, STAGE_LABEL, ScreenHeader, StrengthRing, dayLabel, addDays } from '../components/habitShared';
import { colors, spacing, typography } from '../theme';
import { getAllHabitStats, listHabits, pauseAllHabits } from '../services/habitos';
import type { HabitDef, HabitStats } from '../types/habits';

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function pausedText(h: HabitDef): string {
  if (!h.enabled && !h.pausedUntil) return 'desligado';
  if (!h.pausedUntil) return '';
  if (h.pausedUntil === PAUSE_NO_DATE) return 'pausado, sem data';
  return `volta em ${dayLabel(addDays(h.pausedUntil, 1))}`;
}

export function HabitsScreen() {
  const navigation = useNavigation<any>();
  const [habits, setHabits] = useState<HabitDef[] | null>(null);
  const [stats, setStats] = useState<Record<string, HabitStats>>({});
  const [failed, setFailed] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([listHabits({ includeArchived: true }), getAllHabitStats()]);
      setHabits(list);
      setStats(st);
      setFailed(false);
    } catch (err) {
      console.warn('HabitsScreen:', err);
      setFailed(true);
      setHabits((h) => h ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo(() => {
    const all = habits ?? [];
    const archived = all.filter((h) => h.archived);
    const live = all.filter((h) => !h.archived);
    // Desligado (os de fábrica podem vir assim) mora junto dos pausados: não conta, não avisa.
    const paused = live.filter((h) => h.pausedUntil || !h.enabled);
    const active = live.filter((h) => !h.pausedUntil && h.enabled);
    return {
      forming: active.filter((h) => !stats[h.type]?.formed),
      formed: active.filter((h) => stats[h.type]?.formed),
      paused,
      archived,
    };
  }, [habits, stats]);

  const resumeAll = () =>
    Alert.alert('Retomar todos?', 'Os hábitos pausados voltam hoje, com os avisos de antes.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Retomar',
        onPress: async () => {
          try {
            await pauseAllHabits(null);
          } catch {
            Alert.alert('Não consegui retomar agora', 'Tente de novo em instantes.');
          }
          void load();
        },
      },
    ]);

  const renderRow = (h: HabitDef) => {
    const s = stats[h.type];
    const sub = h.pausedUntil || !h.enabled
      ? pausedText(h)
      : h.archived
        ? 'arquivado'
        : s
          ? h.kind === 'parar'
            ? `${STAGE_LABEL[s.stage]} · ${s.cleanDays ?? 0} dias limpos`
            : STAGE_LABEL[s.stage]
          : '';
    return (
      <Pressable
        key={h.type}
        onPress={() => navigation.navigate('HabitDetail', { type: h.type })}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={`${h.title}${s ? `, força ${Math.round(s.strength * 100)}%, ${STAGE_LABEL[s.stage]}` : ''}`}
      >
        <View style={styles.icon}>
          <HabitIcon emoji={h.emoji} size={22} color={h.pausedUntil || h.archived ? colors.text.tertiary : colors.text.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {cap(h.title)}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
          {s && !h.archived ? (
            <View style={{ marginTop: 6 }}>
              <MiniHeat heat={s.heat} days={14} />
            </View>
          ) : null}
        </View>
        {s && !h.archived ? <StrengthRing value={s.strength} size={40} /> : null}
      </Pressable>
    );
  };

  // Uma função (não um componente): declarado aqui dentro, um componente
  // seria outro a cada render e remontaria as linhas.
  const renderSection = (title: string, list: HabitDef[], hint?: string) =>
    list.length === 0 ? null : (
      <View style={{ marginBottom: spacing.lg }}>
        <Text style={styles.sectionTitle}>
          {title} <Text style={styles.sectionCount}>({list.length})</Text>
        </Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <Card style={{ paddingVertical: spacing.xs }}>{list.map(renderRow)}</Card>
      </View>
    );

  const anyActive = sections.forming.length + sections.formed.length > 0;

  return (
    <ScreenContainer>
      <ScreenHeader title="Seus hábitos" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {habits === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        ) : (
          <>
            {failed && <Text style={styles.hint}>Os hábitos não carregaram agora. Tente reabrir a tela.</Text>}
            {!failed && habits.length === 0 && (
              <Card style={{ marginBottom: spacing.lg }}>
                <Text style={styles.emptyTitle}>Nenhum hábito ainda</Text>
                <Text style={styles.hint}>
                  Comece por um, pequeno, ligado a algo que você já faz todo dia. A pesquisa sugere poucos
                  por vez: cada hábito novo pede atenção até pegar.
                </Text>
              </Card>
            )}
            {renderSection('Em formação', sections.forming, 'A força sobe com a repetição; uma falta não zera nada.')}
            {renderSection('Formados', sections.formed, 'Já saem sem pensar. A coruja fica quieta e confere a cada duas semanas.')}
            {renderSection('Pausados', sections.paused, 'Dias pausados não contam: a força fica parada.')}
            {sections.archived.length > 0 && (
              <Pressable
                onPress={() => setShowArchived((v) => !v)}
                style={styles.toggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: showArchived }}
              >
                <Text style={styles.toggleText}>
                  {showArchived ? 'Esconder arquivados' : `Arquivados (${sections.archived.length})`}
                </Text>
              </Pressable>
            )}
            {showArchived && renderSection('Arquivados', sections.archived)}
          </>
        )}

        <View style={{ height: spacing.md }} />
        <Button label="Novo hábito" onPress={() => navigation.navigate('HabitEdit')} />
        <View style={{ height: spacing.sm }} />
        {sections.paused.length > 0 && !anyActive ? (
          <Button label="Retomar todos" variant="secondary" onPress={resumeAll} />
        ) : (
          <Button
            label="Pausar todos (férias)"
            variant="secondary"
            onPress={() => setPauseOpen(true)}
            disabled={!anyActive}
          />
        )}
        {sections.paused.length > 0 && anyActive ? (
          <Pressable onPress={resumeAll} style={styles.toggle} accessibilityRole="button">
            <Text style={styles.toggleText}>Retomar os pausados</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => navigation.navigate('Reminders')}
          style={styles.remindersLink}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>Lembretes →</Text>
          <Text style={styles.linkHint}>Remédios, suplementos, jejum e avisos — esses lembram sempre.</Text>
        </Pressable>
      </ScrollView>

      <PauseSheet
        visible={pauseOpen}
        title="Pausar todos os hábitos"
        subtitle="Férias, doença, uma fase corrida: pausar protege o que você construiu."
        onClose={() => setPauseOpen(false)}
        onConfirm={async (until) => {
          try {
            await pauseAllHabits(until);
          } catch {
            Alert.alert('Não consegui pausar agora', 'Tente de novo em instantes.');
          }
          void load();
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  sectionTitle: { ...typography.subtitle, color: colors.text.primary, marginBottom: 2 },
  sectionCount: { ...typography.body, color: colors.text.tertiary },
  hint: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.sm, lineHeight: 18 },
  emptyTitle: { ...typography.subtitle, color: colors.text.primary, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: { width: 28, alignItems: 'center' },
  title: { ...typography.bodyMedium, color: colors.text.primary },
  sub: { ...typography.small, color: colors.text.secondary },
  toggle: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  toggleText: { ...typography.bodyMedium, color: colors.accent.gold },
  remindersLink: { minHeight: 44, paddingVertical: spacing.lg, alignItems: 'center' },
  linkText: { ...typography.bodyMedium, color: colors.accent.gold },
  linkHint: { ...typography.small, color: colors.text.tertiary, textAlign: 'center', marginTop: 2 },
});
