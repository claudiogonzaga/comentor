// A aba Kairós: as tarefas por área da vida. Urgentes numa seção vermelha sempre no
// topo; depois o resto, do prazo mais próximo ao sem prazo. São as mesmas tarefas do
// Áskesis do Mac, onde uma IA também mexe nelas (kairos_mcp.py).
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { syncConfigNow } from '../services/configSync';
import { TaskCard } from './TaskCard';
import {
  PRIORIDADES,
  TIPOS_SAUDE,
  areasDe,
  dossieCoaching,
  ehUrgente,
  fmtData,
  linkDeConversa,
  ordenar,
  promptDelegacao,
  type Conversa,
  type Prioridade,
  type Tarefa,
} from './rules';
import { LAPIDE_MS, useKairos, type Campos } from './store';
import { AREA_ICONE, dark, fixas, light, type Tema } from './theme';

// Onde cada IA abre uma conversa nova já com o pedido. O Gemini não aceita o pedido
// no endereço: ele vai para a área de transferência. O Claude Code fica no Mac.
const DESTINOS = [
  { ia: 'Claude', sub: 'conversa nova, já com a tarefa', url: (q: string) => `https://claude.ai/new?q=${q}` },
  { ia: 'Gemini', sub: 'o pedido vai para a área de transferência: é só colar', url: () => 'https://gemini.google.com/app', copia: true },
  { ia: 'Grok', sub: 'conversa nova, já com a tarefa', url: (q: string) => `https://grok.com/?q=${q}` },
  { ia: 'ChatGPT', sub: 'conversa nova, já com a tarefa', url: (q: string) => `https://chatgpt.com/?q=${q}` },
];

export function KairosScreen() {
  const c = useColorScheme() === 'dark' ? dark : light;
  const s = useMemo(() => estilos(c), [c]);
  const { tarefas, pulados, lapides } = useKairos();
  const k = useKairos.getState();

  const [filtro, setFiltro] = useState('Todas');
  const [verFeitas, setVerFeitas] = useState(false);
  const [form, setForm] = useState<Tarefa | 'nova' | null>(null);
  const [dossie, setDossie] = useState<string | null>(null);
  const [delegando, setDelegando] = useState<Tarefa | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [, setRelogio] = useState(0);

  useEffect(() => {
    void useKairos.getState().load();
  }, []);

  // A lápide some sozinha: redesenha quando a mais antiga vence.
  const vivas = Object.entries(lapides).filter(([, ts]) => Date.now() - ts < LAPIDE_MS);
  const proxima = vivas.length ? Math.min(...vivas.map(([, ts]) => ts)) + LAPIDE_MS : 0;
  useEffect(() => {
    if (!proxima) return;
    const id = setTimeout(() => setRelogio(Date.now()), Math.max(300, proxima - Date.now() + 50));
    return () => clearTimeout(id);
  }, [proxima]);
  const lapideIds = new Set(vivas.map(([id]) => id));

  const areas = useMemo(() => areasDe(tarefas), [tarefas]);
  const abertas = tarefas.filter((t) => t.status !== 'Feito');
  // A recém-concluída fica no lugar dela, como se ainda estivesse aberta.
  const base = tarefas
    .filter((t) => !pulados[t.id] && (filtro === 'Todas' || t.area === filtro))
    .map((t) => (lapideIds.has(t.id) && t.status === 'Feito' ? { ...t, status: 'A fazer' as const } : t));
  const urgentes = ordenar(base.filter(ehUrgente));
  const resto = ordenar(base.filter((t) => !ehUrgente(t) && (t.status !== 'Feito' || verFeitas)));
  const nUrg = abertas.filter(ehUrgente).length;

  const excluir = (t: Tarefa) =>
    Alert.alert(
      'Excluir tarefa?',
      `"${t.titulo}" some daqui e do Mac. Para guardar no histórico, conclua em vez de excluir.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: () => k.excluir(t.id) },
      ],
    );

  const abrirConversa = (cv: Conversa) => {
    if (cv.url.startsWith('claude://')) {
      Alert.alert('Abre no Mac', `Esta é uma sessão do ${cv.ia} no app do Claude do Mac: abra pelo Kairós de lá.`);
      return;
    }
    // Só endereço da web: o link veio de uma IA ou de outro aparelho.
    if (!/^https?:\/\//i.test(cv.url)) return;
    void Linking.openURL(cv.url).catch(() => Alert.alert('Não abriu', cv.url));
  };

  const ocultarConversa = (t: Tarefa, cv: Conversa) =>
    Alert.alert('Tirar do card?', `A conversa no ${cv.ia} deixa de aparecer nesta tarefa.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tirar', onPress: () => k.ocultarConversa(t.id, cv.url) },
    ]);

  const delegar = async (t: Tarefa, destino: (typeof DESTINOS)[number]) => {
    setDelegando(null);
    const pedido = promptDelegacao(t);
    if (destino.copia) await Clipboard.setStringAsync(pedido);
    try {
      await Linking.openURL(destino.url(encodeURIComponent(pedido)));
      k.registrarAndamento(t.id, `Conversa aberta no ${destino.ia}.`, 'Áskesis');
      if (destino.copia) Alert.alert('Pedido copiado', `Cole na conversa do ${destino.ia}.`);
    } catch {
      Alert.alert('Não abriu', `Não consegui abrir o ${destino.ia}.`);
    }
  };

  const colarConversa = async (t: Tarefa) => {
    setDelegando(null);
    const url = linkDeConversa(await Clipboard.getStringAsync());
    if (!url) {
      Alert.alert('Nada para ligar', 'Copie primeiro o link da conversa e toque de novo.');
      return;
    }
    k.vincularConversa(t.id, url);
  };

  const card = (t: Tarefa) => (
    <TaskCard
      key={`${t.id}:${t.atualizadoEm}`}
      tarefa={t}
      c={c}
      lapide={lapideIds.has(t.id)}
      onConcluir={(e, b, cm) => k.concluir(t.id, e, b, cm)}
      onConcluirRapido={() => k.concluirRapido(t.id)}
      onReabrir={() => k.reabrir(t.id)}
      onPular={() => k.pular(t.id)}
      onNotas={(notas) => k.atualizar(t.id, { notas })}
      onEditar={() => setForm(tarefas.find((x) => x.id === t.id) ?? null)}
      onExcluir={() => excluir(t)}
      onDelegar={() => setDelegando(tarefas.find((x) => x.id === t.id) ?? null)}
      onAbrirConversa={abrirConversa}
      onOcultarConversa={(cv) => ocultarConversa(t, cv)}
    />
  );

  return (
    <View style={s.tela}>
      <View style={s.cabecalho}>
        <View style={{ flex: 1 }}>
          <Text style={s.marca}>kairός</Text>
          <Text style={s.sub}>
            {abertas.length} aberta(s) · {nUrg} urgente(s) · {tarefas.length - abertas.length} concluída(s)
          </Text>
        </View>
        <Pressable
          onPress={() => setDossie(dossieCoaching(tarefas))}
          style={s.btnCab}
          accessibilityLabel="Dossiê de coaching"
        >
          <Text style={s.btnCabTxt}>📊</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={sincronizando}
            onRefresh={() => {
              setSincronizando(true);
              void syncConfigNow().finally(() => setSincronizando(false));
            }}
            tintColor={fixas.roxo}
            colors={[fixas.roxo]}
          />
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips}>
          {['Todas', ...areas].map((a) => {
            const n = a === 'Todas' ? abertas.length : abertas.filter((t) => t.area === a).length;
            if (a !== 'Todas' && n === 0 && filtro !== a) return null;
            const ativo = filtro === a;
            return (
              <Pressable key={a} onPress={() => setFiltro(a)} style={[s.chip, ativo && s.chipAtivo]}>
                <Text style={[s.chipTxt, ativo && s.chipTxtAtivo]}>
                  {AREA_ICONE[a] || ''} {a} {n}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable onPress={() => setVerFeitas((v) => !v)} style={s.toggle}>
          <Text style={s.toggleTxt}>{verFeitas ? '☑' : '☐'} mostrar concluídas anteriores</Text>
        </Pressable>

        {urgentes.length > 0 && (
          <View style={s.secaoUrg}>
            <Text style={s.secaoUrgTit}>🚨 Urgentes ({urgentes.length})</Text>
            {urgentes.map(card)}
          </View>
        )}

        <View style={s.lista}>
          {resto.length === 0 && urgentes.length === 0 ? (
            <Text style={s.vazio}>
              Nada por aqui ✨{'\n'}Toque no + para adicionar.{'\n'}No Mac, uma IA também cria e edita tarefas
              pelo Áskesis.
            </Text>
          ) : (
            resto.map(card)
          )}
        </View>
      </ScrollView>

      <Pressable style={s.fab} onPress={() => setForm('nova')} accessibilityLabel="Nova tarefa">
        <Text style={s.fabTxt}>+</Text>
      </Pressable>

      <Modal visible={form !== null} animationType="slide" onRequestClose={() => setForm(null)}>
        {form !== null && (
          <TaskForm
            c={c}
            areas={areas}
            existente={form === 'nova' ? undefined : form}
            areaInicial={filtro !== 'Todas' ? filtro : 'Pessoal'}
            onCancelar={() => setForm(null)}
            onSalvar={(campos) => {
              if (form === 'nova') k.criar(campos);
              else k.atualizar(form.id, campos);
              setForm(null);
            }}
          />
        )}
      </Modal>

      <Modal visible={delegando !== null} transparent animationType="fade" onRequestClose={() => setDelegando(null)}>
        <Pressable style={s.veu} onPress={() => setDelegando(null)}>
          <Pressable style={s.folha} onPress={() => {}}>
            <Text style={s.formTit}>🤖 Fazer com IA</Text>
            {!!delegando && (
              <Text style={s.ajuda} numberOfLines={2}>
                "{delegando.titulo}"
              </Text>
            )}
            {DESTINOS.map((d) => (
              <Pressable key={d.ia} style={s.opcaoIa} onPress={() => delegando && void delegar(delegando, d)}>
                <Text style={s.opcaoIaTit}>{d.ia}</Text>
                <Text style={s.opcaoIaSub}>{d.sub}</Text>
              </Pressable>
            ))}
            <Pressable style={s.opcaoIa} onPress={() => delegando && void colarConversa(delegando)}>
              <Text style={s.opcaoIaTit}>📋 Ligar a conversa copiada</Text>
              <Text style={s.opcaoIaSub}>copie o link da conversa e toque aqui</Text>
            </Pressable>
            <Text style={s.ajuda}>No Mac, o 🤖 abre também uma sessão do Claude Code, que se liga ao card sozinha.</Text>
            <Pressable style={s.cancelarBtn} onPress={() => setDelegando(null)}>
              <Text style={s.cancelarTxt}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={dossie !== null} animationType="slide" onRequestClose={() => setDossie(null)}>
        <View style={[s.tela, { padding: 16 }]}>
          <Text style={s.formTit}>📊 Dossiê para coaching por IA</Text>
          <Text style={s.ajuda}>
            Copie e cole numa IA (Claude, Gemini…): ele junta estrelas, badges e comentários para ela analisar
            seus padrões e aconselhar. No Mac, a IA também o lê direto pelo Áskesis.
          </Text>
          <ScrollView style={s.dossie}>
            <Text style={s.dossieTxt} selectable>
              {dossie}
            </Text>
          </ScrollView>
          <Pressable
            style={s.salvar}
            onPress={() => {
              void Clipboard.setStringAsync(dossie ?? '');
              Alert.alert('Copiado', 'O dossiê está na área de transferência.');
            }}
          >
            <Text style={s.salvarTxt}>📋 Copiar tudo</Text>
          </Pressable>
          <Pressable style={s.cancelarBtn} onPress={() => setDossie(null)}>
            <Text style={s.cancelarTxt}>Fechar</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

interface FormProps {
  c: Tema;
  areas: string[];
  existente?: Tarefa;
  areaInicial: string;
  onSalvar: (campos: Campos) => void;
  onCancelar: () => void;
}

function TaskForm({ c, areas, existente, areaInicial, onSalvar, onCancelar }: FormProps) {
  const s = useMemo(() => estilos(c), [c]);
  const [titulo, setTitulo] = useState(existente?.titulo ?? '');
  const [area, setArea] = useState(existente?.area ?? areaInicial);
  const [prioridade, setPrioridade] = useState<Prioridade>(existente?.prioridade ?? 'Média');
  const [prazo, setPrazo] = useState(existente?.prazo ?? '');
  const [hora, setHora] = useState(existente?.hora ?? '');
  const [tipo, setTipo] = useState(existente?.tipo ?? '');
  const [notas, setNotas] = useState(existente?.notas ?? '');
  const [urgente, setUrgente] = useState(!!existente?.urgente);

  const escolherData = () =>
    DateTimePickerAndroid.open({
      value: prazo ? new Date(`${prazo}T12:00:00`) : new Date(),
      mode: 'date',
      onChange: (ev, d) => {
        if (ev.type !== 'set' || !d) return;
        setPrazo(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      },
    });

  const escolherHora = () => {
    const base = new Date();
    if (hora) base.setHours(Number(hora.slice(0, 2)), Number(hora.slice(3, 5)), 0, 0);
    DateTimePickerAndroid.open({
      value: base,
      mode: 'time',
      is24Hour: true,
      onChange: (ev, d) => {
        if (ev.type !== 'set' || !d) return;
        setHora(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      },
    });
  };

  const salvar = () => {
    if (!titulo.trim()) {
      Alert.alert('Falta o título', 'Diga o que precisa ser feito.');
      return;
    }
    onSalvar({
      titulo: titulo.trim(),
      area,
      prioridade,
      prazo,
      hora: prazo ? hora : '',
      tipo: area === 'Saúde' ? tipo : '',
      notas: notas.trim(),
      urgente,
    });
  };

  return (
    <ScrollView style={s.tela} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={s.formTit}>{existente ? 'Editar tarefa' : 'Nova tarefa'}</Text>

      <Text style={s.rotulo}>Título</Text>
      <TextInput
        style={s.input}
        value={titulo}
        onChangeText={setTitulo}
        placeholder="O que precisa ser feito?"
        placeholderTextColor={c.suave}
        autoFocus={!existente}
      />

      <Text style={s.rotulo}>Área da vida</Text>
      <View style={s.opcoes}>
        {areas.map((a) => (
          <Pressable key={a} onPress={() => setArea(a)} style={[s.opcao, area === a && s.opcaoAtiva]}>
            <Text style={[s.opcaoTxt, area === a && s.opcaoTxtAtiva]}>
              {AREA_ICONE[a] || ''} {a}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.rotulo}>Prioridade</Text>
      <View style={s.opcoes}>
        {PRIORIDADES.map((p) => (
          <Pressable key={p} onPress={() => setPrioridade(p)} style={[s.opcao, prioridade === p && s.opcaoAtiva]}>
            <Text style={[s.opcaoTxt, prioridade === p && s.opcaoTxtAtiva]}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.rotulo}>Prazo</Text>
      <View style={s.linhaData}>
        <Pressable onPress={escolherData} style={[s.input, s.inputData]}>
          <Text style={{ color: prazo ? c.txt : c.suave }}>{prazo ? fmtData(prazo) : 'sem prazo — toque para escolher'}</Text>
        </Pressable>
        {!!prazo && (
          <Pressable onPress={escolherHora} style={[s.input, s.inputHora]}>
            <Text style={{ color: hora ? c.txt : c.suave }}>{hora || 'hora'}</Text>
          </Pressable>
        )}
        {!!prazo && (
          <Pressable
            onPress={() => {
              setPrazo('');
              setHora('');
            }}
            style={s.limpar}
            accessibilityLabel="Tirar o prazo"
          >
            <Text style={{ color: c.suave }}>✕</Text>
          </Pressable>
        )}
      </View>

      {area === 'Saúde' && (
        <>
          <Text style={s.rotulo}>Tipo</Text>
          <View style={s.opcoes}>
            {TIPOS_SAUDE.map((t) => (
              <Pressable key={t || 'nenhum'} onPress={() => setTipo(t)} style={[s.opcao, tipo === t && s.opcaoAtiva]}>
                <Text style={[s.opcaoTxt, tipo === t && s.opcaoTxtAtiva]}>{t || '—'}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={s.rotulo}>Observações e detalhes</Text>
      <TextInput
        style={[s.input, s.textarea]}
        value={notas}
        onChangeText={setNotas}
        multiline
        placeholder="Local, contatos, links, passos, o que lembrar…"
        placeholderTextColor={c.suave}
      />

      <Pressable onPress={() => setUrgente((v) => !v)} style={s.checkLinha}>
        <Text style={s.checkLinhaTxt}>{urgente ? '☑' : '☐'} 🚨 Marcar como urgente</Text>
      </Pressable>

      <Pressable onPress={salvar} style={s.salvar}>
        <Text style={s.salvarTxt}>Salvar</Text>
      </Pressable>
      <Pressable onPress={onCancelar} style={s.cancelarBtn}>
        <Text style={s.cancelarTxt}>Cancelar</Text>
      </Pressable>
    </ScrollView>
  );
}

const estilos = (c: Tema) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: c.bg },
    cabecalho: {
      backgroundColor: fixas.roxo,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    marca: { color: '#fff', fontSize: 20, fontWeight: '700' },
    sub: { color: '#fff', opacity: 0.85, fontSize: 11, marginTop: 2 },
    btnCab: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 8, padding: 8 },
    btnCabTxt: { fontSize: 16 },
    chips: { paddingHorizontal: 12, paddingTop: 10, flexGrow: 0 },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 20,
      marginRight: 8,
      borderWidth: 1,
      borderColor: c.linha,
      backgroundColor: c.card,
    },
    chipAtivo: { backgroundColor: fixas.roxo, borderColor: fixas.roxo },
    chipTxt: { fontSize: 13, fontWeight: '600', color: c.txt },
    chipTxtAtivo: { color: '#fff' },
    toggle: { paddingHorizontal: 18, paddingVertical: 8 },
    toggleTxt: { fontSize: 12, color: c.suave },
    secaoUrg: {
      marginHorizontal: 12,
      borderWidth: 1,
      borderColor: c.urgBd,
      borderRadius: 10,
      backgroundColor: c.urgBg,
      padding: 8,
      marginBottom: 6,
    },
    secaoUrgTit: { color: c.urgTx, fontWeight: '800', fontSize: 13, marginBottom: 4 },
    lista: { paddingHorizontal: 12 },
    vazio: { textAlign: 'center', color: c.suave, marginTop: 60, fontSize: 14, lineHeight: 21 },
    fab: {
      position: 'absolute',
      right: 18,
      bottom: 24,
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: fixas.roxo,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 6,
    },
    fabTxt: { color: '#fff', fontSize: 32, lineHeight: 36 },
    formTit: { fontSize: 18, fontWeight: '700', color: c.txt, marginBottom: 4 },
    ajuda: { fontSize: 12, color: c.suave, marginVertical: 8, lineHeight: 17 },
    dossie: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.linha,
      borderRadius: 9,
      padding: 10,
      backgroundColor: c.card,
    },
    dossieTxt: { fontSize: 11.5, color: c.txt, lineHeight: 16 },
    rotulo: { fontSize: 12, fontWeight: '600', color: c.suave, marginTop: 14, marginBottom: 5 },
    input: {
      borderWidth: 1,
      borderColor: c.linha,
      borderRadius: 9,
      padding: 12,
      fontSize: 15,
      color: c.txt,
      backgroundColor: c.card,
    },
    inputData: { justifyContent: 'center', flex: 1 },
    inputHora: { justifyContent: 'center', width: 84, alignItems: 'center' },
    linhaData: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    limpar: { padding: 10 },
    textarea: { minHeight: 90, textAlignVertical: 'top' },
    opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    opcao: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.linha,
      backgroundColor: c.card,
    },
    opcaoAtiva: { backgroundColor: fixas.roxo, borderColor: fixas.roxo },
    opcaoTxt: { fontSize: 13, color: c.txt },
    opcaoTxtAtiva: { color: '#fff', fontWeight: '700' },
    checkLinha: { marginTop: 18 },
    checkLinhaTxt: { fontSize: 15, color: c.txt },
    salvar: {
      marginTop: 22,
      backgroundColor: fixas.roxo,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
    },
    salvarTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
    cancelarBtn: { paddingVertical: 14, alignItems: 'center' },
    veu: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    folha: { backgroundColor: c.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
    opcaoIa: {
      borderWidth: 1,
      borderColor: c.linha,
      borderRadius: 10,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 8,
    },
    opcaoIaTit: { fontSize: 15, color: c.txt, fontWeight: '600' },
    opcaoIaSub: { fontSize: 11.5, color: c.suave, marginTop: 2 },
    cancelarTxt: { color: c.suave, fontSize: 14 },
  });
