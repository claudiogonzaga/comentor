import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { AI_TASKS, loadAiTaskChoices, setAiTaskChoice, type AiTaskChoice, type AiTaskId } from '../services/aiTasks';
import { CLAUDE_EFFORTS, CLAUDE_MODELS } from '../services/claude';

// O modelo e o raciocínio de cada tarefa, como na tela "Configurar a IA" do Grafê.
// Toque numa tarefa para escolher; tudo salva na hora.

const shortName = (label: string) => label.replace('Claude ', '');

export function AiTaskTable() {
  const [choices, setChoices] = useState<Record<AiTaskId, AiTaskChoice> | null>(null);
  const [open, setOpen] = useState<AiTaskId | null>(null);

  useEffect(() => {
    void loadAiTaskChoices().then(setChoices);
  }, []);

  const change = (id: AiTaskId, patch: { model?: string; effort?: string }) => {
    setChoices((c) => (c ? { ...c, [id]: { ...c[id], ...patch } } : c));
    void setAiTaskChoice(id, patch).catch(() => {});
  };

  if (!choices) return null;

  return (
    <View>
      <Text style={[styles.label, { marginTop: spacing.md }]}>O modelo de cada tarefa</Text>
      {AI_TASKS.map((t) => {
        const c = choices[t.id];
        const isOpen = open === t.id;
        const modelLabel = CLAUDE_MODELS.find((m) => m.id === c.model)?.label ?? c.model;
        const effortLabel = CLAUDE_EFFORTS.find((e) => e.id === c.effort)?.label ?? c.effort;
        return (
          <View key={t.id} style={[styles.task, isOpen && styles.taskOpen]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              onPress={() => setOpen(isOpen ? null : t.id)}
              style={styles.taskHead}
            >
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>{t.label}</Text>
                <Text style={[typography.small, { color: colors.text.secondary }]}>
                  {shortName(modelLabel)} · raciocínio {effortLabel.toLowerCase()}
                </Text>
              </View>
              <Text style={styles.caret}>{isOpen ? '▴' : '▾'}</Text>
            </Pressable>
            {isOpen ? (
              <View style={styles.taskBody}>
                <Text style={styles.note}>{t.sub}.</Text>
                <Text style={styles.subLabel}>Modelo</Text>
                <View style={styles.chips}>
                  {CLAUDE_MODELS.map((m) => {
                    const on = m.id === c.model;
                    return (
                      <Pressable
                        key={m.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${m.label}: ${m.sub}`}
                        onPress={() => change(t.id, { model: m.id })}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {shortName(m.label)}
                          {m.id === c.defaultModel ? ' (padrão)' : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.subLabel}>Raciocínio</Text>
                <View style={styles.chips}>
                  {CLAUDE_EFFORTS.map((e) => {
                    const on = e.id === c.effort;
                    return (
                      <Pressable
                        key={e.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`Raciocínio ${e.label}: ${e.sub}`}
                        onPress={() => change(t.id, { effort: e.id })}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {e.label}
                          {e.id === c.defaultEffort ? ' (padrão)' : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <Text style={styles.note}>
        Preço por milhão de tokens (entrada / saída):{' '}
        {CLAUDE_MODELS.map((m) => `${shortName(m.label)} ${m.price}`).join(' · ')}.
      </Text>
      <Text style={styles.note}>Raciocínio maior: melhor resposta, mais tempo e mais custo.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.bodyMedium, color: colors.text.primary, marginBottom: spacing.sm },
  subLabel: { ...typography.small, color: colors.text.primary, marginTop: spacing.sm, marginBottom: spacing.xs },
  task: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
  },
  taskOpen: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.08)' },
  taskHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  caret: { ...typography.body, color: colors.text.secondary },
  taskBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  chipOn: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.12)' },
  chipText: { ...typography.small, color: colors.text.secondary },
  chipTextOn: { color: colors.accent.gold },
  note: { ...typography.small, color: colors.text.tertiary, marginTop: spacing.sm, lineHeight: 17 },
});
