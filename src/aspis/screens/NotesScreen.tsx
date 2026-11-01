// Leitor de notas ("mini-Obsidian") — lista TODO o vault Drive:/Aspis (notas
// do Android E do desktop), com busca. Tocar abre a nota renderizada. Requer
// login Google com escopo drive.readonly (mais amplo que o drive.file de salvar).
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { getAccessToken } from '../services/auth';
import { DriveError, listVaultNotes, type VaultNote } from '../services/drive';
import { setVaultCache } from '../services/vaultCache';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Notes'>;

function cleanTitle(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .replace(/\s*\([A-Za-z0-9_-]{6,}\)\s*$/, '')
    .trim();
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; notes: VaultNote[] }
  | { status: 'error'; message: string; needAuth: boolean };

export function NotesScreen({ navigation }: Props) {
  const { user, googleSignIn, googleSignOut } = useAppStore();
  const [state, setState] = useState<State>({ status: 'idle' });
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      let u = user;
      if (!u) u = await googleSignIn();
      if (!u) {
        setState({ status: 'error', message: 'Conecte a sua conta Google para ver as notas.', needAuth: true });
        return;
      }
      const token = await getAccessToken();
      const notes = await listVaultNotes(token);
      setVaultCache(notes);
      setState({ status: 'ready', notes });
    } catch (e) {
      // 403 = escopo de leitura ainda não concedido (usuário antigo) → reconectar
      const needAuth = e instanceof DriveError && (e.status === 401 || e.status === 403);
      setState({
        status: 'error',
        message: needAuth
          ? 'Falta permissão de leitura do Drive. Reconecte a conta para conceder o acesso de leitura das notas.'
          : e instanceof Error
            ? e.message
            : String(e),
        needAuth,
      });
    }
  }, [user, googleSignIn]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const reconnect = useCallback(async () => {
    await googleSignOut();
    await googleSignIn();
    load();
  }, [googleSignOut, googleSignIn, load]);

  const notes = state.status === 'ready' ? state.notes : [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? notes.filter((n) => cleanTitle(n.name).toLowerCase().includes(q))
    : notes;

  return (
    <ScreenContainer>
      <View style={styles.topbar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={styles.title}>Notas</Text>
        <View style={{ width: 60 }} />
      </View>

      {state.status === 'ready' && (
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar nota…"
          placeholderTextColor={colors.text.tertiary}
          autoCapitalize="none"
        />
      )}

      {state.status === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.gold} />
          <Text style={styles.dim}>Lendo o vault no Drive…</Text>
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errText}>{state.message}</Text>
          {state.needAuth ? (
            <Button label="Reconectar conta Google" onPress={reconnect} style={{ marginTop: spacing.lg }} />
          ) : (
            <Button label="Tentar de novo" variant="secondary" onPress={load} style={{ marginTop: spacing.lg }} />
          )}
        </View>
      )}

      {state.status === 'ready' && (
        <FlatList
          data={filtered}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent.gold} />}
          ListEmptyComponent={
            <Text style={styles.dim}>
              {notes.length === 0
                ? 'Nenhuma nota no Drive:/Aspis ainda. Salve uma nota a partir de um vídeo.'
                : 'Nenhuma nota corresponde à busca.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('NoteReader', { fileId: item.id, name: item.name })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.rowTitle} numberOfLines={2}>
                {cleanTitle(item.name)}
              </Text>
              <Text style={styles.rowDate}>{(item.modifiedTime || '').slice(0, 10)}</Text>
            </Pressable>
          )}
        />
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
  back: { ...typography.body, color: colors.accent.gold, width: 60 },
  title: { ...typography.subtitle, color: colors.text.primary },
  search: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    ...typography.small,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
  },
  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: { ...typography.bodyMedium, fontSize: 15, color: colors.text.primary },
  rowDate: { ...typography.label, color: colors.text.tertiary, marginTop: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  dim: { ...typography.small, color: colors.text.secondary, textAlign: 'center', marginTop: spacing.md },
  errText: { ...typography.body, color: colors.text.secondary, textAlign: 'center' },
});
