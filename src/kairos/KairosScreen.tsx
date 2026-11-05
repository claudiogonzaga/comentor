// A aba Kairós: as tarefas por área da vida. Urgentes numa seção própria sempre no
// topo; depois o resto, do prazo mais próximo ao sem prazo. São as mesmas tarefas do
// Áskesis do Mac, onde uma IA também mexe nelas (kairos_mcp.py). A cara segue o tema
// da Noosfera (theme.ts): superfície calma, um acento, ícones de traço, sem emoji.
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
  IA_COR,
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
import { Icone } from './icones';
import { LAPIDE_MS, useKairos, type Campos } from './store';
import { corDaArea, corVisivel, fonte, semEmoji, temaKairos, type Tema } from './theme';

// Onde cada IA abre uma conversa nova já com o pedido. O Gemini não aceita o pedido
// no endereço: ele vai para a área de transferência. O Claude Code fica no Mac.
const DESTINOS = [
  { ia: 'Claude', sub: 'conversa nova, já com a tarefa', url: (q: string) => `https://claude.ai/new?q=${q}` },
  { ia: 'Gemini', sub: 'o pedido vai para a área de transferência: é só colar', url: () => 'https://gemini.google.com/app', copia: true },
  { ia: 'Grok', sub: 'conversa nova, já com a tarefa', url: (q: string) => `https://grok.com/?q=${q}` },
  { ia: 'ChatGPT', sub: 'conversa nova, já com a tarefa', url: (q: string) => `https://chatgpt.com/?q=${q}` },
];

export function KairosScreen() {
  const scheme = useColorScheme();
  // Espacial: sempre escuro. Ecológico: sempre claro. Terracota: conforme o sistema.
  const c = temaKairos(scheme === 'dark');
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
  const nFeitas = tarefas.length - abertas.length;
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

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
      k.registrarAndamento(t.id, `Conversa aberta no ${destino.ia}.`, 'Noosfera');
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
            {plural(abertas.length, 'aberta', 'abertas')} · {plural(nUrg, 'urgente', 'urgentes')} ·{' '}
            {plural(nFeitas, 'concluída', 'concluídas')}
          </Text>
        </View>
        <Pressable
          onPress={() => setDossie(dossieCoaching(tarefas))}
          style={s.btnCab}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Dossiê de coaching"
        >
          <Icone nome="dossie" size={20} cor={c.suave} />
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
            tintColor={c.acento}
            colors={[c.escuro ? c.sobreAcento : c.acento]}
            progressBackgroundColor={c.escuro ? c.acento : c.card}
          />
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={s.chipsDentro}>
          {['Todas', ...areas].map((a) => {
            const n = a === 'Todas' ? abertas.length : abertas.filter((t) => t.area === a).length;
            if (a !== 'Todas' && n === 0 && filtro !== a) return null;
            const ativo = filtro === a;
            return (
              <Pressable
                key={a}
                onPress={() => setFiltro(a)}
                style={[s.chip, ativo && s.chipAtivo]}
                accessibilityRole="tab"
                accessibilityState={{ selected: ativo }}
              >
                {a !== 'Todas' && <View style={[s.chipPonto, { backgroundColor: ativo ? c.sobreAcento : corDaArea(a, c) }]} />}
                <Text style={[s.chipTxt, ativo && s.chipTxtAtivo]}>{semEmoji(a)}</Text>
                <Text style={[s.chipN, ativo && s.chipTxtAtivo]}>{n}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          onPress={() => setVerFeitas((v) => !v)}
          style={s.toggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: verFeitas }}
        >
          <Caixa marcada={verFeitas} c={c} />
          <Text style={s.toggleTxt}>Mostrar concluídas anteriores</Text>
        </Pressable>

        {urgentes.length > 0 && (
          <View style={s.secao}>
            <View style={s.secaoCab}>
              <View style={[s.secaoPonto, { backgroundColor: c.urg }]} />
              <Text style={[s.secaoTit, { color: c.urg }]}>Urgentes</Text>
              <Text style={s.secaoN}>{urgentes.length}</Text>
            </View>
            {urgentes.map(card)}
          </View>
        )}

        <View style={s.secao}>
          {urgentes.length > 0 && resto.length > 0 && (
            <View style={s.secaoCab}>
              <Text style={s.secaoTit}>Próximas</Text>
              <Text style={s.secaoN}>{resto.length}</Text>
            </View>
          )}
          {resto.length === 0 && urgentes.length === 0 ? (
            <Text style={s.vazio}>
              Nada por aqui.{'\n'}Toque no + para adicionar. No Mac, uma IA também cria e edita tarefas
              pela Noosfera.
            </Text>
          ) : (
            resto.map(card)
          )}
        </View>
      </ScrollView>

      <Pressable style={s.fab} onPress={() => setForm('nova')} accessibilityRole="button" accessibilityLabel="Nova tarefa">
        <Icone nome="mais" size={26} cor={c.sobreAcento} espessura={2.2} />
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
            <View style={s.alca} />
            <Text style={s.formTit}>Fazer com IA</Text>
            {!!delegando && (
              <Text style={s.ajuda} numberOfLines={2}>
                “{delegando.titulo}”
              </Text>
            )}
            {DESTINOS.map((d) => (
              <Pressable key={d.ia} style={s.opcaoIa} onPress={() => delegando && void delegar(delegando, d)}>
                <View style={[s.opcaoPonto, { backgroundColor: corVisivel(IA_COR[d.ia], c) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.opcaoIaTit}>{d.ia}</Text>
                  <Text style={s.opcaoIaSub}>{d.sub}</Text>
                </View>
              </Pressable>
            ))}
            <Pressable style={s.opcaoIa} onPress={() => delegando && void colarConversa(delegando)}>
              <Icone nome="elo" size={16} cor={c.suave} />
              <View style={{ flex: 1 }}>
                <Text style={s.opcaoIaTit}>Ligar a conversa copiada</Text>
                <Text style={s.opcaoIaSub}>copie o link da conversa e toque aqui</Text>
              </View>
            </Pressable>
            <Text style={s.ajuda}>No Mac, o botão IA abre também uma sessão do Claude Code, que se liga ao card sozinha.</Text>
            <Pressable style={s.cancelarBtn} onPress={() => setDelegando(null)}>
              <Text style={s.cancelarTxt}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={dossie !== null} animationType="slide" onRequestClose={() => setDossie(null)}>
        <View style={[s.tela, { padding: 20 }]}>
          <Text style={s.formTit}>Dossiê para coaching por IA</Text>
          <Text style={s.ajuda}>
            Copie e cole numa IA (Claude, Gemini…): ele junta estrelas, badges e comentários para ela analisar
            seus padrões e aconselhar. No Mac, a IA também o lê direto pela Noosfera.
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
            <Icone nome="copiar" size={17} cor={c.sobreAcento} />
            <Text style={s.salvarTxt}>Copiar tudo</Text>
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
    <ScrollView style={s.tela} contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
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
            <View style={[s.chipPonto, { backgroundColor: area === a ? c.sobreAcento : corDaArea(a, c) }]} />
            <Text style={[s.opcaoTxt, area === a && s.opcaoTxtAtiva]}>{semEmoji(a)}</Text>
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
          <Icone nome="data" size={16} cor={c.suave} />
          <Text style={[s.inputTxt, !prazo && { color: c.suave }]}>{prazo ? fmtData(prazo) : 'Sem prazo: toque para escolher'}</Text>
        </Pressable>
        {!!prazo && (
          <Pressable onPress={escolherHora} style={[s.input, s.inputHora]}>
            <Text style={[s.inputTxt, !hora && { color: c.suave }]}>{hora || 'hora'}</Text>
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
            <Icone nome="fechar" size={18} cor={c.suave} />
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

      <Pressable
        onPress={() => setUrgente((v) => !v)}
        style={s.checkLinha}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: urgente }}
      >
        <Caixa marcada={urgente} c={c} />
        <Text style={s.checkLinhaTxt}>Marcar como urgente</Text>
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

/** A caixinha de marcar, desenhada (no lugar dos caracteres de caixa). */
function Caixa({ marcada, c }: { marcada: boolean; c: Tema }) {
  return (
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        borderWidth: 1.5,
        borderColor: marcada ? c.acento : c.suave,
        backgroundColor: marcada ? c.acento : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {marcada && <Icone nome="check" size={13} cor={c.sobreAcento} espessura={2.6} />}
    </View>
  );
}

const estilos = (c: Tema) =>
  StyleSheet.create({
    tela: { flex: 1, backgroundColor: c.bg },
    cabecalho: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    marca: { fontFamily: fonte.marca, fontSize: 26, lineHeight: 32, color: c.txt },
    sub: { fontFamily: fonte.texto, fontSize: 12.5, color: c.suave, marginTop: 1 },
    btnCab: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    chips: { flexGrow: 0, marginTop: 8 },
    chipsDentro: { paddingHorizontal: 16, gap: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
    },
    chipAtivo: { backgroundColor: c.acento },
    chipPonto: { width: 6, height: 6, borderRadius: 3 },
    chipTxt: { fontFamily: fonte.medio, fontSize: 13, color: c.txt },
    chipN: { fontFamily: fonte.texto, fontSize: 12, color: c.suave },
    chipTxtAtivo: { color: c.sobreAcento },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
    toggleTxt: { fontFamily: fonte.texto, fontSize: 13, color: c.suave },
    secao: { paddingHorizontal: 14, marginBottom: 8 },
    secaoCab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, marginTop: 6, marginBottom: 2 },
    secaoPonto: { width: 6, height: 6, borderRadius: 3 },
    secaoTit: { fontFamily: fonte.forte, fontSize: 12.5, letterSpacing: 0.4, color: c.suave },
    secaoN: { fontFamily: fonte.texto, fontSize: 12.5, color: c.suave },
    vazio: { textAlign: 'center', fontFamily: fonte.texto, color: c.suave, marginTop: 60, fontSize: 14, lineHeight: 21, paddingHorizontal: 24 },
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 24,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.acento,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 3,
    },
    formTit: { fontFamily: fonte.titulo, fontSize: 20, lineHeight: 26, color: c.txt, marginBottom: 4 },
    ajuda: { fontFamily: fonte.texto, fontSize: 12.5, color: c.suave, marginVertical: 8, lineHeight: 18 },
    dossie: { flex: 1, borderRadius: 12, padding: 12, backgroundColor: c.card, marginTop: 4 },
    dossieTxt: { fontSize: 11.5, color: c.txt, lineHeight: 16 },
    rotulo: { fontFamily: fonte.forte, fontSize: 12, color: c.suave, marginTop: 18, marginBottom: 6 },
    input: {
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontFamily: fonte.texto,
      fontSize: 15,
      color: c.txt,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.linha,
    },
    inputTxt: { fontFamily: fonte.texto, fontSize: 15, color: c.txt },
    inputData: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    inputHora: { justifyContent: 'center', width: 84, alignItems: 'center' },
    linhaData: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    limpar: { padding: 8 },
    textarea: { minHeight: 96, textAlignVertical: 'top' },
    opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    opcao: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: c.card,
    },
    opcaoAtiva: { backgroundColor: c.acento },
    opcaoTxt: { fontFamily: fonte.texto, fontSize: 13, color: c.txt },
    opcaoTxtAtiva: { fontFamily: fonte.forte, color: c.sobreAcento },
    checkLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
    checkLinhaTxt: { fontFamily: fonte.texto, fontSize: 15, color: c.txt },
    salvar: {
      marginTop: 24,
      backgroundColor: c.acento,
      borderRadius: 24,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    salvarTxt: { fontFamily: fonte.forte, color: c.sobreAcento, fontSize: 15 },
    cancelarBtn: { paddingVertical: 14, alignItems: 'center' },
    veu: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    folha: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
    alca: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: c.linha, marginBottom: 14 },
    opcaoIa: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.linha,
    },
    opcaoPonto: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
    opcaoIaTit: { fontFamily: fonte.forte, fontSize: 15, color: c.txt },
    opcaoIaSub: { fontFamily: fonte.texto, fontSize: 12, color: c.suave, marginTop: 1 },
    cancelarTxt: { fontFamily: fonte.medio, color: c.suave, fontSize: 14 },
  });
