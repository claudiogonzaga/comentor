import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { ScreenContainer } from '../components/ScreenContainer';
import { GreekIcon } from '../components/GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import {
  deleteImportedInspirationPack,
  listInspirationCards,
  listInspirationPacks,
  restoreInspirationDefaults,
  setInspirationCardDeleted,
  setInspirationPackEnabled,
} from '../services/database';
import {
  exportInspirationDeck,
  importInspirationPackFromFile,
} from '../services/inspirationLibrary';
import { scheduleInspirationNotifications } from '../services/inspiration';
import type { InspirationCard, InspirationPack } from '../types';

/**
 * Biblioteca de inspiração: baralhos (packs) de citações e fatos históricos. O
 * usuário liga/desliga packs, abre um pack para excluir/restaurar cards, importa
 * pacotes de planilha (CSV) e exporta o baralho editado. Os packs embutidos são
 * restauráveis em "Restaurar padrão".
 */
export function InspirationLibraryScreen() {
  const navigation = useNavigation<any>();
  const [packs, setPacks] = useState<InspirationPack[] | null>(null);
  const [openPack, setOpenPack] = useState<InspirationPack | null>(null);
  const [cards, setCards] = useState<InspirationCard[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadPacks = useCallback(async () => {
    try {
      setPacks(await listInspirationPacks());
    } catch {
      setPacks([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reloadPacks();
    }, [reloadPacks]),
  );

  const openCards = async (pack: InspirationPack) => {
    setOpenPack(pack);
    setCards(null);
    try {
      setCards(await listInspirationCards(pack.id));
    } catch {
      setCards([]);
    }
  };

  const reschedule = () => {
    scheduleInspirationNotifications().catch(() => {});
  };

  const togglePack = async (pack: InspirationPack, enabled: boolean) => {
    await setInspirationPackEnabled(pack.id, enabled);
    await reloadPacks();
    reschedule();
  };

  const toggleCard = async (card: InspirationCard) => {
    await setInspirationCardDeleted(card.id, !card.deleted);
    if (openPack) setCards(await listInspirationCards(openPack.id));
    reschedule();
  };

  const handleImport = async () => {
    setBusy(true);
    try {
      const r = await importInspirationPackFromFile();
      if (r.error) {
        Alert.alert('Importar pacote', r.error);
      } else if (r.pack) {
        await reloadPacks();
        reschedule();
        Alert.alert('Pacote importado', `"${r.pack.name}" — ${r.imported} cards adicionados.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const r = await exportInspirationDeck();
      if (!r.ok && r.error) Alert.alert('Exportar baralho', r.error);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = () => {
    Alert.alert(
      'Restaurar padrão',
      'Reativa os pacotes embutidos e restaura todas as citações/fatos que você excluiu deles. Pacotes importados por você não são afetados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          onPress: async () => {
            await restoreInspirationDefaults();
            await reloadPacks();
            if (openPack) setCards(await listInspirationCards(openPack.id));
            reschedule();
          },
        },
      ],
    );
  };

  const handleDeletePack = (pack: InspirationPack) => {
    Alert.alert('Excluir pacote', `Remover "${pack.name}" e todos os seus cards?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          await deleteImportedInspirationPack(pack.id);
          setOpenPack(null);
          setCards(null);
          await reloadPacks();
          reschedule();
        },
      },
    ]);
  };

  // ——— Vista de CARDS de um pack aberto ———
  if (openPack) {
    return (
      <ScreenContainer>
        <View style={styles.header}>
          <Pressable onPress={() => setOpenPack(null)}>
            <Text style={styles.back}>‹ Pacotes</Text>
          </Pressable>
          <Text style={[typography.subtitle, { color: colors.text.primary }]} numberOfLines={1}>
            {openPack.name}
          </Text>
          <View style={{ width: 60 }} />
        </View>
        {cards === null ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        ) : (
          <FlatList
            data={cards}
            keyExtractor={(c) => String(c.id)}
            contentContainerStyle={styles.scroll}
            ListHeaderComponent={
              <Text style={styles.hint}>
                {openPack.builtin
                  ? 'Pacote embutido. Excluir um card o remove dos alertas — dá para restaurar em "Restaurar padrão".'
                  : 'Pacote importado. Você pode excluir cards individualmente.'}
                {!openPack.builtin && (
                  <Text onPress={() => handleDeletePack(openPack)} style={styles.deletePackLink}>
                    {'  '}Excluir pacote inteiro
                  </Text>
                )}
              </Text>
            }
            renderItem={({ item }) => (
              <Card style={StyleSheet.flatten([styles.cardRow, item.deleted && styles.cardRowDeleted])}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardType}>
                    {item.type === 'fact' ? '📜 Fato' : '✨ Citação'}
                    {item.author ? ` · ${item.author}` : ''}
                  </Text>
                  <Text
                    style={[styles.cardText, item.deleted && styles.cardTextDeleted]}
                    numberOfLines={item.deleted ? 1 : 6}
                  >
                    {item.text}
                  </Text>
                </View>
                <Pressable onPress={() => toggleCard(item)} hitSlop={8} style={styles.cardAction}>
                  <Text style={item.deleted ? styles.restoreLink : styles.deleteLink}>
                    {item.deleted ? 'Restaurar' : 'Excluir'}
                  </Text>
                </Pressable>
              </Card>
            )}
          />
        )}
      </ScreenContainer>
    );
  }

  // ——— Vista de PACKS ———
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>
          Frases inspiradoras
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={packs ?? []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.scroll}
        ListHeaderComponent={
          <Text style={styles.hint}>
            Os alertas do modo inspiração sorteiam frases dos pacotes LIGADOS.
            Toque num pacote para ver e editar os cards. Importe pacotes de
            planilha (CSV) ou exporte o seu baralho.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openCards(item)}>
            <Card style={styles.packRow}>
              <View style={styles.packIcon}>
                <GreekIcon name={item.builtin ? 'sparkle' : 'bell'} size={22} color={colors.accent.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.packName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.packSub}>
                  {item.cardCount} cards{item.builtin ? ' · embutido' : ' · importado'}
                </Text>
              </View>
              <Switch
                value={item.enabled}
                onValueChange={(v) => togglePack(item, v)}
                trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                thumbColor={item.enabled ? colors.text.onGold : colors.text.tertiary}
              />
            </Card>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={{ marginTop: spacing.md }}>
            <Button
              label="Importar pacote (planilha CSV)"
              variant="secondary"
              onPress={handleImport}
              loading={busy}
            />
            <View style={{ height: spacing.sm }} />
            <Button
              label="Exportar meu baralho"
              variant="secondary"
              onPress={handleExport}
              loading={busy}
            />
            <View style={{ height: spacing.sm }} />
            <Pressable onPress={handleRestore} style={styles.restoreBtn}>
              <Text style={styles.restoreBtnText}>Restaurar pacotes padrão</Text>
            </Pressable>
            <Text style={styles.footHint}>
              Formato da planilha: colunas Texto · Autor · Data · Tipo (Citação ou
              Fato Histórico). Salve como CSV no Excel/Sheets para importar.
            </Text>
          </View>
        }
      />
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
  loading: { paddingTop: spacing.xxl, alignItems: 'center' },
  hint: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  packIcon: { width: 32, alignItems: 'center' },
  packName: { ...typography.bodyMedium, color: colors.text.primary },
  packSub: { ...typography.small, color: colors.text.secondary },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  cardRowDeleted: { opacity: 0.55 },
  cardType: { ...typography.small, color: colors.accent.gold, marginBottom: 4 },
  cardText: { ...typography.body, color: colors.text.primary, lineHeight: 20 },
  cardTextDeleted: { textDecorationLine: 'line-through', color: colors.text.tertiary },
  cardAction: { paddingTop: 2 },
  deleteLink: { ...typography.small, color: colors.accent.danger },
  restoreLink: { ...typography.small, color: colors.accent.gold },
  deletePackLink: { color: colors.accent.danger },
  restoreBtn: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  restoreBtnText: { ...typography.bodyMedium, color: colors.accent.gold },
  footHint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    lineHeight: 17,
  },
});
