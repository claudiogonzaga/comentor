import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme';
import { OWL_SPECIES } from '../constants/owlSpecies';
import { playOwlCall } from '../services/owlSound';
import type { OwlSpeciesId } from '../types';

interface Props {
  /** Currently selected owl species id. */
  value: OwlSpeciesId;
  /** Called when the user picks a different species. */
  onChange: (species: OwlSpeciesId) => void;
}

export function OwlSoundPicker({ value, onChange }: Props) {
  const [previewing, setPreviewing] = useState<OwlSpeciesId | null>(null);

  const handlePreview = (id: OwlSpeciesId) => {
    setPreviewing(id);
    playOwlCall(id);
    setTimeout(() => setPreviewing((c) => (c === id ? null : c)), 2500);
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.section}>Som das notificações 🦉</Text>
      <Text style={styles.subtitle}>
        Escolha qual espécie de coruja faz o som dos lembretes. Toque em
        &quot;ouvir&quot; para escutar o canto na hora.
      </Text>

      {OWL_SPECIES.map((s) => {
        const selected = s.id === value;
        return (
          <View key={s.id} style={[styles.row, selected && styles.rowSelected]}>
            <Pressable style={styles.rowMain} onPress={() => onChange(s.id)}>
              <Text style={styles.rowTitle}>
                {s.emoji} {s.name}
              </Text>
              {s.scientific ? (
                <Text style={styles.rowSci}>{s.scientific}</Text>
              ) : null}
              <Text style={styles.rowSub}>{s.call}</Text>
            </Pressable>
            {s.soundFile ? (
              <Pressable
                onPress={() => handlePreview(s.id)}
                style={[styles.playBtn, previewing === s.id && styles.playBtnActive]}
                hitSlop={6}
              >
                <Text style={styles.playText}>
                  {previewing === s.id ? '🔔' : 'ouvir'}
                </Text>
              </Pressable>
            ) : (
              <View style={{ width: 56 }} />
            )}
            <Pressable onPress={() => onChange(s.id)} hitSlop={6}>
              <View style={[styles.radio, selected && styles.radioActive]} />
            </Pressable>
          </View>
        );
      })}

      <Text style={styles.hint}>
        O som vale para os lembretes de sono e os nudges diários.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  rowSci: {
    ...typography.small,
    color: colors.accent.gold,
    fontStyle: 'italic',
    marginTop: 1,
  },
  rowSub: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
  },
  playBtn: {
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnActive: {
    backgroundColor: colors.accent.gold,
  },
  playText: {
    ...typography.small,
    color: colors.accent.gold,
    fontSize: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.text.tertiary,
  },
  radioActive: {
    borderColor: colors.accent.gold,
    backgroundColor: colors.accent.gold,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
