import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { GreekIcon, type GreekIconName } from '../components/GreekIcon';
import { NudgesCard } from '../components/NudgesCard';
import { SedentaryCard } from '../components/SedentaryCard';
import { ScreenContainer } from '../components/ScreenContainer';
import { TimePickerInput } from '../components/TimePickerInput';
import { colors, radius, spacing, typography } from '../theme';
import {
  createMedication,
  deleteMedication,
  listMedications,
  updateMedication,
} from '../services/database';
import { scheduleAllMedications } from '../services/medications';
import { ensurePermissions } from '../services/notifications';
import { iconForEmoji } from '../services/todos';
import type { Medication } from '../types';

/**
 * #7 — Tela única "Lembretes e hábitos": junta os nudges diários da
 * Comentora (respiração, pôr do sol…) com os lembretes personalizados do
 * usuário — que agora cobrem qualquer hábito saudável: remédios, suplementos,
 * beber água, comer algo, jejum, café, etc. No horário, a coruja insiste até
 * a pessoa marcar como feito.
 *
 * O ícone é escolhido num seletor de ícones gregos (preto/terracota). Cada
 * ícone guarda um emoji representativo, usado apenas no texto da notificação
 * do Android — dentro do app mostramos sempre o ícone grego.
 */

interface IconChoice {
  icon: GreekIconName;
  emoji: string;
  label: string;
}

const ICON_CHOICES: IconChoice[] = [
  { icon: 'pill', emoji: '💊', label: 'Remédio' },
  { icon: 'leaf', emoji: '🌿', label: 'Suplemento' },
  { icon: 'drop', emoji: '💧', label: 'Água' },
  { icon: 'bowl', emoji: '🍲', label: 'Comida' },
  { icon: 'fasting', emoji: '⏳', label: 'Jejum' },
  { icon: 'coffee', emoji: '☕', label: 'Café' },
  { icon: 'sun', emoji: '☀️', label: 'Manhã' },
  { icon: 'sunset', emoji: '🕶️', label: 'Luz azul' },
  { icon: 'wind', emoji: '🌬️', label: 'Respiração' },
  { icon: 'footsteps', emoji: '🏃', label: 'Exercício' },
  { icon: 'moon', emoji: '🌙', label: 'Noite' },
  { icon: 'bell', emoji: '🔔', label: 'Lembrete' },
];

interface HabitTemplate {
  name: string;
  dosage: string;
  emoji: string;
  time: string;
  daysOfWeek?: number[];
  fastingHours?: number;
}

/** Hábitos saudáveis prontos — preenchem o editor com um toque. */
const HABIT_TEMPLATES: HabitTemplate[] = [
  { name: 'Sol matutino', dosage: '10–15 min de luz natural', emoji: '☀️', time: '07:00' },
  { name: 'Bloqueador de luz azul', dosage: 'Óculos / modo noturno', emoji: '🕶️', time: '18:00' },
  { name: 'Exercício de respiração', dosage: '', emoji: '🌬️', time: '21:00' },
  { name: 'Cardio zona 2', dosage: '20 min', emoji: '🏃', time: '18:00', daysOfWeek: [1, 3, 5] },
  { name: 'Beber água', dosage: '1 copo', emoji: '💧', time: '10:00' },
  { name: 'Jejum intermitente', dosage: '', emoji: '⏳', time: '12:00', fastingHours: 16 },
];

/** Opções de horas de jejum no editor. */
const FASTING_HOURS_OPTIONS = [12, 14, 16, 18, 20];

/** A partir da 1ª refeição + horas de jejum, calcula a janela de alimentação. */
function fastingWindow(time: string, fastH: number): { end: string; warn: string; eat: number } {
  const parts = time.split(':').map((s) => parseInt(s, 10));
  const firstMin = (parts[0] || 0) * 60 + (parts[1] || 0);
  const eat = Math.max(1, 24 - fastH);
  const endMin = (firstMin + eat * 60) % (24 * 60);
  const warnMin = (endMin - 30 + 24 * 60) % (24 * 60);
  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { end: fmt(endMin), warn: fmt(warnMin), eat };
}

/** Rótulos curtos por índice (0=domingo … 6=sábado, igual a Date.getDay()). */
const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Texto-resumo dos dias: "Todos os dias" ou "Ter, Qui". */
function formatDays(days: number[]): string {
  if (!days || days.length === 0 || days.length >= 7) return 'Todos os dias';
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d])
    .join(', ');
}

interface EditorState {
  visible: boolean;
  id: number | null; // null = novo
  name: string;
  dosage: string;
  time: string;
  emoji: string;
  daysOfWeek: number[];
  /** Jejum intermitente: horas de jejum, ou null = hábito normal. */
  fastingHours: number | null;
}

const EMPTY_EDITOR: EditorState = {
  visible: false,
  id: null,
  name: '',
  dosage: '',
  time: '08:00',
  emoji: '💧',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  fastingHours: null,
};

export function RemindersScreen() {
  const navigation = useNavigation<any>();
  const [meds, setMeds] = useState<Medication[] | null>(null);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const list = await listMedications();
    setMeds(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  useEffect(() => {
    // Pede permissão de notificação ao abrir — sem ela os lembretes não tocam.
    ensurePermissions().catch(() => {});
  }, []);

  const openNew = () => {
    setEditor({ ...EMPTY_EDITOR, visible: true });
  };

  const applyTemplate = (t: HabitTemplate) => {
    setEditor((s) => ({
      ...s,
      name: t.name,
      dosage: t.dosage,
      time: t.time,
      emoji: t.emoji,
      daysOfWeek: t.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
      fastingHours: t.fastingHours ?? null,
    }));
  };

  const openEdit = (med: Medication) => {
    setEditor({
      visible: true,
      id: med.id,
      name: med.name,
      dosage: med.dosage ?? '',
      time: med.time,
      emoji: med.emoji ?? '💧',
      daysOfWeek: med.daysOfWeek?.length ? med.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
      fastingHours: med.fastingHours ?? null,
    });
  };

  const closeEditor = () => setEditor((e) => ({ ...e, visible: false }));

  const toggleDay = (day: number) => {
    setEditor((s) => {
      const has = s.daysOfWeek.includes(day);
      const next = has
        ? s.daysOfWeek.filter((d) => d !== day)
        : [...s.daysOfWeek, day];
      return { ...s, daysOfWeek: next.sort((a, b) => a - b) };
    });
  };

  const handleSave = async () => {
    const name = editor.name.trim();
    if (!name) {
      Alert.alert('Falta o nome', 'Dê um nome ao lembrete (ex.: "Beber água").');
      return;
    }
    if (editor.daysOfWeek.length === 0) {
      Alert.alert(
        'Escolha os dias',
        'Selecione ao menos um dia da semana para o lembrete disparar.',
      );
      return;
    }
    setSaving(true);
    try {
      if (editor.id == null) {
        await createMedication({
          name,
          dosage: editor.dosage,
          time: editor.time,
          emoji: editor.emoji,
          enabled: true,
          daysOfWeek: editor.daysOfWeek,
          fastingHours: editor.fastingHours,
        });
      } else {
        await updateMedication(editor.id, {
          name,
          dosage: editor.dosage,
          time: editor.time,
          emoji: editor.emoji,
          daysOfWeek: editor.daysOfWeek,
          fastingHours: editor.fastingHours,
        });
      }
      await scheduleAllMedications();
      await reload();
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (med: Medication, next: boolean) => {
    setBusyId(med.id);
    try {
      await updateMedication(med.id, { enabled: next });
      await scheduleAllMedications();
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (med: Medication) => {
    Alert.alert(
      'Excluir hábito',
      `Remover "${med.name}"? Você não receberá mais esse hábito.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            setBusyId(med.id);
            try {
              await deleteMedication(med.id);
              await scheduleAllMedications();
              await reload();
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Hábitos saudáveis</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Nudges diários da Comentora (respiração, pôr do sol…). */}
        <NudgesCard />

        <Text style={styles.sectionTitle}>Meus hábitos</Text>
        <Text style={styles.intro}>
          Crie hábitos saudáveis: sol matutino, luz azul, respiração, cardio,
          remédios, água, comida, jejum… No horário, a coruja insiste (e canta)
          até você marcar que fez. Use os hábitos prontos ou crie os seus.
        </Text>

        {meds === null && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        )}

        {meds !== null && meds.length === 0 && (
          <Card style={styles.emptyCard}>
            <GreekIcon name="leaf" size={40} color={colors.text.tertiary} />
            <Text style={styles.emptyText}>
              Nenhum hábito ainda. Toque em “Adicionar hábito” para criar o
              primeiro.
            </Text>
          </Card>
        )}

        {meds?.map((med) => (
          <Card key={med.id} style={StyleSheet.flatten([styles.row, !med.enabled && styles.rowOff])}>
            <View style={styles.rowIcon}>
              <GreekIcon name={iconForEmoji(med.emoji, 'med')} size={28} color={colors.text.primary} />
            </View>
            <Pressable style={styles.rowMain} onPress={() => openEdit(med)}>
              <Text style={styles.rowName}>{med.name}</Text>
              {med.dosage ? <Text style={styles.rowDosage}>{med.dosage}</Text> : null}
              <View style={styles.timePill}>
                <GreekIcon name="clock" size={13} color={colors.accent.gold} />
                <Text style={styles.timeText}>{med.time}</Text>
              </View>
              {med.daysOfWeek.length < 7 && (
                <Text style={styles.rowDays}>{formatDays(med.daysOfWeek)}</Text>
              )}
            </Pressable>
            <View style={styles.rowRight}>
              {busyId === med.id ? (
                <ActivityIndicator color={colors.accent.gold} />
              ) : (
                <Switch
                  value={med.enabled}
                  onValueChange={(next) => handleToggle(med, next)}
                  trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                  thumbColor={med.enabled ? colors.text.onGold : colors.text.tertiary}
                />
              )}
              <Pressable
                onPress={() => handleDelete(med)}
                hitSlop={8}
                style={styles.deleteBtn}
                disabled={busyId === med.id}
              >
                <Text style={styles.deleteText}>Excluir</Text>
              </Pressable>
            </View>
          </Card>
        ))}

        <View style={styles.addWrap}>
          <Button label="Adicionar hábito +" onPress={openNew} />
        </View>

        <View style={{ height: spacing.lg }} />
        <SedentaryCard />
      </ScrollView>

      <Modal
        visible={editor.visible}
        transparent
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeEditor} />
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {editor.id == null ? 'Novo hábito' : 'Editar hábito'}
            </Text>

            {editor.id == null && (
              <>
                <Text style={styles.fieldLabel}>Hábitos prontos</Text>
                <View style={styles.templateRow}>
                  {HABIT_TEMPLATES.map((t) => (
                    <Pressable
                      key={t.name}
                      style={styles.templateChip}
                      onPress={() => applyTemplate(t)}
                    >
                      <GreekIcon
                        name={iconForEmoji(t.emoji, 'nudge')}
                        size={15}
                        color={colors.accent.gold}
                      />
                      <Text style={styles.templateChipText}>{t.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>Ícone</Text>
            <View style={styles.iconRow}>
              {ICON_CHOICES.map((c) => {
                const on = editor.emoji === c.emoji;
                return (
                  <Pressable
                    key={c.emoji}
                    onPress={() => setEditor((s) => ({ ...s, emoji: c.emoji }))}
                    style={[styles.iconChip, on && styles.iconChipOn]}
                  >
                    <GreekIcon
                      name={c.icon}
                      size={24}
                      color={on ? colors.accent.gold : colors.text.primary}
                    />
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Nome</Text>
            <TextInput
              value={editor.name}
              onChangeText={(t) => setEditor((s) => ({ ...s, name: t }))}
              placeholder="Ex.: Beber água, Vitamina D, Jejum…"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
              returnKeyType="next"
            />

            {/* Jejum intermitente */}
            <View style={styles.fastingToggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Jejum intermitente</Text>
                <Text style={styles.fastingHint}>
                  Defina as horas de jejum e a 1ª refeição; aviso 30 min antes de
                  fechar a janela de alimentação.
                </Text>
              </View>
              <Switch
                value={editor.fastingHours != null}
                onValueChange={(v) =>
                  setEditor((s) => ({
                    ...s,
                    fastingHours: v ? (s.fastingHours ?? 16) : null,
                    emoji: v ? '⏳' : s.emoji,
                  }))
                }
                trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                thumbColor={
                  editor.fastingHours != null ? colors.text.onGold : colors.text.tertiary
                }
              />
            </View>

            {editor.fastingHours == null ? (
              <>
                <Text style={styles.fieldLabel}>Detalhe (opcional)</Text>
                <TextInput
                  value={editor.dosage}
                  onChangeText={(t) => setEditor((s) => ({ ...s, dosage: t }))}
                  placeholder="Ex.: 1 copo, 2 cápsulas…"
                  placeholderTextColor={colors.text.tertiary}
                  style={styles.input}
                />
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Horas de jejum</Text>
                <View style={styles.fastingChips}>
                  {FASTING_HOURS_OPTIONS.map((hrs) => {
                    const on = editor.fastingHours === hrs;
                    return (
                      <Pressable
                        key={hrs}
                        onPress={() => setEditor((s) => ({ ...s, fastingHours: hrs }))}
                        style={[styles.fastingChip, on && styles.fastingChipOn]}
                      >
                        <Text style={[styles.fastingChipText, on && styles.fastingChipTextOn]}>
                          {hrs}h
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <View style={{ height: spacing.md }} />
            <TimePickerInput
              label={editor.fastingHours != null ? 'Primeira refeição' : 'Horário'}
              value={editor.time}
              onChange={(hhmm) => setEditor((s) => ({ ...s, time: hhmm }))}
            />

            {editor.fastingHours != null && (
              <Text style={styles.fastingPreview}>
                {(() => {
                  const w = fastingWindow(editor.time, editor.fastingHours!);
                  return `Janela de alimentação: ${editor.time} → ${w.end} (${w.eat}h). Aviso às ${w.warn}; pare de comer às ${w.end}.`;
                })()}
              </Text>
            )}

            <View style={{ height: spacing.md }} />
            <View style={styles.daysLabelRow}>
              <Text style={styles.fieldLabel}>Dias da semana</Text>
              <Pressable
                onPress={() =>
                  setEditor((s) => ({
                    ...s,
                    daysOfWeek:
                      s.daysOfWeek.length >= 7 ? [] : [0, 1, 2, 3, 4, 5, 6],
                  }))
                }
              >
                <Text style={styles.daysToggleAll}>
                  {editor.daysOfWeek.length >= 7 ? 'Limpar' : 'Todos os dias'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.dayRow}>
              {DAY_LABELS.map((lbl, idx) => {
                const on = editor.daysOfWeek.includes(idx);
                return (
                  <Pressable
                    key={idx}
                    onPress={() => toggleDay(idx)}
                    style={[styles.dayChip, on && styles.dayChipOn]}
                  >
                    <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>
                      {lbl}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.daysHint}>{formatDays(editor.daysOfWeek)}</Text>

            <View style={{ height: spacing.lg }} />
            <Button label="Salvar" onPress={handleSave} loading={saving} />
            <View style={{ height: spacing.sm }} />
            <Button label="Cancelar" variant="ghost" onPress={closeEditor} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    width: 60,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.subtitle,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  intro: {
    ...typography.small,
    color: colors.text.secondary,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  loading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  rowOff: {
    opacity: 0.55,
  },
  rowIcon: {
    width: 32,
    alignItems: 'center',
  },
  rowMain: {
    flex: 1,
  },
  rowName: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  rowDosage: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
  },
  timePill: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeText: {
    ...typography.small,
    color: colors.accent.gold,
  },
  rowDays: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 4,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  deleteBtn: {
    paddingVertical: 2,
  },
  deleteText: {
    ...typography.small,
    color: colors.accent.danger,
  },
  addWrap: {
    marginTop: spacing.md,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg.overlay,
  },
  modalSheet: {
    backgroundColor: colors.bg.primary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    ...typography.subtitle,
    color: colors.text.primary,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  fastingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  fastingHint: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 16,
  },
  fastingChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  fastingChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  fastingChipOn: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.12)',
  },
  fastingChipText: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
  fastingChipTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
  fastingPreview: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  templateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  templateChipText: {
    ...typography.small,
    color: colors.text.primary,
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  iconChip: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconChipOn: {
    backgroundColor: 'rgba(42,26,16,0.18)',
    borderColor: colors.accent.gold,
  },
  daysLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  daysToggleAll: {
    ...typography.small,
    color: colors.accent.gold,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  dayRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: spacing.xs,
  },
  dayChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayChipOn: {
    backgroundColor: 'rgba(42,26,16,0.18)',
    borderColor: colors.accent.gold,
  },
  dayChipText: {
    ...typography.small,
    color: colors.text.secondary,
  },
  dayChipTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
  daysHint: {
    ...typography.small,
    color: colors.text.tertiary,
  },
});
