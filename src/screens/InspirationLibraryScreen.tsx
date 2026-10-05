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
  copyDeckPrompt,
  exportInspirationDeck,
  importInspirationPackFromFile,
  shareDeckTemplate,
} from '../services/inspirationLibrary';
import { rateInspirationCard, scheduleInspirationNotifications } from '../services/inspiration';
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

  const rateCard = async (card: InspirationCard, rating: -1 | 0 | 1) => {
    await rateInspirationCard(card.id, rating);
    if (openPack) setCards(await listInspirationCards(openPack.id));
    await reloadPacks();
  };

  const handleCopyPrompt = async () => {
    const ok = await copyDeckPrompt();
    Alert.alert(
      ok ? 'Instruções copiadas' : 'Não consegui copiar',
      ok
        ? 'Cole numa IA (ChatGPT, Claude, Gemini…), troque o tema e a quantidade, salve a resposta como arquivo .csv e importe aqui.'
        : 'Tente de novo.',
    );
  };

  const handleTemplate = async () => {
    const r = await shareDeckTemplate();
    if (!r.ok && r.error) Alert.alert('Modelo de baralho', r.error);
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
      'Reativa os pacotes embutidos e restaura todas as citações/fatos que você excluiu ou marcou com 👎 neles. Pacotes importados por você não são afetados.',
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
              <Card style={StyleSheet.flatten([styles.cardRow, (item.deleted || item.rating < 0) && styles.cardRowDeleted])}>
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
                <View style={styles.cardActions}>
                  {!item.deleted ? (
                    <View style={styles.rateRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Gostei: aparece com mais frequência"
                        accessibilityState={{ selected: item.rating > 0 }}
                        onPress={() => rateCard(item, item.rating > 0 ? 0 : 1)}
                        hitSlop={6}
                        style={[styles.rateBtn, item.rating > 0 && styles.rateBtnOn]}
                      >
                        <Text style={styles.rateGlyph}>👍</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Não quero mais: não aparece"
                        accessibilityState={{ selected: item.rating < 0 }}
                        onPress={() => rateCard(item, item.rating < 0 ? 0 : -1)}
                        hitSlop={6}
                        style={[styles.rateBtn, item.rating < 0 && styles.rateBtnOn]}
                      >
                        <Text style={styles.rateGlyph}>👎</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  <Pressable onPress={() => toggleCard(item)} hitSlop={8} style={styles.cardAction}>
                    <Text style={item.deleted ? styles.restoreLink : styles.deleteLink}>
                      {item.deleted ? 'Restaurar' : 'Excluir'}
                    </Text>
                  </Pressable>
                </View>
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
          <View>
            <Text style={styles.hint}>
              Cada pacote é um baralho. Os alertas do modo inspiração sorteiam
              frases dos baralhos LIGADOS (pode combinar vários). Toque num
              baralho para ver os cards e dar 👍 (aparece mais) ou 👎 (nunca mais).
            </Text>
            <Card style={styles.importCard}>
              <Text style={styles.importTitle}>Importar baralho</Text>
              <Text style={styles.importLine}>• Arquivo CSV (UTF-8), uma frase por linha.</Text>
              <Text style={styles.importLine}>
                • 4 colunas: Texto do Card · Autor · Data (opcional) · Tipo (Citação ou Fato Histórico).
              </Text>
              <Text style={styles.importLine}>• Só o texto é obrigatório. A 1ª linha é o cabeçalho.</Text>
              <Text style={styles.importLine}>
                • Frases curtas (até ~250 caracteres) ficam melhores quando lidas em voz alta.
              </Text>
              <Text style={styles.importLine}>
                • O nome do arquivo vira o nome do baralho. Vale CSV do Excel ou do Google Sheets.
              </Text>
              <View style={{ height: spacing.sm }} />
              <Button
                label="Escolher arquivo CSV"
                variant="secondary"
                onPress={handleImport}
                loading={busy}
              />
              <View style={styles.importLinks}>
                <Pressable onPress={handleTemplate} hitSlop={6}>
                  <Text style={styles.linkText}>Baixar modelo</Text>
                </Pressable>
                <Pressable onPress={handleCopyPrompt} hitSlop={6}>
                  <Text style={styles.linkText}>Copiar instruções para gerar com IA</Text>
                </Pressable>
              </View>
            </Card>
          </View>
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
              Exportar gera um CSV no mesmo formato da importação — dá para editar
              na planilha e importar de novo.
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
  cardActions: { alignItems: 'flex-end', gap: spacing.sm },
  rateRow: { flexDirection: 'row', gap: spacing.xs },
  rateBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  rateBtnOn: { borderColor: colors.accent.gold, backgroundColor: colors.bg.surfaceStrong },
  rateGlyph: { fontSize: 15 },
  importCard: { marginBottom: spacing.md },
  importTitle: { ...typography.bodyMedium, color: colors.text.primary, marginBottom: spacing.xs },
  importLine: { ...typography.small, color: colors.text.secondary, lineHeight: 18, marginBottom: 2 },
  importLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  linkText: { ...typography.small, color: colors.accent.gold },
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
