// Editor de pilar — CRUD como no desktop: nome, descrição, quero / não quero
// (uma entrada por linha) e peso 1–5.
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../navigation/types';
import type { Pillar } from '../types';
import { colors, radius, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PillarEdit'>;

function slugify(nome: string): string {
  return (
    nome
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'pilar'
  );
}

export function PillarEditScreen({ route, navigation }: Props) {
  const { pillars, setPillars } = useAppStore();
  const editing = pillars.find((p) => p.id === route.params?.pillarId) || null;

  const [nome, setNome] = useState(editing?.nome ?? '');
  const [mocName, setMocName] = useState(editing?.mocName ?? '');
  const [descricao, setDescricao] = useState(editing?.descricao ?? '');
  const [quero, setQuero] = useState((editing?.quero ?? []).join('\n'));
  const [naoQuero, setNaoQuero] = useState((editing?.nao_quero ?? []).join('\n'));
  const [peso, setPeso] = useState(editing?.peso ?? 3);
  const [error, setError] = useState<string | null>(null);

  const toList = (s: string) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);

  const save = async () => {
    if (!nome.trim()) {
      setError('Dê um nome ao pilar.');
      return;
    }
    let id = editing?.id;
    if (!id) {
      id = slugify(nome);
      let candidate = id;
      let n = 2;
      while (pillars.some((p) => p.id === candidate)) candidate = `${id}_${n++}`;
      id = candidate;
    }
    const pillar: Pillar = {
      id,
      nome: nome.trim(),
      mocName: mocName.trim() || nome.trim(),
      descricao: descricao.trim(),
      quero: toList(quero),
      nao_quero: toList(naoQuero),
      peso,
    };
    const next = editing
      ? pillars.map((p) => (p.id === editing.id ? pillar : p))
      : [...pillars, pillar];
    await setPillars(next);
    navigation.goBack();
  };

  const remove = () => {
    if (!editing) return;
    if (pillars.length <= 1) {
      setError('Mantenha pelo menos um pilar.');
      return;
    }
    Alert.alert('Excluir pilar', `Excluir "${editing.nome}"? Vídeos já analisados continuam no app.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          await setPillars(pillars.filter((p) => p.id !== editing.id));
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topbar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={styles.back}>‹ Voltar</Text>
          </Pressable>
          <Text style={styles.title}>{editing ? 'Editar pilar' : 'Novo pilar'}</Text>
          <View style={{ width: 60 }} />
        </View>

        <Card style={{ gap: spacing.md }}>
          <Text style={styles.label}>Nome</Text>
          <TextInput
            style={styles.input}
            value={nome}
            onChangeText={setNome}
            placeholder="Ex.: Saúde mental e física"
            placeholderTextColor={colors.text.tertiary}
          />

          <Text style={styles.label}>Descrição (o que esse objetivo significa)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={descricao}
            onChangeText={setDescricao}
            multiline
            placeholder="Ex.: Saúde baseada em evidência: sono, treino…"
            placeholderTextColor={colors.text.tertiary}
          />

          <Text style={styles.label}>Quero (um item por linha)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={quero}
            onChangeText={setQuero}
            multiline
            placeholder={'protocolos acionáveis\nestudos'}
            placeholderTextColor={colors.text.tertiary}
          />

          <Text style={styles.label}>Não quero (um item por linha)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={naoQuero}
            onChangeText={setNaoQuero}
            multiline
            placeholder={'dietas milagrosas\nfitspiration'}
            placeholderTextColor={colors.text.tertiary}
          />

          <Text style={styles.label}>Peso ({peso})</Text>
          <View style={styles.pesoRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setPeso(n)}
                style={[styles.pesoBtn, peso === n && styles.pesoActive]}
              >
                <Text style={[styles.pesoLabel, peso === n && styles.pesoLabelActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Nome no link da nota ([[X - MOC]])</Text>
          <TextInput
            style={styles.input}
            value={mocName}
            onChangeText={setMocName}
            placeholder={nome.trim() || 'Ex.: Saúde'}
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="words"
          />
        </Card>

        {error && <Text style={styles.err}>{error}</Text>}

        <Button label="Salvar pilar" onPress={save} style={{ marginTop: spacing.lg }} />
        {editing && (
          <Button
            label="Excluir pilar"
            variant="ghost"
            onPress={remove}
            style={{ marginTop: spacing.sm }}
          />
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  back: { ...typography.body, color: colors.accent.gold, width: 60 },
  title: { ...typography.subtitle, color: colors.text.primary },
  label: { ...typography.label, color: colors.text.secondary },
  input: {
    ...typography.small,
    fontSize: 14,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  pesoRow: { flexDirection: 'row', gap: spacing.sm },
  pesoBtn: {
    width: 44,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pesoActive: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  pesoLabel: { ...typography.bodyMedium, color: colors.text.secondary },
  pesoLabelActive: { color: colors.text.onGold },
  err: { ...typography.small, color: colors.accent.danger, marginTop: spacing.md },
});
