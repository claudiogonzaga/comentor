// O card do Kairós, com a anatomia do painel do Graphé:
//   [🚨 urgente] [ÁREA]  ← pílula colorida no topo
//   Título
//   prazo · prioridade
//   observações (editáveis no próprio card)
//   ações: ✓ · 🎖️ Avaliar e concluir · ⏭️ Pular
// Avaliar abre a avaliação no próprio card: estrelas, badges e comentário.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BADGES, ROTULO_ESTRELA, badgeDe, ehAtrasada, ehUrgente, fmtData, limitesDaNota, type Tarefa } from './rules';
import { AREA_COR, AREA_ICONE, PRIO_COR, fixas, type Tema } from './theme';

interface Props {
  tarefa: Tarefa;
  c: Tema;
  /** Recém-concluída: fica no lugar, desbotada, com o ↩️ Desfazer. */
  lapide?: boolean;
  onConcluir: (estrelas: number, badges: string[], comentario: string) => void;
  onConcluirRapido: () => void;
  onReabrir: () => void;
  onPular: () => void;
  onNotas: (notas: string) => void;
  onEditar: () => void;
  onExcluir: () => void;
}

function estrelasStr(n: number) {
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
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

  const textoPadrao = BADGES.filter((b) => sel.includes(b.e)).map((b) => b.txt).join(' ');
  const corArea = AREA_COR[t.area] || fixas.roxo;

  if (lapide) {
    return (
      <View style={[s.card, s.lapide]}>
        <Text style={[s.titulo, s.tituloFeito]}>{t.titulo}</Text>
        <View style={s.acoes}>
          <Text style={s.metaTxt}>✓ concluída</Text>
          <Pressable onPress={props.onReabrir} style={s.btnGhost} hitSlop={6}>
            <Text style={s.desfazer}>↩️ Desfazer</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.card, urgente && { borderColor: c.urgBd }]}>
      <View style={s.topo}>
        {urgente && (
          <View style={[s.pilula, { backgroundColor: c.urgBd }]}>
            <Text style={s.pilulaTxt}>🚨 urgente</Text>
          </View>
        )}
        <View style={[s.pilula, { backgroundColor: corArea }]}>
          <Text style={s.pilulaTxt}>
            {AREA_ICONE[t.area] || ''} {t.area}
          </Text>
        </View>
      </View>

      <Text style={[s.titulo, feito && s.tituloFeito]}>{t.titulo}</Text>

      <View style={s.meta}>
        {!!t.prazo && (
          <Text style={[s.metaTxt, atrasada && s.prazoAtrasado]}>
            📅 {fmtData(t.prazo)}
            {t.hora ? ` ${t.hora}` : ''}
            {atrasada ? ' · atrasada' : ''}
          </Text>
        )}
        <View style={s.prioWrap}>
          <View style={[s.ponto, { backgroundColor: PRIO_COR[t.prioridade] || fixas.cinza }]} />
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
          <Pressable onPress={() => setEditandoNotas(true)}>
            <Text style={[s.obs, !t.notas && s.obsVazia]} numberOfLines={6}>
              {t.notas || '➕ observações e detalhes…'}
            </Text>
          </Pressable>
        ))}

      {feito && (t.estrelas > 0 || (t.badges ?? []).length > 0 || !!t.comentario) && (
        <View style={s.fb}>
          {t.estrelas > 0 && (
            <Text style={s.fbEstrelas}>
              {estrelasStr(t.estrelas)} <Text style={s.metaTxt}>{ROTULO_ESTRELA[t.estrelas]}</Text>
            </Text>
          )}
          {(t.badges ?? []).length > 0 && (
            <Text style={s.metaTxt}>
              {(t.badges ?? []).map((e) => `${e} ${badgeDe(e)?.nome ?? ''}`).join(' · ')}
            </Text>
          )}
          {!!t.comentario && <Text style={s.fbComent}>"{t.comentario}"</Text>}
        </View>
      )}

      {avaliando ? (
        <View style={s.avalBox}>
          <Text style={s.avalHint}>Como você fez esta tarefa? (vira insumo do coaching)</Text>
          <View style={s.estrelasLinha}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setEstrelas(Math.max(piso, Math.min(n, cap)))}
                hitSlop={6}
                accessibilityLabel={`${n} estrela${n > 1 ? 's' : ''}`}
              >
                <Text style={[s.estrela, n <= estrelas && { color: fixas.estrela }, n > cap && s.estrelaBloq]}>
                  {n <= estrelas ? '★' : '☆'}
                </Text>
              </Pressable>
            ))}
            {estrelas >= 1 && <Text style={s.rotulo}>{ROTULO_ESTRELA[estrelas]}</Text>}
          </View>
          <Text style={s.avalCap}>
            {cap < 5
              ? `⚠ Badge negativa: máximo ${cap}⭐`
              : piso >= 5
                ? '🏆 nota travada em 5⭐'
                : piso > 1
                  ? `não pode ser menor que ${piso}⭐`
                  : ''}
          </Text>
          <View style={s.badgesWrap}>
            {BADGES.map((b) => {
              const ativa = sel.includes(b.e);
              return (
                <Pressable
                  key={b.e}
                  onPress={() => alternarBadge(b.e)}
                  style={[s.badge, ativa && (b.tipo === 'pos' ? s.badgePos : s.badgeNeg)]}
                >
                  <Text style={[s.badgeTxt, ativa && s.badgeTxtAtiva]}>
                    {b.e} {b.nome}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!!textoPadrao && <Text style={s.padrao}>Padrão: {textoPadrao}</Text>}
          <TextInput
            style={s.comentario}
            value={comentario}
            onChangeText={setComentario}
            multiline
            placeholder="Comentário (opcional) — o que ajudou ou atrapalhou?"
            placeholderTextColor={c.suave}
          />
          <View style={s.avalAcoes}>
            <Pressable onPress={() => setAvaliando(false)} hitSlop={8}>
              <Text style={s.cancelar}>cancelar</Text>
            </Pressable>
            <Pressable
              disabled={estrelas < 1}
              onPress={() => {
                props.onConcluir(estrelas, sel, comentario.trim());
                setAvaliando(false);
              }}
              style={[s.btnSalvar, estrelas < 1 && { backgroundColor: fixas.cinza }]}
            >
              <Text style={s.btnSalvarTxt}>Salvar (concluída)</Text>
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
                accessibilityLabel="Reabrir tarefa"
              >
                <Text style={s.checkTxt}>✓</Text>
              </Pressable>
              <Pressable onPress={() => setAvaliando(true)} style={[s.btn, s.btnAval]}>
                <Text style={s.btnTxt}>🎖️ reavaliar</Text>
              </Pressable>
              <Pressable onPress={props.onExcluir} style={s.btnGhost} accessibilityLabel="Excluir tarefa">
                <Text style={s.ghostTxt}>🗑️</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={props.onConcluirRapido}
                style={s.check}
                accessibilityLabel="Concluir sem avaliar"
              />
              <Pressable onPress={() => setAvaliando(true)} style={[s.btn, s.btnAval]}>
                <Text style={s.btnTxt}>🎖️ Avaliar e concluir</Text>
              </Pressable>
              <Pressable onPress={props.onPular} style={[s.btn, s.btnPular]}>
                <Text style={s.btnTxt}>⏭️ Pular</Text>
              </Pressable>
              <Pressable onPress={props.onEditar} style={s.btnGhost} accessibilityLabel="Editar tarefa">
                <Text style={s.ghostTxt}>✏️</Text>
              </Pressable>
              <Pressable onPress={props.onExcluir} style={s.btnGhost} accessibilityLabel="Excluir tarefa">
                <Text style={s.ghostTxt}>🗑️</Text>
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
      borderWidth: 1,
      borderColor: c.linha,
      borderRadius: 12,
      padding: 12,
      marginVertical: 5,
    },
    lapide: { opacity: 0.55 },
    topo: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    pilula: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    pilulaTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
    titulo: { fontSize: 15, fontWeight: '600', color: c.txt, marginTop: 5 },
    tituloFeito: { textDecorationLine: 'line-through', color: c.suave },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' },
    metaTxt: { fontSize: 11, color: c.suave },
    prazoAtrasado: { color: fixas.vermelho, fontWeight: '700' },
    prioWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ponto: { width: 8, height: 8, borderRadius: 4 },
    obs: {
      marginTop: 8,
      padding: 8,
      backgroundColor: c.bg,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.linha,
      borderStyle: 'dashed',
      fontSize: 12.5,
      color: c.txt,
      lineHeight: 18,
    },
    obsVazia: { color: c.suave, fontStyle: 'italic' },
    obsEdit: {
      marginTop: 8,
      padding: 8,
      backgroundColor: c.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: fixas.roxo2,
      fontSize: 12.5,
      color: c.txt,
      minHeight: 72,
      textAlignVertical: 'top',
    },
    fb: { marginTop: 8, padding: 8, backgroundColor: c.bg, borderRadius: 8 },
    fbEstrelas: { color: fixas.estrela, fontSize: 15 },
    fbComent: { fontSize: 12, color: c.suave, fontStyle: 'italic', marginTop: 3 },
    acoes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
    check: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      borderColor: fixas.cinza,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkFeito: { backgroundColor: fixas.verde, borderColor: fixas.verde },
    checkTxt: { color: '#fff', fontSize: 15 },
    btn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 5 },
    btnAval: { backgroundColor: fixas.verde },
    btnPular: { backgroundColor: '#7d7387' },
    btnTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
    btnGhost: { paddingHorizontal: 6, paddingVertical: 6 },
    ghostTxt: { fontSize: 14, color: c.suave },
    desfazer: { fontSize: 12.5, color: fixas.roxo2, fontWeight: '700' },
    avalBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: c.linha, paddingTop: 8 },
    avalHint: { fontSize: 11, color: c.suave, marginBottom: 4 },
    estrelasLinha: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    estrela: { fontSize: 28, color: '#ccc' },
    estrelaBloq: { opacity: 0.32 },
    rotulo: { fontSize: 11, color: fixas.laranja, fontWeight: '700', fontStyle: 'italic', marginLeft: 8 },
    avalCap: { fontSize: 10, color: fixas.vermelho, minHeight: 13, marginVertical: 3 },
    badgesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
    badge: {
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: c.linha,
      backgroundColor: c.card,
    },
    badgePos: { backgroundColor: '#d4edda', borderColor: '#5cb85c' },
    badgeNeg: { backgroundColor: '#fde2e2', borderColor: '#e57373' },
    badgeTxt: { fontSize: 11, color: c.txt },
    badgeTxtAtiva: { color: '#1b2a1e' },
    padrao: { fontSize: 11, color: c.suave, fontStyle: 'italic', marginBottom: 6 },
    comentario: {
      borderWidth: 1,
      borderColor: c.linha,
      borderRadius: 7,
      padding: 8,
      fontSize: 13,
      color: c.txt,
      backgroundColor: c.bg,
      minHeight: 46,
      textAlignVertical: 'top',
    },
    avalAcoes: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 8 },
    cancelar: { color: c.suave, fontSize: 12 },
    btnSalvar: { backgroundColor: fixas.verde, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnSalvarTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  });
