import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { useMediaQueue } from '../store/useMediaQueue';
import {
  createYogaNidraSound,
  deleteYogaNidraSound,
  listYogaNidraSounds,
} from '../services/database';
import type { YogaNidraSound } from '../types';

/**
 * Ioga Nidra: o usuário sobe os áudios que preferir (uma ou mais gravações) e
 * toca aqui. O áudio continua tocando com a tela apagada (mesma base do "Leia
 * para mim" — útil para deitar e relaxar no escuro). Reaproveita a fila de
 * mídia (useMediaQueue) com um único item.
 */
export function YogaNidraScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();
  const [sounds, setSounds] = useState<YogaNidraSound[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const status = useMediaQueue((s) => s.status);
  const queueItems = useMediaQueue((s) => s.items);
  const toggle = useMediaQueue((s) => s.toggle);
  const stop = useMediaQueue((s) => s.stop);
  const start = useMediaQueue((s) => s.start);

  const selectedId = config?.yogaNidraSoundId ?? null;
  const playingNidra = status !== 'idle' && queueItems[0]?.label?.startsWith('Ioga Nidra');

  const reload = useCallback(async () => {
    try {
      const list = await listYogaNidraSounds();
      setSounds(list);
      // se nada selecionado e há áudios, seleciona o mais recente
      if (list.length && (config?.yogaNidraSoundId == null || !list.some((s) => s.id === config?.yogaNidraSoundId))) {
        await setConfig({ yogaNidraSoundId: list[list.length - 1].id });
      }
    } finally {
      setLoading(false);
    }
  }, [config?.yogaNidraSoundId, setConfig]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleUpload = async () => {
    try {
      setUploading(true);
      const res = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const picked = res.assets[0];
      const ext =
        (picked.name?.split('.').pop() ?? 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
      const dest = new File(Paths.document, `yoga_nidra_${Date.now()}.${ext}`);
      new File(picked.uri).copy(dest);
      const base = (picked.name ?? '').replace(/\.[^.]+$/, '').trim().slice(0, 40) || 'Ioga Nidra';
      const created = await createYogaNidraSound({ name: base, uri: dest.uri });
      await setConfig({ yogaNidraSoundId: created.id });
      await reload();
    } catch {
      Alert.alert(
        'Não consegui usar esse arquivo',
        'Tente outro arquivo de áudio (mp3, m4a, wav…).',
      );
    } finally {
      setUploading(false);
    }
  };

  const playSelected = async (id: number) => {
    await setConfig({ yogaNidraSoundId: id });
    const s = sounds.find((x) => x.id === id);
    if (!s) return;
    await start([{ label: `Ioga Nidra: ${s.name}`, source: { uri: s.uri } }]);
  };

  const handleDelete = (s: YogaNidraSound) => {
    Alert.alert('Excluir áudio', `Remover "${s.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          if (playingNidra) stop();
          await deleteYogaNidraSound(s.id);
          await reload();
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (playingNidra) stop();
            navigation.goBack();
          }}
        >
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Ioga Nidra</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Suba o seu áudio de Ioga Nidra preferido e toque aqui para relaxar. O
          áudio continua tocando com a tela apagada — deite, apague a luz e siga a
          prática.
        </Text>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        ) : sounds.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              Nenhum áudio ainda. Toque em “Enviar áudio de Ioga Nidra” para
              adicionar o seu.
            </Text>
          </Card>
        ) : (
          sounds.map((s) => {
            const isSel = s.id === selectedId;
            const isPlaying = playingNidra && queueItems[0]?.label === `Ioga Nidra: ${s.name}`;
            return (
              <Card key={s.id} style={StyleSheet.flatten([styles.row, isSel && styles.rowSel])}>
                <Pressable style={styles.play} onPress={() => (isPlaying ? toggle() : playSelected(s.id))}>
                  <Text style={styles.playIcon}>
                    {isPlaying && status === 'playing' ? '❚❚' : '▶'}
                  </Text>
                </Pressable>
                <Pressable style={{ flex: 1 }} onPress={() => playSelected(s.id)}>
                  <Text style={styles.name} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={styles.sub}>{isSel ? 'selecionado' : 'toque para ouvir'}</Text>
                </Pressable>
                <Pressable onPress={() => handleDelete(s)} hitSlop={8}>
                  <Text style={styles.delete}>Excluir</Text>
                </Pressable>
              </Card>
            );
          })
        )}

        {playingNidra && (
          <Button
            label={status === 'playing' ? 'Pausar' : 'Continuar'}
            variant="secondary"
            onPress={toggle}
          />
        )}
        {playingNidra && (
          <>
            <View style={{ height: spacing.sm }} />
            <Button label="Parar" variant="ghost" onPress={stop} />
          </>
        )}

        <View style={{ height: spacing.lg }} />
        <Button
          label="Enviar áudio de Ioga Nidra"
          variant="secondary"
          onPress={handleUpload}
          loading={uploading}
        />
        <Text style={styles.hint}>
          No seletor do Android dá para escolher um arquivo do aparelho ou do
          Google Drive (menu ☰ → Drive). Formatos: mp3, m4a, wav…
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { ...typography.bodyMedium, color: colors.accent.gold, minWidth: 60 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  intro: {
    ...typography.body,
    color: colors.text.secondary,
    marginBottom: spacing.lg,
    lineHeight: 21,
  },
  loading: { paddingTop: spacing.xl, alignItems: 'center' },
  emptyCard: { alignItems: 'center', padding: spacing.lg },
  emptyText: {
    ...typography.body,
    color: colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  rowSel: { borderColor: colors.accent.gold, borderWidth: 1 },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surfaceStrong,
  },
  playIcon: { color: colors.accent.gold, fontSize: 16 },
  name: { ...typography.bodyMedium, color: colors.text.primary },
  sub: { ...typography.small, color: colors.text.secondary },
  delete: { ...typography.small, color: colors.accent.danger },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
