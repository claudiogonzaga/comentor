import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme';
import { getKV, setKV } from '../services/database';
import { ACTIVITY_LABEL, resolveActivities, type ActivityKind } from '../services/activities';
import { useMediaQueue } from '../store/useMediaQueue';

// "Minha sequência": o usuário monta uma playlist na ordem que quiser com as 3
// atividades (Respiração, Ioga Nidra, Leia para mim) e toca tudo em sequência —
// uma toca após a outra, sem precisar voltar à tela. Continua com a tela
// apagada. A sequência montada fica salva (app_kv) para a próxima vez.

const KV_KEY = 'home_sequence';
const KINDS: ActivityKind[] = ['breathing', 'yoganidra', 'readaloud'];

export function SequenceCard() {
  const [seq, setSeq] = useState<ActivityKind[]>([]);
  const [loaded, setLoaded] = useState(false);

  const status = useMediaQueue((s) => s.status);
  const items = useMediaQueue((s) => s.items);
  const index = useMediaQueue((s) => s.index);
  const start = useMediaQueue((s) => s.start);
  const toggle = useMediaQueue((s) => s.toggle);
  const skip = useMediaQueue((s) => s.skip);
  const stop = useMediaQueue((s) => s.stop);

  const playing = status !== 'idle';

  useEffect(() => {
    (async () => {
      try {
        const raw = await getKV(KV_KEY);
        if (raw) {
          const arr = JSON.parse(raw) as ActivityKind[];
          setSeq(arr.filter((k) => KINDS.includes(k)));
        }
      } catch {
        /* sequência opcional */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback((next: ActivityKind[]) => {
    setSeq(next);
    setKV(KV_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const add = (k: ActivityKind) => persist([...seq, k]);
  const removeAt = (i: number) => persist(seq.filter((_, idx) => idx !== i));
  const clear = () => persist([]);

  const play = async () => {
    if (!seq.length) return;
    const { items: resolved, warnings } = await resolveActivities(seq);
    if (!resolved.length) {
      Alert.alert('Sequência', warnings.join('\n\n') || 'Nada para tocar.');
      return;
    }
    if (warnings.length) {
      Alert.alert('Alguns itens foram pulados', warnings.join('\n\n'), [
        { text: 'Tocar mesmo assim', onPress: () => void start(resolved) },
        { text: 'Cancelar', style: 'cancel' },
      ]);
      return;
    }
    await start(resolved);
  };

  if (!loaded) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.section}>Minha sequência</Text>
      <Text style={styles.subtitle}>
        Monte uma playlist na ordem que quiser e toque tudo de uma vez — uma
        atividade após a outra, mesmo com a tela apagada.
      </Text>

      {/* Adicionar atividades */}
      <View style={styles.addRow}>
        {KINDS.map((k) => (
          <Pressable key={k} onPress={() => add(k)} style={styles.addChip}>
            <Text style={styles.addChipText}>+ {ACTIVITY_LABEL[k]}</Text>
          </Pressable>
        ))}
      </View>

      {/* Sequência montada */}
      {seq.length === 0 ? (
        <Text style={styles.empty}>
          Toque nos botões acima para adicionar atividades à sua sequência.
        </Text>
      ) : (
        <View style={styles.list}>
          {seq.map((k, i) => {
            const isCurrent = playing && i === index;
            return (
              <View key={`${k}-${i}`} style={[styles.step, isCurrent && styles.stepCurrent]}>
                <Text style={styles.stepNum}>{i + 1}</Text>
                <Text style={[styles.stepLabel, isCurrent && styles.stepLabelCurrent]}>
                  {ACTIVITY_LABEL[k]}
                  {isCurrent ? '  ♪' : ''}
                </Text>
                {!playing && (
                  <Pressable onPress={() => removeAt(i)} hitSlop={8}>
                    <Text style={styles.remove}>✕</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Controles */}
      {seq.length > 0 && !playing && (
        <View style={styles.controls}>
          <Pressable onPress={play} style={styles.playBtn}>
            <Text style={styles.playBtnText}>▶ Tocar sequência</Text>
          </Pressable>
          <Pressable onPress={clear} hitSlop={8}>
            <Text style={styles.clear}>Limpar</Text>
          </Pressable>
        </View>
      )}
      {playing && (
        <View style={styles.controls}>
          <Pressable onPress={toggle} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>{status === 'playing' ? '❚❚ Pausar' : '▶ Continuar'}</Text>
          </Pressable>
          <Pressable onPress={skip} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>⏭ Pular</Text>
          </Pressable>
          <Pressable onPress={stop} style={styles.smallBtn}>
            <Text style={[styles.smallBtnText, { color: colors.accent.danger }]}>■ Parar</Text>
          </Pressable>
        </View>
      )}
      {playing && items[index] && (
        <Text style={styles.now}>Tocando: {items[index].label}</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  section: { ...typography.subtitle, color: colors.text.primary },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    backgroundColor: colors.bg.surface,
  },
  addChipText: { ...typography.small, color: colors.accent.gold },
  empty: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    lineHeight: 17,
  },
  list: { marginTop: spacing.md, gap: 6 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  stepCurrent: {
    borderWidth: 1,
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.12)',
  },
  stepNum: {
    ...typography.small,
    color: colors.text.tertiary,
    width: 18,
    textAlign: 'center',
  },
  stepLabel: { ...typography.bodyMedium, color: colors.text.primary, flex: 1 },
  stepLabelCurrent: { color: colors.accent.gold },
  remove: { ...typography.bodyMedium, color: colors.text.tertiary },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  playBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
  },
  playBtnText: { ...typography.bodyMedium, color: colors.accent.gold },
  clear: { ...typography.small, color: colors.text.secondary },
  smallBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnText: { ...typography.small, color: colors.text.primary },
  now: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: spacing.sm,
  },
});
