// A CAIXA DE AVISOS (o sino no alto da barra): o que a IA pessoal deixou para ele
// — o resumo do e-mail, do WhatsApp, do Teams — e os recados dele para ela.
//
// Tocar num aviso abre o texto inteiro e o marca como lido. Cada aviso pode ser
// respondido (o recado fica ligado a ele), arquivado ou apagado; os recados mostram
// se a IA já os leu. Tudo vai ao Mac pela sincronização (aviso.<id>).

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader, withAlpha } from '../components/habitShared';
import { syncConfigNow } from '../services/configSync';
import { colors, radius, spacing, typography } from '../theme';
import { useAvisos, type Aviso } from './store';

const ORIGENS: Record<string, string> = { checkup: 'Check-up', escudo: 'Escudo', claude: 'Claude', kairos: 'Kairós', ia: 'IA' };

function quando(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const hoje = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hm}`;
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hm}`;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}, ${hm}`;
}

const resumo = (a?: Aviso | null) => (a ? (a.titulo || a.texto || '').replace(/\s+/g, ' ').slice(0, 70) : '');

// *negrito*, _itálico_ e ~riscado~, como no WhatsApp (de onde o Check-up já escreve).
const MARCA = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
const ANTES_OK = /[\s(]/;
const DEPOIS_OK = /[\s).,;:!?]/;

function Formatado({ texto, style }: { texto: string; style: object }) {
  const partes: { t: string; s?: 'b' | 'i' | 's' }[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(MARCA)) {
    const i = m.index ?? 0;
    const antes = i === 0 ? ' ' : texto[i - 1];
    const fim = i + m[0].length;
    const depois = fim >= texto.length ? ' ' : texto[fim];
    if (!ANTES_OK.test(antes) || !DEPOIS_OK.test(depois)) continue;
    if (i > ultimo) partes.push({ t: texto.slice(ultimo, i) });
    const c = m[0][0];
    partes.push({ t: m[0].slice(1, -1), s: c === '*' ? 'b' : c === '_' ? 'i' : 's' });
    ultimo = fim;
  }
  if (ultimo < texto.length) partes.push({ t: texto.slice(ultimo) });
  return (
    <Text style={style}>
      {partes.map((p, k) => (
        <Text
          key={k}
          style={
            p.s === 'b'
              ? styles.negrito
              : p.s === 'i'
                ? styles.italico
                : p.s === 's'
                  ? styles.riscado
                  : undefined
          }
        >
          {p.t}
        </Text>
      ))}
    </Text>
  );
}

export function AvisosScreen() {
  const navigation = useNavigation();
  const { loaded, avisos, load, marcarLido, marcarTodosLidos, arquivar, apagar, recado } = useAvisos();
  const [filtro, setFiltro] = useState<'caixa' | 'arquivados'>('caixa');
  const [aberto, setAberto] = useState<string | null>(null);
  const [respostaA, setRespostaA] = useState<string | null>(null);
  const [texto, setTexto] = useState('');

  useEffect(() => {
    void load();
    // Ao abrir, busca o que a IA deixou desde a última passada.
    void syncConfigNow();
  }, [load]);

  const porId = useMemo(() => Object.fromEntries(avisos.map((a) => [a.id, a])), [avisos]);
  const visiveis = useMemo(
    () =>
      avisos
        .filter((a) => (filtro === 'arquivados' ? !!a.arquivado : !a.arquivado))
        .sort((x, y) => y.criado - x.criado),
    [avisos, filtro],
  );
  const temNaoLido = avisos.some((a) => a.de === 'ia' && !a.lido && !a.arquivado);

  const tocar = (a: Aviso) => {
    setAberto((atual) => (atual === a.id ? null : a.id));
    if (a.de === 'ia' && !a.lido) marcarLido(a.id, true);
  };

  const confirmarApagar = (a: Aviso) =>
    Alert.alert('Apagar?', 'Apaga no celular e no Mac.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: () => apagar(a.id) },
    ]);

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    recado(t, respostaA);
    setTexto('');
    setRespostaA(null);
  };

  return (
    <ScreenContainer>
      <ScreenHeader
        title="Avisos"
        onBack={() => navigation.goBack()}
        right={
          temNaoLido ? (
            <Pressable onPress={marcarTodosLidos} hitSlop={10} accessibilityRole="button">
              <Text style={styles.headerAcao}>Ler todos</Text>
            </Pressable>
          ) : null
        }
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.filtros}>
          {(['caixa', 'arquivados'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFiltro(f)}
              style={[styles.filtro, filtro === f && styles.filtroOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: filtro === f }}
            >
              <Text style={[styles.filtroTxt, filtro === f && styles.filtroTxtOn]}>
                {f === 'caixa' ? 'Caixa' : 'Arquivados'}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.lista} keyboardShouldPersistTaps="handled">
          {loaded && visiveis.length === 0 && (
            <Text style={styles.vazio}>
              {filtro === 'arquivados'
                ? 'Nada arquivado.'
                : 'Nenhum aviso por enquanto.\nQuando a sua IA ler o e-mail, o WhatsApp e o Teams, o resumo aparece aqui.\nVocê também pode deixar um recado para ela aí embaixo.'}
            </Text>
          )}
          {visiveis.map((a) => {
            const alvo = a.resposta_a ? porId[a.resposta_a] : null;
            const abre = aberto === a.id;
            if (a.de === 'eu') {
              return (
                <Pressable key={a.id} onPress={() => tocar(a)} style={styles.recado} accessibilityRole="button">
                  {alvo && <Text style={styles.ref}>↪ {resumo(alvo)}</Text>}
                  <Formatado texto={a.texto} style={styles.texto} />
                  <Text style={styles.estado}>
                    Você · {quando(a.criado)} · {a.visto_ia ? `a IA leu ${quando(a.visto_ia)}` : 'a IA ainda não leu'}
                  </Text>
                  {abre && (
                    <View style={[styles.acoes, { justifyContent: 'flex-end' }]}>
                      <Acao rotulo={a.arquivado ? 'Desarquivar' : 'Arquivar'} onPress={() => arquivar(a.id, !a.arquivado)} />
                      <Acao rotulo="Apagar" onPress={() => confirmarApagar(a)} />
                    </View>
                  )}
                </Pressable>
              );
            }
            const naoLido = !a.lido && !a.arquivado;
            return (
              <Pressable
                key={a.id}
                onPress={() => tocar(a)}
                style={[styles.aviso, naoLido && styles.avisoNaoLido]}
                accessibilityRole="button"
                accessibilityLabel={`${naoLido ? 'Não lido. ' : ''}${a.titulo}`}
              >
                <View style={styles.meta}>
                  {naoLido && <View style={styles.ponto} />}
                  <Text style={styles.chip}>{ORIGENS[a.origem] || a.origem || 'IA'}</Text>
                  <Text style={styles.metaTxt}>{quando(a.criado)}</Text>
                  {a.prioridade === 'alta' && <Text style={styles.alta}>● importante</Text>}
                </View>
                {alvo && <Text style={styles.ref}>↪ responde ao seu recado: “{resumo(alvo)}”</Text>}
                {!!a.titulo && <Formatado texto={a.titulo} style={styles.titulo} />}
                {!!a.texto && (
                  <Text numberOfLines={abre ? undefined : 4}>
                    <Formatado texto={a.texto} style={styles.texto} />
                  </Text>
                )}
                {abre && (
                  <View style={styles.acoes}>
                    <Acao
                      rotulo="Responder"
                      onPress={() => {
                        setRespostaA(a.id);
                      }}
                    />
                    <Acao rotulo={a.arquivado ? 'Desarquivar' : 'Arquivar'} onPress={() => arquivar(a.id, !a.arquivado)} />
                    {!!a.lido && <Acao rotulo="Não lido" onPress={() => marcarLido(a.id, false)} />}
                    <Acao rotulo="Apagar" onPress={() => confirmarApagar(a)} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.rodape}>
          {respostaA && (
            <View style={styles.respondendo}>
              <Text style={styles.respondendoTxt} numberOfLines={1}>
                Respondendo a “{resumo(porId[respostaA])}”
              </Text>
              <Pressable onPress={() => setRespostaA(null)} hitSlop={10} accessibilityLabel="Não responder">
                <Text style={styles.respondendoX}>✕</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.compor}>
            <TextInput
              value={texto}
              onChangeText={setTexto}
              placeholder="Recado para a sua IA…"
              placeholderTextColor={colors.text.tertiary}
              style={styles.campo}
              multiline
              maxLength={8000}
            />
            <Pressable
              onPress={enviar}
              disabled={!texto.trim()}
              style={[styles.enviar, !texto.trim() && { opacity: 0.45 }]}
              accessibilityRole="button"
            >
              <Text style={styles.enviarTxt}>Enviar</Text>
            </Pressable>
          </View>
          <Text style={styles.dica}>A IA lê os recados na próxima execução.</Text>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function Acao({ rotulo, onPress }: { rotulo: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.acao} hitSlop={4} accessibilityRole="button">
      <Text style={styles.acaoTxt}>{rotulo}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerAcao: { ...typography.small, color: colors.accent.gold },
  filtros: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filtro: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  filtroOn: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  filtroTxt: { ...typography.small, color: colors.text.secondary },
  filtroTxtOn: { color: colors.text.onGold },
  lista: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  vazio: { ...typography.body, color: colors.text.tertiary, textAlign: 'center', marginTop: spacing.xxl },
  aviso: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  avisoNaoLido: { borderColor: colors.accent.gold },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent.gold },
  chip: {
    ...typography.small,
    fontSize: 11.5,
    color: colors.text.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
  },
  metaTxt: { ...typography.small, fontSize: 12, color: colors.text.tertiary },
  alta: { ...typography.small, fontSize: 12, color: colors.accent.danger },
  ref: { ...typography.small, color: colors.text.secondary, marginBottom: 2 },
  titulo: { ...typography.bodyMedium, color: colors.text.primary },
  texto: { ...typography.body, fontSize: 15, lineHeight: 22, color: colors.text.primary },
  negrito: { fontFamily: 'Inter_600SemiBold' },
  italico: { fontStyle: 'italic' },
  riscado: { textDecorationLine: 'line-through' },
  acoes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  acao: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  acaoTxt: { ...typography.small, color: colors.text.secondary },
  recado: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: withAlpha(colors.accent.gold, 0.12),
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    padding: spacing.md,
  },
  estado: { ...typography.small, fontSize: 11.5, color: colors.text.tertiary, marginTop: 4, textAlign: 'right' },
  rodape: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  respondendo: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  respondendoTxt: { ...typography.small, color: colors.text.secondary, flex: 1 },
  respondendoX: { ...typography.body, color: colors.text.tertiary },
  compor: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  campo: {
    flex: 1,
    ...typography.body,
    fontSize: 15,
    color: colors.text.primary,
    maxHeight: 140,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg.surface,
  },
  enviar: {
    backgroundColor: colors.accent.gold,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
  },
  enviarTxt: { ...typography.bodyMedium, fontSize: 15, color: colors.text.onGold },
  dica: { ...typography.small, fontSize: 11.5, color: colors.text.tertiary, marginTop: spacing.xs },
});
