// Leitor de UMA nota: baixa o Markdown do Drive, renderiza com
// react-native-markdown-display e torna os [[wikilinks]] navegáveis (estilo
// Obsidian). Links http/obsidian abrem fora.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Markdown from 'react-native-markdown-display';

import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { getAccessToken } from '../services/auth';
import { readNoteText } from '../services/drive';
import { findByName, getVaultCache } from '../services/vaultCache';
import {
  NOTE_LINK_SCHEME,
  noteTitle,
  parseFrontmatter,
  preprocessMarkdown,
  resolveNoteLink,
} from '../utils/markdown';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NoteReader'>;

type State =
  | { status: 'loading' }
  | { status: 'ready'; title: string; body: string }
  | { status: 'error'; message: string };

export function NoteReaderScreen({ route, navigation }: Props) {
  const { fileId, name } = route.params;
  const [state, setState] = useState<State>({ status: 'loading' });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setState({ status: 'loading' });
      try {
        const token = await getAccessToken();
        const text = await readNoteText(token, fileId);
        if (!alive) return;
        const { body } = parseFrontmatter(text);
        setState({ status: 'ready', title: noteTitle(name, body), body: preprocessMarkdown(body) });
      } catch (e) {
        if (alive) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [fileId, name]);

  const onLinkPress = useCallback(
    (url: string): boolean => {
      if (url.startsWith(NOTE_LINK_SCHEME)) {
        const target = url.slice(NOTE_LINK_SCHEME.length);
        const fname = resolveNoteLink(target, getVaultCache().map((n) => n.name));
        const note = fname ? findByName(fname) : null;
        if (note) {
          navigation.push('NoteReader', { fileId: note.id, name: note.name });
        } else {
          setToast(`Nota "${decodeURIComponent(target)}" não encontrada no vault.`);
          setTimeout(() => setToast(null), 2500);
        }
        return false; // já tratamos
      }
      Linking.openURL(url).catch(() => {});
      return false;
    },
    [navigation],
  );

  const openInDrive = () => {
    const link = findByName(name)?.webViewLink;
    if (link) Linking.openURL(link).catch(() => {});
  };

  return (
    <ScreenContainer>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Pressable onPress={openInDrive} hitSlop={10}>
          <Text style={styles.drive}>Drive ↗</Text>
        </Pressable>
      </View>

      {state.status === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errText}>{state.message}</Text>
          <Button label="Voltar" variant="secondary" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
        </View>
      )}

      {state.status === 'ready' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Markdown style={mdStyles} onLinkPress={onLinkPress}>
            {state.body}
          </Markdown>
        </ScrollView>
      )}

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  back: { ...typography.body, color: colors.accent.gold },
  drive: { ...typography.small, color: colors.accent.gold },
  scroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  errText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
  toast: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
    backgroundColor: colors.bg.overlay,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastText: { ...typography.small, color: colors.text.onGold },
});

// Tema do Markdown na paleta terracota (figura negra sobre terracota).
const mdStyles = {
  body: { ...typography.body, color: colors.text.primary },
  heading1: { ...typography.title, color: colors.text.primary, marginTop: spacing.md, marginBottom: spacing.sm },
  heading2: { ...typography.subtitle, color: colors.text.primary, marginTop: spacing.lg, marginBottom: spacing.xs },
  heading3: { ...typography.bodyMedium, fontFamily: 'Inter_600SemiBold', color: colors.text.primary, marginTop: spacing.md },
  link: { color: colors.accent.lavender, textDecorationLine: 'underline' as const },
  blockquote: {
    backgroundColor: colors.bg.surfaceStrong,
    borderLeftColor: colors.accent.gold,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginVertical: spacing.sm,
  },
  bullet_list: { marginVertical: spacing.xs },
  list_item: { color: colors.text.primary },
  code_inline: {
    backgroundColor: colors.bg.surfaceStrong,
    color: colors.text.primary,
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  fence: { backgroundColor: colors.bg.surfaceStrong, color: colors.text.primary, borderRadius: radius.sm, padding: spacing.md },
  hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
};
