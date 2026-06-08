import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import { BREATHING_SOUNDS } from '../constants/breathingSounds';
import { previewBreathingSound, stopBreathingSound } from '../services/breathingSound';
import type { BreathingCustomSound } from '../types';

interface Props {
  /** id selecionado: embutido ('cello'…) ou 'custom:<id>'. */
  value: string;
  /** Sons próprios do usuário (vários, cada um nomeado). */
  customSounds: BreathingCustomSound[];
  /** Seleciona uma trilha (embutida ou 'custom:<id>'). */
  onSelect: (id: string) => void;
  /** Após enviar um arquivo: cria um novo som próprio (nome + file://). */
  onAddSound: (name: string, uri: string) => void;
  /** Renomeia um som próprio. */
  onRename: (id: number, name: string) => void;
  /** Exclui um som próprio. */
  onDelete: (id: number) => void;
}

const EMBEDDED = BREATHING_SOUNDS.filter((s) => s.id !== 'custom');

export function BreathingSoundPicker({
  value,
  customSounds,
  onSelect,
  onAddSound,
  onRename,
  onDelete,
}: Props) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handlePreview = (id: string, uri: string | null) => {
    setPreviewing(id);
    previewBreathingSound(id, uri);
    setTimeout(() => setPreviewing((c) => (c === id ? null : c)), 8000);
  };

  const handleUpload = async () => {
    try {
      setUploading(true);
      stopBreathingSound();
      const res = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const picked = res.assets[0];
      const ext =
        (picked.name?.split('.').pop() ?? 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
        'mp3';
      const dest = new File(Paths.document, `breathing_custom_${Date.now()}.${ext}`);
      new File(picked.uri).copy(dest);
      const base = (picked.name ?? '').replace(/\.[^.]+$/, '').trim().slice(0, 40) || 'Meu áudio';
      onAddSound(base, dest.uri);
    } catch {
      Alert.alert(
        'Não consegui usar esse arquivo',
        'Tente outro arquivo de áudio (mp3, m4a, wav…).',
      );
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = (cs: BreathingCustomSound) => {
    Alert.alert('Excluir som', `Remover "${cs.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => onDelete(cs.id) },
    ]);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.sectionRow}>
        <GreekIcon name="wind" size={20} />
        <Text style={styles.section}>Som da respiração</Text>
      </View>
      <Text style={styles.subtitle}>
        Trilha calma que toca no exercício. Toque em &quot;ouvir&quot; para
        experimentar. Você pode enviar vários sons seus e dar um nome a cada um.
      </Text>

      {EMBEDDED.map((s) => {
        const selected = s.id === value;
        return (
          <View key={s.id} style={[styles.row, selected && styles.rowSelected]}>
            <Pressable style={styles.rowMain} onPress={() => onSelect(s.id)}>
              <Text style={styles.rowTitle}>{s.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {s.description}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handlePreview(s.id, null)}
              style={[styles.playBtn, previewing === s.id && styles.playBtnActive]}
              hitSlop={6}
            >
              {previewing === s.id ? (
                <GreekIcon name="wind" size={16} />
              ) : (
                <Text style={styles.playText}>ouvir</Text>
              )}
            </Pressable>
            <Pressable onPress={() => onSelect(s.id)} hitSlop={6}>
              <View style={[styles.radio, selected && styles.radioActive]} />
            </Pressable>
          </View>
        );
      })}

      {customSounds.length > 0 && <Text style={styles.groupLabel}>SEUS SONS</Text>}
      {customSounds.map((cs) => {
        const id = `custom:${cs.id}`;
        const selected = id === value;
        return (
          <View key={cs.id} style={[styles.row, selected && styles.rowSelected]}>
            <View style={styles.rowMain}>
              <TextInput
                defaultValue={cs.name}
                onEndEditing={(e) => onRename(cs.id, e.nativeEvent.text)}
                placeholder="Nome do som"
                placeholderTextColor={colors.text.tertiary}
                style={styles.nameInput}
                maxLength={40}
                returnKeyType="done"
              />
            </View>
            <Pressable
              onPress={() => handlePreview(id, cs.uri)}
              style={[styles.playBtn, previewing === id && styles.playBtnActive]}
              hitSlop={6}
            >
              {previewing === id ? (
                <GreekIcon name="wind" size={16} />
              ) : (
                <Text style={styles.playText}>ouvir</Text>
              )}
            </Pressable>
            <Pressable onPress={() => onSelect(id)} hitSlop={6}>
              <View style={[styles.radio, selected && styles.radioActive]} />
            </Pressable>
            <Pressable onPress={() => confirmDelete(cs)} hitSlop={8} style={styles.delBtn}>
              <Text style={styles.delText}>✕</Text>
            </Pressable>
          </View>
        );
      })}

      <Pressable onPress={handleUpload} disabled={uploading} style={styles.addBtn}>
        {uploading ? (
          <ActivityIndicator color={colors.accent.gold} size="small" />
        ) : (
          <>
            <GreekIcon name="download" size={15} color={colors.accent.gold} />
            <Text style={styles.addText}>Adicionar um som meu</Text>
          </>
        )}
      </Pressable>

      <Text style={styles.hint}>
        As trilhas embutidas têm cerca de 3 min e tocam em repetição. Os seus sons
        também tocam em loop durante o exercício.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  groupLabel: {
    ...typography.label,
    color: colors.accent.gold,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
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
  rowSub: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
  },
  nameInput: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
  delBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delText: {
    color: colors.accent.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    borderStyle: 'dashed',
  },
  addText: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    lineHeight: 17,
  },
});
