// "Explorar & Verificar" — sobre UM vídeo. Duas formas de perguntar:
//  (1) caixa de Q&A presa à transcrição/vídeo (ask);
//  (2) botão de CHECAGEM EXTERNA, que usa busca na web (grounding) para
//      corroborar/desmentir as afirmações do vídeo e aprofundar o tema.
// Cada resposta (de qualquer um dos dois) pode virar nota no Obsidian/Drive
// ou flashcards. Tudo fica salvo por vídeo.
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  ask,
  factCheck,
  GeminiError,
  makeFlashcards,
  NoGeminiKeyError,
} from '../services/brain';
import * as db from '../services/db';
import { useAppStore } from '../store/useAppStore';
import type { Fato, QAItem, VideoRecord } from '../types';
import { colors, radius, spacing, typography } from '../theme';

interface Props {
  video: VideoRecord;
  onNeedSettings?: () => void;
  /** Regrava a nota do Drive com o estado fresco (fatos + qa salvos). */
  onPersistNote?: () => Promise<{ updated: boolean }>;
  /** Avisa o pai que o vídeo mudou (ex.: novos flashcards). */
  onChanged?: () => void;
}

type Busy = { id: number; kind: 'note' | 'cards' } | null;

function fatoKey(f: Fato): string {
  return f.tipo === 'cloze' ? `c:${f.texto}` : `b:${f.frente}`;
}

export function QASection({ video, onNeedSettings, onPersistNote, onChanged }: Props) {
  const { geminiKey, model } = useAppStore();
  const [items, setItems] = useState<QAItem[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const opts = { apiKey: geminiKey, model };
  const refresh = () => setItems(db.getQa(video.video_id));

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.video_id]);

  const handleError = (e: unknown) => {
    const isKey =
      e instanceof NoGeminiKeyError || (e instanceof GeminiError && e.isKeyError);
    setKeyError(isKey);
    setError(e instanceof Error ? e.message : String(e));
  };

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setKeyError(false);
    try {
      const answer = await ask(video, q, items, opts);
      db.addQa(video.video_id, q, answer, 'ask');
      refresh();
      setQuestion('');
    } catch (e) {
      handleError(e);
    } finally {
      setAsking(false);
    }
  };

  const handleFactCheck = async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    setKeyError(false);
    try {
      const { answer, sources } = await factCheck(video, opts);
      db.addQa(video.video_id, 'Checagem das informações do vídeo', answer, 'factcheck', sources);
      refresh();
    } catch (e) {
      handleError(e);
    } finally {
      setChecking(false);
    }
  };

  // Marca a resposta para entrar na nota e regrava o arquivo no Drive.
  const handleSaveItem = async (item: QAItem) => {
    if (busy || !onPersistNote) return;
    setBusy({ id: item.id, kind: 'note' });
    setToast(null);
    db.markQaSaved(item.id, 1);
    try {
      await onPersistNote();
      refresh();
      setToast({ kind: 'ok', text: '✓ Incluído na nota do Drive/Aspis.' });
    } catch (e) {
      db.markQaSaved(item.id, 0); // desfaz se não gravou
      setToast({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  // Gera flashcards a partir da resposta e os mescla aos fatos do vídeo.
  const handleMakeCards = async (item: QAItem) => {
    if (busy) return;
    setBusy({ id: item.id, kind: 'cards' });
    setToast(null);
    try {
      const cards = await makeFlashcards(item.answer, opts);
      if (!cards.length) {
        setToast({ kind: 'err', text: 'Nada memorizável encontrado nessa resposta.' });
        return;
      }
      const fresh = db.getVideo(video.video_id) ?? video;
      const existing = fresh.fatos ?? [];
      const seen = new Set(existing.map(fatoKey));
      const merged = [...existing];
      for (const c of cards) {
        if (!seen.has(fatoKey(c))) {
          seen.add(fatoKey(c));
          merged.push(c);
        }
      }
      const added = merged.length - existing.length;
      db.setFatos(video.video_id, merged);
      onChanged?.();
      let suffix = '';
      if (fresh.saved_drive === 1 && onPersistNote) {
        await onPersistNote();
        suffix = ' · nota atualizada';
      }
      setToast({
        kind: 'ok',
        text: added > 0 ? `✓ +${added} flashcard(s)${suffix}` : 'Esses cartões já existiam.',
      });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Explorar & verificar</Text>

      {items.map((qa) => {
        const isCheck = qa.kind === 'factcheck';
        const itemBusy = busy?.id === qa.id;
        return (
          <View key={qa.id} style={styles.qa}>
            <Text style={[styles.q, isCheck && styles.qCheck]}>
              {isCheck ? '🔎 ' : '▸ '}
              {qa.question}
            </Text>
            <View style={[styles.aWrap, isCheck && styles.aWrapCheck]}>
              <Text style={styles.a}>{qa.answer}</Text>
              {qa.sources.length > 0 && (
                <View style={styles.sources}>
                  <Text style={styles.sourcesLabel}>Fontes</Text>
                  {qa.sources.map((s, i) => (
                    <Pressable key={i} onPress={() => Linking.openURL(s.uri)}>
                      <Text style={styles.sourceLink} numberOfLines={1}>
                        • {s.title}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={styles.itemActions}>
                <Pressable
                  onPress={() => handleSaveItem(qa)}
                  disabled={itemBusy || qa.saved_note === 1}
                  style={({ pressed }) => [
                    styles.miniBtn,
                    (itemBusy || qa.saved_note === 1) && { opacity: 0.55 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  {busy?.id === qa.id && busy.kind === 'note' ? (
                    <ActivityIndicator size="small" color={colors.text.primary} />
                  ) : (
                    <Text style={styles.miniLabel}>
                      {qa.saved_note === 1 ? '✓ na nota' : 'Salvar na nota'}
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => handleMakeCards(qa)}
                  disabled={itemBusy}
                  style={({ pressed }) => [
                    styles.miniBtn,
                    itemBusy && { opacity: 0.55 },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  {busy?.id === qa.id && busy.kind === 'cards' ? (
                    <ActivityIndicator size="small" color={colors.text.primary} />
                  ) : (
                    <Text style={styles.miniLabel}>Gerar flashcards</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}

      {asking && (
        <View style={styles.qa}>
          <Text style={styles.q}>▸ {question.trim()}</Text>
          <View style={styles.aWrap}>
            <Text style={[styles.a, styles.thinking]}>Consultando a transcrição…</Text>
          </View>
        </View>
      )}

      {checking && (
        <View style={styles.qa}>
          <Text style={[styles.q, styles.qCheck]}>🔎 Checagem das informações do vídeo</Text>
          <View style={[styles.aWrap, styles.aWrapCheck]}>
            <Text style={[styles.a, styles.thinking]}>Pesquisando na web e cruzando evidências…</Text>
          </View>
        </View>
      )}

      {toast && (
        <Text style={[styles.toast, toast.kind === 'ok' ? styles.toastOk : styles.toastErr]}>
          {toast.text}
        </Text>
      )}

      {error && (
        <View>
          <Text style={styles.err}>{error}</Text>
          {keyError && onNeedSettings && (
            <Pressable onPress={onNeedSettings}>
              <Text style={styles.errLink}>Abrir Configurações →</Text>
            </Pressable>
          )}
        </View>
      )}

      <Pressable
        onPress={handleFactCheck}
        disabled={checking}
        style={({ pressed }) => [
          styles.checkBtn,
          checking && { opacity: 0.6 },
          pressed && { opacity: 0.85 },
        ]}
      >
        {checking ? (
          <ActivityIndicator size="small" color={colors.text.onGold} />
        ) : (
          <Text style={styles.checkLabel}>🔎 Checar na web & aprofundar</Text>
        )}
      </Pressable>
      <Text style={styles.hint}>
        Busca evidências externas que confirmam ou desmentem o vídeo e amplia o tema.
      </Text>

      <View style={styles.askRow}>
        <TextInput
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          placeholder="Pergunte algo sobre o vídeo…"
          placeholderTextColor={colors.text.tertiary}
          editable={!asking}
          onSubmitEditing={handleAsk}
          returnKeyType="send"
        />
        <Pressable
          onPress={handleAsk}
          disabled={asking || !question.trim()}
          style={({ pressed }) => [
            styles.askBtn,
            (asking || !question.trim()) && { opacity: 0.5 },
            pressed && { opacity: 0.8 },
          ]}
        >
          {asking ? (
            <ActivityIndicator size="small" color={colors.text.onGold} />
          ) : (
            <Text style={styles.askLabel}>Perguntar</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.hint}>
        A pergunta responde pela transcrição. Perguntas e checagens ficam salvas aqui.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  title: {
    ...typography.small,
    fontFamily: 'Inter_600SemiBold',
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  qa: { marginBottom: spacing.md },
  q: {
    ...typography.small,
    fontFamily: 'Inter_600SemiBold',
    color: colors.text.primary,
    marginBottom: 4,
  },
  qCheck: { color: colors.accent.lavender },
  aWrap: {
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
  },
  aWrapCheck: { borderLeftColor: colors.accent.lavender },
  a: { ...typography.small, color: colors.text.secondary, lineHeight: 19 },
  thinking: { fontStyle: 'italic', color: colors.text.tertiary },
  sources: { marginTop: spacing.sm, gap: 2 },
  sourcesLabel: { ...typography.label, color: colors.text.tertiary },
  sourceLink: { ...typography.small, fontSize: 12, color: colors.accent.lavender },
  itemActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  miniBtn: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 28,
    justifyContent: 'center',
  },
  miniLabel: {
    ...typography.label,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.text.primary,
  },
  toast: { ...typography.small, marginBottom: spacing.sm },
  toastOk: { color: colors.accent.success },
  toastErr: { color: colors.accent.danger },
  err: { ...typography.small, color: colors.accent.danger, marginBottom: 4 },
  errLink: { ...typography.small, color: colors.accent.gold, marginBottom: spacing.sm },
  checkBtn: {
    backgroundColor: colors.accent.lavender,
    borderRadius: radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  checkLabel: {
    ...typography.small,
    fontFamily: 'Inter_600SemiBold',
    color: colors.text.onGold,
  },
  askRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.md },
  input: {
    flex: 1,
    ...typography.small,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
  },
  askBtn: {
    backgroundColor: colors.accent.gold,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    minWidth: 92,
    alignItems: 'center',
  },
  askLabel: {
    ...typography.small,
    fontFamily: 'Inter_600SemiBold',
    color: colors.text.onGold,
  },
  hint: {
    ...typography.label,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
    textTransform: 'none',
    letterSpacing: 0,
  },
});
