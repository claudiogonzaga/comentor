import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme';
import { getKV, setKV } from '../services/database';
import {
  ACTIVITY_LABEL,
  listActivityOptions,
  resolveSteps,
  type ActivityKind,
  type ActivityOption,
  type SeqStep,
} from '../services/activities';
import { useMediaQueue } from '../store/useMediaQueue';

// "Minha sequência": o usuário monta uma playlist na ordem que quiser com as 3
// atividades (Respiração, Ioga Nidra, Leia para mim). Para cada uma, ESCOLHE
// qual arquivo/texto salvo tocar — e pode repetir (vários "Leia para mim").
// Toca tudo em sequência, mesmo com a tela apagada. A sequência fica salva.

const KV_KEY = 'home_sequence_v2';
const KINDS: ActivityKind[] = ['breathing', 'yoganidra', 'readaloud'];

export function SequenceCard() {
  const [seq, setSeq] = useState<SeqStep[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Seletor aberto: tipo + opções disponíveis daquele tipo.
  const [pickerKind, setPickerKind] = useState<ActivityKind | null>(null);
  const [options, setOptions] = useState<ActivityOption[] | null>(null);

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
          const arr = JSON.parse(raw) as SeqStep[];
          if (Array.isArray(arr)) setSeq(arr.filter((s) => s && KINDS.includes(s.kind)));
        }
      } catch {
        /* sequência opcional */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback((next: SeqStep[]) => {
    setSeq(next);
    setKV(KV_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // Abre o seletor de arquivos de um tipo (busca as opções disponíveis).
  const openPicker = async (kind: ActivityKind) => {
    setPickerKind(kind);
    setOptions(null);
    try {
      const opts = await listActivityOptions(kind);
      setOptions(opts);
    } catch {
      setOptions([]);
    }
  };

  const chooseOption = (kind: ActivityKind, opt: ActivityOption) => {
    persist([...seq, { kind, ref: opt.ref, label: opt.label }]);
    setPickerKind(null);
    setOptions(null);
  };

  const removeAt = (i: number) => persist(seq.filter((_, idx) => idx !== i));
  const clear = () => persist([]);

  // Reordena a playlist: sobe/desce o item (troca com o vizinho).
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= seq.length) return;
    const next = seq.slice();
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  const play = async () => {
    if (!seq.length) return;
    const { items: resolved, warnings } = await resolveSteps(seq);
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
        Monte uma playlist na ordem que quiser, escolhendo qual áudio tocar em
        cada etapa (pode repetir). Toca tudo de uma vez, mesmo com a tela apagada.
      </Text>

      {/* Adicionar: abre o seletor de arquivos do tipo */}
      {!playing && (
        <View style={styles.addRow}>
          {KINDS.map((k) => (
            <Pressable key={k} onPress={() => openPicker(k)} style={styles.addChip}>
              <Text style={styles.addChipText}>+ {ACTIVITY_LABEL[k]}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Seletor de arquivos do tipo escolhido */}
      {pickerKind && (
        <View style={styles.picker}>
          <View style={styles.pickerHead}>
            <Text style={styles.pickerTitle}>Escolha o áudio de {ACTIVITY_LABEL[pickerKind]}</Text>
            <Pressable onPress={() => setPickerKind(null)} hitSlop={8}>
              <Text style={styles.pickerClose}>✕</Text>
            </Pressable>
          </View>
          {options === null ? (
            <Text style={styles.pickerEmpty}>Carregando…</Text>
          ) : options.length === 0 ? (
            <Text style={styles.pickerEmpty}>
              {pickerKind === 'readaloud'
                ? 'Nenhum áudio salvo em "Leia para mim". Gere e salve um áudio antes.'
                : pickerKind === 'yoganidra'
                  ? 'Nenhum áudio de Ioga Nidra enviado. Suba um na tela de Ioga Nidra.'
                  : 'Nenhum som de respiração disponível.'}
            </Text>
          ) : (
            options.map((opt) => (
              <Pressable
                key={String(opt.ref)}
                onPress={() => chooseOption(pickerKind, opt)}
                style={styles.optRow}
              >
                <Text style={styles.optText} numberOfLines={1}>
                  {opt.label}
                </Text>
                <Text style={styles.optAdd}>adicionar +</Text>
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* Sequência montada */}
      {seq.length === 0 ? (
        <Text style={styles.empty}>
          Toque nos botões acima para escolher os áudios e montar sua sequência.
        </Text>
      ) : (
        <View style={styles.list}>
          {seq.map((step, i) => {
            const isCurrent = playing && i === index;
            return (
              <View key={`${step.kind}-${i}`} style={[styles.step, isCurrent && styles.stepCurrent]}>
                <Text style={styles.stepNum}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.stepKind, isCurrent && styles.stepLabelCurrent]}>
                    {ACTIVITY_LABEL[step.kind]}
                    {isCurrent ? '  ♪' : ''}
                  </Text>
                  <Text style={styles.stepFile} numberOfLines={1}>
                    {step.label}
                  </Text>
                </View>
                {!playing && (
                  <View style={styles.rowActions}>
                    <Pressable
                      onPress={() => move(i, -1)}
                      disabled={i === 0}
                      hitSlop={6}
                    >
                      <Text style={[styles.reorder, i === 0 && styles.reorderOff]}>▲</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => move(i, 1)}
                      disabled={i === seq.length - 1}
                      hitSlop={6}
                    >
                      <Text style={[styles.reorder, i === seq.length - 1 && styles.reorderOff]}>
                        ▼
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => removeAt(i)} hitSlop={8}>
                      <Text style={styles.remove}>✕</Text>
                    </Pressable>
                  </View>
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
      {playing && items[index] && <Text style={styles.now}>Tocando: {items[index].label}</Text>}
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
  picker: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  pickerTitle: { ...typography.small, color: colors.text.secondary, flex: 1 },
  pickerClose: { ...typography.bodyMedium, color: colors.text.tertiary },
  pickerEmpty: { ...typography.small, color: colors.text.tertiary, lineHeight: 17 },
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  optText: { ...typography.bodyMedium, color: colors.text.primary, flex: 1 },
  optAdd: { ...typography.small, color: colors.accent.gold },
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
  stepNum: { ...typography.small, color: colors.text.tertiary, width: 18, textAlign: 'center' },
  stepKind: { ...typography.bodyMedium, color: colors.text.primary },
  stepFile: { ...typography.small, color: colors.text.secondary },
  stepLabelCurrent: { color: colors.accent.gold },
  remove: { ...typography.bodyMedium, color: colors.text.tertiary },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reorder: { ...typography.bodyMedium, color: colors.accent.gold, paddingHorizontal: 2 },
  reorderOff: { color: colors.text.tertiary, opacity: 0.35 },
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
  now: { ...typography.small, color: colors.accent.gold, marginTop: spacing.sm },
});
