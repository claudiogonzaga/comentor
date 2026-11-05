// O card do Kairós, com a anatomia do painel do Graphé, mais enxuta:
//   • ÁREA · urgente          ← ponto de cor e texto pequeno no topo
//   Título
//   data · prioridade · tipo
//   observações (editáveis no próprio card)
//   ações: ○ concluir · Avaliar · Pular · IA            editar · excluir
// Avaliar abre a avaliação no próprio card: estrelas, badges e comentário. As badges
// continuam guardadas como emoji (é a chave delas); aqui aparecem só pelo nome.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  BADGES,
  IA_COR,
  ROTULO_ESTRELA,
  badgeDe,
  ehAtrasada,
  ehUrgente,
  fmtData,
  limitesDaNota,
  type Conversa,
  type Tarefa,
} from './rules';
import { Estrela, Icone } from './icones';
import { corDaArea, corDaPrioridade, corVisivel, fonte, semEmoji, type Tema } from './theme';

interface Props {
  tarefa: Tarefa;
  c: Tema;
  /** Recém-concluída: fica no lugar, desbotada, com o Desfazer. */
  lapide?: boolean;
  onConcluir: (estrelas: number, badges: string[], comentario: string) => void;
  onConcluirRapido: () => void;
  onReabrir: () => void;
  onPular: () => void;
  onNotas: (notas: string) => void;
  onEditar: () => void;
  onExcluir: () => void;
  /** Fazer com IA: abrir uma conversa já com a tarefa, ou ligar uma que existe. */
  onDelegar: () => void;
  onAbrirConversa: (c: Conversa) => void;
  onOcultarConversa: (c: Conversa) => void;
}

function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

const estrelasTxt = (n: number) => `${n} ${n === 1 ? 'estrela' : 'estrelas'}`;

/** A fileira de estrelas da nota já dada (só leitura). */
function Nota({ n, c }: { n: number; c: Tema }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityLabel={estrelasTxt(n)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Estrela key={i} cheia={i <= n} size={14} cor={c.estrela} />
      ))}
    </View>
  );
}

export function TaskCard(props: Props) {
  const { tarefa: t, c, lapide } = props;
  const s = estilos(c);

  const [avaliando, setAvaliando] = useState(false);
  const [estrelas, setEstrelas] = useState(t.estrelas || 0);
  const [sel, setSel] = useState<string[]>(t.badges ?? []);
  const [comentario, setComentario] = useState(t.comentario || '');
  const [editandoNotas, setEditandoNotas] = useState(false);
  const [notas, setNotas] = useState(t.notas || '');

  const feito = t.status === 'Feito';
  const urgente = ehUrgente(t);
  const atrasada = ehAtrasada(t);
  const { cap, piso } = limitesDaNota(sel);

  // As regras de nota do Graphé: a negativa derruba para o teto; a positiva sugere 4
  // (5 com duas ou mais, ou o "auto" da badge), sempre entre o piso e o teto.
  function alternarBadge(e: string) {
    const novo = sel.includes(e) ? sel.filter((x) => x !== e) : [...sel, e];
    setSel(novo);
    const info = badgeDe(e);
    const lim = limitesDaNota(novo);
    if (info?.tipo === 'neg' && novo.includes(e)) {
      setEstrelas(lim.cap);
    } else if (info?.tipo === 'pos' && novo.includes(e)) {
      const positivas = novo.map(badgeDe).filter((b) => b?.tipo === 'pos');
      const auto = Math.max(0, ...positivas.map((b) => b?.auto ?? 0));
      const sugerido = Math.max(positivas.length >= 2 ? 5 : 4, auto);
      setEstrelas(Math.max(lim.piso, Math.min(sugerido, lim.cap)));
    } else {
      setEstrelas((v) => Math.max(lim.piso, Math.min(v || lim.piso, lim.cap)));
    }
  }

  const textoPadrao = semEmoji(BADGES.filter((b) => sel.includes(b.e)).map((b) => b.txt).join(' '));
  // A conversa mais recente primeiro; o andamento mostra só o último passo.
  const conversas = (t.conversas ?? []).filter((cv) => !cv.oculta).reverse();
  const ultimo = t.andamento?.length ? t.andamento[t.andamento.length - 1] : null;
  const avisoNota =
    cap < 5
      ? `Com sinal negativo, no máximo ${estrelasTxt(cap)}`
      : piso >= 5
        ? 'Nota travada em 5 estrelas'
        : piso > 1
          ? `Não pode ser menor que ${estrelasTxt(piso)}`
          : '';

  if (lapide) {
    return (
      <View style={[s.card, s.lapide]}>
        <Text style={[s.titulo, s.tituloFeito]}>{t.titulo}</Text>
        <View style={s.acoes}>
          <Text style={s.metaTxt}>Concluída</Text>
          <Pressable onPress={props.onReabrir} style={s.linkBtn} hitSlop={8} accessibilityRole="button">
            <Icone nome="desfazer" size={15} cor={c.acento} />
            <Text style={s.linkTxt}>Desfazer</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.card, urgente && s.cardUrg]}>
      <View style={s.topo}>
        <View style={[s.ponto, { backgroundColor: corDaArea(t.area, c) }]} />
        <Text style={s.area}>{semEmoji(t.area)}</Text>
        {t.urgente && !feito && <Text style={[s.area, { color: c.urg }]}>· urgente</Text>}
      </View>

      <Text style={[s.titulo, feito && s.tituloFeito]}>{t.titulo}</Text>

      <View style={s.meta}>
        {!!t.prazo && (
          <View style={s.metaItem}>
            <Icone nome="data" size={13} cor={atrasada ? c.urg : c.suave} />
            <Text style={[s.metaTxt, atrasada && s.atrasada]}>
              {fmtData(t.prazo)}
              {t.hora ? ` ${t.hora}` : ''}
              {atrasada ? ' · atrasada' : ''}
            </Text>
          </View>
        )}
        <View style={s.metaItem}>
          <View style={[s.pontoP, { backgroundColor: corDaPrioridade(t.prioridade, c) }]} />
          <Text style={s.metaTxt}>{t.prioridade}</Text>
        </View>
        {!!t.tipo && <Text style={s.metaTxt}>{t.tipo}</Text>}
      </View>

      {!feito &&
        (editandoNotas ? (
          <TextInput
            style={s.obsEdit}
            value={notas}
            onChangeText={setNotas}
            multiline
            autoFocus
            placeholder="Local, contatos, links, passos, o que lembrar…"
            placeholderTextColor={c.suave}
            onBlur={() => {
              setEditandoNotas(false);
              if (notas.trim() !== (t.notas || '')) props.onNotas(notas.trim());
            }}
          />
        ) : (
          <Pressable onPress={() => setEditandoNotas(true)} hitSlop={4}>
            <Text style={[s.obs, !t.notas && s.obsVazia]} numberOfLines={6}>
              {t.notas || '+ observações e detalhes'}
            </Text>
          </Pressable>
        ))}

      {conversas.length > 0 && (
        <View style={s.iaLinha}>
          {conversas.map((cv) => (
            <Pressable
              key={cv.url}
              onPress={() => props.onAbrirConversa(cv)}
              onLongPress={() => props.onOcultarConversa(cv)}
              style={s.iaChip}
              accessibilityLabel={`Abrir a conversa no ${cv.ia}`}
              accessibilityHint="Toque longo tira do card"
            >
              <View style={[s.pontoP, { backgroundColor: corVisivel(IA_COR[cv.ia], c) }]} />
              <Text style={s.iaChipTxt}>{cv.ia}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {ultimo && (
        <View style={s.andamento}>
          <Icone nome="ia" size={13} cor={c.suave} />
          <Text style={s.andamentoTxt} numberOfLines={3}>
            <Text style={s.andamentoPor}>{semEmoji(ultimo.por)}</Text> · {quando(ultimo.em)} — {semEmoji(ultimo.texto)}
          </Text>
        </View>
      )}

      {feito && (t.estrelas > 0 || (t.badges ?? []).length > 0 || !!t.comentario) && (
        <View style={s.fb}>
          {t.estrelas > 0 && (
            <View style={s.fbLinha}>
              <Nota n={t.estrelas} c={c} />
              <Text style={s.metaTxt}>{ROTULO_ESTRELA[t.estrelas]}</Text>
            </View>
          )}
          {(t.badges ?? []).length > 0 && (
            <Text style={s.metaTxt}>
              {(t.badges ?? []).map((e) => badgeDe(e)?.nome ?? semEmoji(e)).filter(Boolean).join(' · ')}
            </Text>
          )}
          {!!t.comentario && <Text style={s.fbComent}>“{t.comentario}”</Text>}
        </View>
      )}

      {avaliando ? (
        <View style={s.avalBox}>
          <Text style={s.avalHint}>Como você fez esta tarefa? A avaliação vira insumo do dossiê.</Text>
          <View style={s.estrelasLinha}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setEstrelas(Math.max(piso, Math.min(n, cap)))}
                hitSlop={6}
                accessibilityLabel={estrelasTxt(n)}
                style={n > cap && s.estrelaBloq}
              >
                <Estrela cheia={n <= estrelas} size={28} cor={n <= estrelas ? c.estrela : c.suave} />
              </Pressable>
            ))}
            {estrelas >= 1 && <Text style={s.rotulo}>{ROTULO_ESTRELA[estrelas]}</Text>}
          </View>
          <Text style={s.avalCap}>{avisoNota}</Text>
          <View style={s.badgesWrap}>
            {BADGES.map((b) => {
              const ativa = sel.includes(b.e);
              const cor = b.tipo === 'pos' ? c.ok : c.urg;
              return (
                <Pressable
                  key={b.e}
                  onPress={() => alternarBadge(b.e)}
                  style={[s.badge, ativa && { backgroundColor: `${cor}22`, borderColor: cor }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ativa }}
                >
                  <View style={[s.pontoP, { backgroundColor: cor, opacity: ativa ? 1 : 0.55 }]} />
                  <Text style={[s.badgeTxt, ativa && s.badgeTxtAtiva]}>{b.nome}</Text>
                </Pressable>
              );
            })}
          </View>
          {!!textoPadrao && <Text style={s.padrao}>{textoPadrao}</Text>}
          <TextInput
            style={s.comentario}
            value={comentario}
            onChangeText={setComentario}
            multiline
            placeholder="Comentário (opcional): o que ajudou ou atrapalhou?"
            placeholderTextColor={c.suave}
          />
          <View style={s.avalAcoes}>
            <Pressable onPress={() => setAvaliando(false)} hitSlop={8}>
              <Text style={s.cancelar}>Cancelar</Text>
            </Pressable>
            <Pressable
              disabled={estrelas < 1}
              onPress={() => {
                props.onConcluir(estrelas, sel, comentario.trim());
                setAvaliando(false);
              }}
              style={[s.btnSalvar, estrelas < 1 && s.btnSalvarOff]}
            >
              <Text style={[s.btnSalvarTxt, estrelas < 1 && { color: c.suave }]}>Concluir</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={s.acoes}>
          {feito ? (
            <>
              <Pressable
                onPress={props.onReabrir}
                style={[s.check, s.checkFeito]}
                hitSlop={6}
                accessibilityLabel="Reabrir tarefa"
              >
                <Icone nome="check" size={15} cor={c.escuro ? c.bg : '#FFFFFF'} espessura={2.4} />
              </Pressable>
              <Pressable onPress={() => setAvaliando(true)} style={s.btnTexto} hitSlop={6}>
                <Text style={s.btnTextoTxt}>Reavaliar</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={props.onExcluir} style={s.btnIcone} hitSlop={6} accessibilityLabel="Excluir tarefa">
                <Icone nome="excluir" size={18} cor={c.suave} />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={props.onConcluirRapido}
                style={s.check}
                hitSlop={6}
                accessibilityLabel="Concluir sem avaliar"
              />
              <Pressable
                onPress={() => setAvaliando(true)}
                style={s.btnPrim}
                accessibilityLabel="Avaliar e concluir"
              >
                <Text style={s.btnPrimTxt}>Avaliar</Text>
              </Pressable>
              <Pressable onPress={props.onPular} style={s.btnTexto} hitSlop={4} accessibilityLabel="Pular por enquanto">
                <Text style={s.btnTextoTxt}>Pular</Text>
              </Pressable>
              <Pressable
                onPress={props.onDelegar}
                style={[s.btnTexto, s.btnIa]}
                hitSlop={4}
                accessibilityLabel="Fazer com IA"
                accessibilityHint="Abre uma conversa já com a tarefa, ou liga uma conversa que existe"
              >
                <Icone nome="ia" size={15} cor={c.suave} />
                <Text style={s.btnTextoTxt}>IA</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={props.onEditar} style={s.btnIcone} hitSlop={4} accessibilityLabel="Editar tarefa">
                <Icone nome="editar" size={18} cor={c.suave} />
              </Pressable>
              <Pressable onPress={props.onExcluir} style={s.btnIcone} hitSlop={4} accessibilityLabel="Excluir tarefa">
                <Icone nome="excluir" size={18} cor={c.suave} />
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const estilos = (c: Tema) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
      marginVertical: 5,
    },
    // Urgente: só um traço à esquerda, na cor da urgência.
    cardUrg: { borderLeftWidth: 3, borderLeftColor: c.urg, paddingLeft: 13 },
    lapide: { opacity: 0.55, paddingBottom: 12 },
    topo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    ponto: { width: 7, height: 7, borderRadius: 4 },
    area: { fontFamily: fonte.medio, fontSize: 11.5, letterSpacing: 0.3, color: c.suave },
    titulo: { fontFamily: fonte.medio, fontSize: 16, lineHeight: 22, color: c.txt, marginTop: 6 },
    tituloFeito: { textDecorationLine: 'line-through', color: c.suave },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6, flexWrap: 'wrap' },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    metaTxt: { fontFamily: fonte.texto, fontSize: 12.5, color: c.suave },
    atrasada: { color: c.urg, fontFamily: fonte.forte },
    pontoP: { width: 6, height: 6, borderRadius: 3 },
    obs: { marginTop: 10, fontFamily: fonte.texto, fontSize: 13.5, lineHeight: 20, color: c.txt },
    obsVazia: { color: c.suave },
    obsEdit: {
      marginTop: 10,
      padding: 10,
      backgroundColor: c.bg,
      borderRadius: 10,
      fontFamily: fonte.texto,
      fontSize: 13.5,
      lineHeight: 20,
      color: c.txt,
      minHeight: 72,
      textAlignVertical: 'top',
    },
    iaLinha: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    iaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: c.bg,
    },
    iaChipTxt: { fontFamily: fonte.medio, fontSize: 12, color: c.txt },
    andamento: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' },
    andamentoTxt: { flex: 1, fontFamily: fonte.texto, fontSize: 12, lineHeight: 17, color: c.suave },
    andamentoPor: { fontFamily: fonte.forte, color: c.txt },
    fb: { marginTop: 10, gap: 4 },
    fbLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fbComent: { fontFamily: fonte.texto, fontSize: 12.5, color: c.suave, fontStyle: 'italic' },
    acoes: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: c.suave,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 2,
    },
    checkFeito: { backgroundColor: c.ok, borderColor: c.ok },
    btnPrim: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: c.acentoFundo },
    btnPrimTxt: { fontFamily: fonte.forte, fontSize: 13, color: c.acento },
    btnTexto: { paddingHorizontal: 6, paddingVertical: 6 },
    btnTextoTxt: { fontFamily: fonte.medio, fontSize: 13, color: c.suave },
    btnIa: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    btnIcone: { padding: 6 },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
    linkTxt: { fontFamily: fonte.forte, fontSize: 13, color: c.acento },
    avalBox: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.linha, paddingTop: 12 },
    avalHint: { fontFamily: fonte.texto, fontSize: 12, color: c.suave, marginBottom: 8 },
    estrelasLinha: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    estrelaBloq: { opacity: 0.3 },
    rotulo: { fontFamily: fonte.medio, fontSize: 12.5, color: c.txt, marginLeft: 8 },
    avalCap: { fontFamily: fonte.texto, fontSize: 11.5, color: c.urg, minHeight: 16, marginVertical: 4 },
    badgesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: c.bg,
    },
    badgeTxt: { fontFamily: fonte.texto, fontSize: 12, color: c.txt },
    badgeTxtAtiva: { fontFamily: fonte.forte },
    padrao: { fontFamily: fonte.texto, fontSize: 12, color: c.suave, fontStyle: 'italic', marginBottom: 8 },
    comentario: {
      borderRadius: 10,
      padding: 10,
      fontFamily: fonte.texto,
      fontSize: 13.5,
      color: c.txt,
      backgroundColor: c.bg,
      minHeight: 48,
      textAlignVertical: 'top',
    },
    avalAcoes: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 18, marginTop: 10 },
    cancelar: { fontFamily: fonte.medio, color: c.suave, fontSize: 13 },
    btnSalvar: { backgroundColor: c.acento, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 9 },
    btnSalvarOff: { backgroundColor: c.linha },
    btnSalvarTxt: { fontFamily: fonte.forte, color: c.sobreAcento, fontSize: 13.5 },
  });
