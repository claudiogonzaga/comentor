// "No celular": áudios e vídeos baixados, com o prazo de exclusão automática,
// o espaço ocupado e a versão do motor de download (yt-dlp).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { PrefetchPicker, RetentionPicker } from '../components/RetentionPicker';
import { ScreenContainer } from '../components/ScreenContainer';
import * as db from '../services/db';
import {
  engineVersion,
  expiresLabel,
  formatBytes,
  listMedia,
  updateEngine,
  type MediaFile,
} from '../services/media';
import { useMediaStore } from '../store/useMediaStore';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Media'>;

export function MediaScreen({ navigation }: Props) {
  const version = useMediaStore((s) => s.version);
  const refresh = useMediaStore((s) => s.refresh);
  const remove = useMediaStore((s) => s.remove);
  const removeAll = useMediaStore((s) => s.removeAll);
  const [engine, setEngine] = useState<string | null>(null);
  const [engineMsg, setEngineMsg] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  // Ao abrir a tela, aplica o prazo (apaga o que venceu) e relê o disco.
  useFocusEffect(useCallback(() => refresh(), [refresh]));
  useEffect(() => setEngine(engineVersion()), []);

  const items = useMemo(() => listMedia(), [version]);
  const total = items.reduce((n, m) => n + m.size, 0);

  const handleUpdate = async () => {
    setUpdating(true);
    setEngineMsg(null);
    try {
      const res = await updateEngine(true);
      setEngine(res?.version ?? engineVersion());
      setEngineMsg(res?.status === 'DONE' ? '✓ Atualizado.' : '✓ Já está na versão mais recente.');
    } catch (e) {
      setEngineMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  };

  const renderItem = ({ item }: { item: MediaFile }) => {
    const v = db.getVideo(item.videoId);
    return (
      <Pressable
        onPress={() => navigation.navigate('Player', { videoId: item.videoId, kind: item.kind })}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.icon}>{item.kind === 'audio' ? '🎧' : '🎬'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {v?.neutral_title || v?.original_title || item.videoId}
          </Text>
          <Text style={styles.rowMeta}>
            {formatBytes(item.size)} · {expiresLabel(item.expiresAt)}
          </Text>
        </View>
        <Pressable onPress={() => remove(item.videoId, item.kind)} hitSlop={10}>
          <Text style={styles.delete}>apagar</Text>
        </Pressable>
      </Pressable>
    );
  };

  const header = (
    <View style={{ gap: spacing.lg }}>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={styles.title}>No celular</Text>
        <View style={{ width: 60 }} />
      </View>

      <Card style={{ gap: 2 }}>
        <Text style={styles.secTitle}>Apagar automaticamente</Text>
        <Text style={styles.secSub}>
          Áudios e vídeos ficam só neste celular (fora da galeria) e são apagados depois deste
          prazo, contado do download.
        </Text>
        <RetentionPicker />
        <Text style={[styles.secTitle, { marginTop: spacing.lg }]}>Pré-baixar ao abrir um vídeo</Text>
        <Text style={styles.secSub}>
          Áudio e vídeo começam a baixar em segundo plano assim que você abre um vídeo, para
          tocarem sem espera. “Só no Wi-Fi” não gasta a franquia de dados.
        </Text>
        <PrefetchPicker />
      </Card>

      <Text style={styles.summary}>
        {items.length === 0
          ? 'Nada baixado agora.'
          : `${items.length} arquivo${items.length === 1 ? '' : 's'} · ${formatBytes(total)}`}
      </Text>
    </View>
  );

  const footer = (
    <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
      {items.length > 0 && (
        <Button label="Apagar tudo agora" variant="secondary" onPress={removeAll} />
      )}
      <Text style={styles.engine}>
        Motor de download: yt-dlp {engine ?? '—'}
        {engineMsg ? `  ·  ${engineMsg}` : ''}
      </Text>
      <Pressable onPress={handleUpdate} disabled={updating} hitSlop={8}>
        <Text style={styles.engineLink}>
          {updating ? 'Atualizando…' : 'Atualizar o yt-dlp (se os downloads pararem de funcionar)'}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <ScreenContainer>
      <FlatList
        data={items}
        keyExtractor={(m) => `${m.videoId}.${m.kind}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={styles.scroll}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { ...typography.body, color: colors.accent.gold, width: 60 },
  title: { ...typography.subtitle, color: colors.text.primary },
  secTitle: { ...typography.subtitle, fontSize: 16, color: colors.text.primary },
  secSub: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.md },
  summary: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  icon: { fontSize: 20 },
  rowTitle: { ...typography.bodyMedium, fontSize: 14.5, lineHeight: 20, color: colors.text.primary },
  rowMeta: { ...typography.small, color: colors.text.secondary, marginTop: 2 },
  delete: { ...typography.small, color: colors.accent.danger },
  engine: { ...typography.label, textTransform: 'none', letterSpacing: 0, color: colors.text.tertiary },
  engineLink: { ...typography.small, color: colors.accent.gold },
});
