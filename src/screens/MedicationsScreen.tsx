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
import type { Medication } from '../types';

const EMOJI_CHOICES = ['💊', '💉', '🧴', '🌿', '🩹', '🫗', '🍵', '🧪'];

interface EditorState {
  visible: boolean;
  id: number | null; // null = novo
  name: string;
  dosage: string;
  time: string;
  emoji: string;
}

const EMPTY_EDITOR: EditorState = {
  visible: false,
  id: null,
  name: '',
  dosage: '',
  time: '08:00',
  emoji: '💊',
};

export function MedicationsScreen() {
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
      emoji: med.emoji ?? '💊',
    });
  };

  const closeEditor = () => setEditor((e) => ({ ...e, visible: false }));

  const handleSave = async () => {
    const name = editor.name.trim();
    if (!name) {
      Alert.alert('Falta o nome', 'Dê um nome ao lembrete (ex.: "Vitamina D").');
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
        });
      } else {
        await updateMedication(editor.id, {
          name,
          dosage: editor.dosage,
          time: editor.time,
          emoji: editor.emoji,
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
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Medicamentos</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Lembretes de medicamentos e suplementos. No horário, a coruja insiste
          (e canta) até você marcar que tomou. Adicione quantos quiser.
        </Text>

        {meds === null && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        )}

        {meds !== null && meds.length === 0 && (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>💊</Text>
            <Text style={styles.emptyText}>
              Nenhum lembrete ainda. Toque em “Adicionar lembrete” para criar o
              primeiro.
            </Text>
          </Card>
        )}

        {meds?.map((med) => (
          <Card key={med.id} style={StyleSheet.flatten([styles.row, !med.enabled && styles.rowOff])}>
            <Text style={styles.rowEmoji}>{med.emoji ?? '💊'}</Text>
            <Pressable style={styles.rowMain} onPress={() => openEdit(med)}>
              <Text style={styles.rowName}>{med.name}</Text>
              {med.dosage ? <Text style={styles.rowDosage}>{med.dosage}</Text> : null}
              <View style={styles.timePill}>
                <Text style={styles.timeText}>🕐 {med.time}</Text>
              </View>
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
            <View style={styles.emojiRow}>
              {EMOJI_CHOICES.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => setEditor((s) => ({ ...s, emoji: e }))}
                  style={[styles.emojiChip, editor.emoji === e && styles.emojiChipOn]}
                >
                  <Text style={styles.emojiChipText}>{e}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Nome</Text>
            <TextInput
              value={editor.name}
              onChangeText={(t) => setEditor((s) => ({ ...s, name: t }))}
              placeholder="Ex.: Vitamina D, Melatonina…"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
              returnKeyType="next"
            />

            <Text style={styles.fieldLabel}>Dose (opcional)</Text>
            <TextInput
              value={editor.dosage}
              onChangeText={(t) => setEditor((s) => ({ ...s, dosage: t }))}
              placeholder="Ex.: 2 cápsulas, 5 mg…"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
            />

            <View style={{ height: spacing.md }} />
            <TimePickerInput
              label="Horário"
              value={editor.time}
              onChange={(hhmm) => setEditor((s) => ({ ...s, time: hhmm }))}
            />

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
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
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
  rowEmoji: {
    fontSize: 30,
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
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  emojiChip: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emojiChipOn: {
    backgroundColor: 'rgba(42,26,16,0.18)',
    borderColor: colors.accent.gold,
  },
  emojiChipText: {
    fontSize: 22,
  },
});
