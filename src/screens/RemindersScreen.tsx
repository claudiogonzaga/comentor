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
  { icon: 'moon', emoji: '🌙', label: 'Noite' },
  { icon: 'bell', emoji: '🔔', label: 'Lembrete' },
];

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
}

const EMPTY_EDITOR: EditorState = {
  visible: false,
  id: null,
  name: '',
  dosage: '',
  time: '08:00',
  emoji: '💧',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
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

  const openEdit = (med: Medication) => {
    setEditor({
      visible: true,
      id: med.id,
      name: med.name,
      dosage: med.dosage ?? '',
      time: med.time,
      emoji: med.emoji ?? '💧',
      daysOfWeek: med.daysOfWeek?.length ? med.daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
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
        });
      } else {
        await updateMedication(editor.id, {
          name,
          dosage: editor.dosage,
          time: editor.time,
          emoji: editor.emoji,
          daysOfWeek: editor.daysOfWeek,
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
      'Excluir lembrete',
      `Remover "${med.name}"? Você não receberá mais esse lembrete.`,
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
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Lembretes e hábitos</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Nudges diários da Comentora (respiração, pôr do sol…). */}
        <NudgesCard />

        <Text style={styles.sectionTitle}>Meus lembretes</Text>
        <Text style={styles.intro}>
          Crie lembretes de saúde: remédios, suplementos, beber água, comer
          algo, jejum, café… No horário, a coruja insiste (e canta) até você
          marcar que fez. Adicione quantos quiser.
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
              Nenhum lembrete ainda. Toque em “Adicionar lembrete” para criar o
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
          <Button label="Adicionar lembrete +" onPress={openNew} />
        </View>
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
              {editor.id == null ? 'Novo lembrete' : 'Editar lembrete'}
            </Text>

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

            <Text style={styles.fieldLabel}>Detalhe (opcional)</Text>
            <TextInput
              value={editor.dosage}
              onChangeText={(t) => setEditor((s) => ({ ...s, dosage: t }))}
              placeholder="Ex.: 1 copo, 2 cápsulas, 16h de jejum…"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
            />

            <View style={{ height: spacing.md }} />
            <TimePickerInput
              label="Horário"
              value={editor.time}
              onChange={(hhmm) => setEditor((s) => ({ ...s, time: hhmm }))}
            />

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
