import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import { BREATHING_SOUNDS } from '../constants/breathingSounds';
import { previewBreathingSound, stopBreathingSound } from '../services/breathingSound';

interface Props {
  /** id do som selecionado (config.breathingSoundId). */
  value: string;
  /** file:// do áudio próprio do usuário (config.breathingSoundUri). */
  customUri: string | null;
  /** Seleciona uma trilha (embutida ou 'custom'). */
  onSelect: (id: string) => void;
  /** Chamado após copiar o arquivo do usuário — passa o novo file:// persistido. */
  onUploadCustom: (uri: string) => void;
}

export function BreathingSoundPicker({ value, customUri, onSelect, onUploadCustom }: Props) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handlePreview = (id: string) => {
    setPreviewing(id);
    previewBreathingSound(id, customUri);
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
      // Remove o arquivo custom anterior, se houver, pra não acumular lixo.
      if (customUri) {
        try {
          new File(customUri).delete();
        } catch {
          /* ignore */
        }
      }
      const ext =
        (picked.name?.split('.').pop() ?? 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() ||
        'mp3';
      const dest = new File(Paths.document, `breathing_custom_${Date.now()}.${ext}`);
      new File(picked.uri).copy(dest);
      onUploadCustom(dest.uri);
    } catch {
      Alert.alert(
        'Não consegui usar esse arquivo',
        'Tente outro arquivo de áudio (mp3, m4a, wav…).',
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.sectionRow}>
        <GreekIcon name="wind" size={20} />
        <Text style={styles.section}>Som da respiração</Text>
      </View>
      <Text style={styles.subtitle}>
        Trilha calma que toca no exercício de respiração. Toque em &quot;ouvir&quot;
        para experimentar.
      </Text>

      {BREATHING_SOUNDS.map((s) => {
        const selected = s.id === value;
        const isCustom = s.id === 'custom';
        const canPreview = isCustom ? !!customUri : s.asset != null;
        const desc =
          isCustom && customUri ? 'Seu áudio está pronto — toque para selecionar' : s.description;
        return (
          <View key={s.id}>
            <View style={[styles.row, selected && styles.rowSelected]}>
              <Pressable
                style={styles.rowMain}
                onPress={() => {
                  if (isCustom && !customUri) handleUpload();
                  else onSelect(s.id);
                }}
              >
                <Text style={styles.rowTitle}>{s.name}</Text>
                <Text style={styles.rowSub}>{desc}</Text>
              </Pressable>
              {canPreview ? (
                <Pressable
                  onPress={() => handlePreview(s.id)}
                  style={[styles.playBtn, previewing === s.id && styles.playBtnActive]}
                  hitSlop={6}
                >
                  {previewing === s.id ? (
                    <GreekIcon name="wind" size={16} />
                  ) : (
                    <Text style={styles.playText}>ouvir</Text>
                  )}
                </Pressable>
              ) : (
                <View style={{ width: 56 }} />
              )}
              <Pressable
                onPress={() => {
                  if (isCustom && !customUri) handleUpload();
                  else onSelect(s.id);
                }}
                hitSlop={6}
              >
                <View style={[styles.radio, selected && styles.radioActive]} />
              </Pressable>
            </View>

            {isCustom && (
              <Pressable
                onPress={handleUpload}
                disabled={uploading}
                style={styles.uploadBtn}
              >
                {uploading ? (
                  <ActivityIndicator color={colors.accent.gold} size="small" />
                ) : (
                  <>
                    <GreekIcon name="download" size={15} color={colors.accent.gold} />
                    <Text style={styles.uploadText}>
                      {customUri ? 'Trocar meu arquivo' : 'Enviar um arquivo de áudio'}
                    </Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        );
      })}

      <Text style={styles.hint}>
        As trilhas têm cerca de 3 minutos e tocam em repetição durante o exercício.
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
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    marginLeft: spacing.md,
  },
  uploadText: {
    ...typography.small,
    color: colors.accent.gold,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
