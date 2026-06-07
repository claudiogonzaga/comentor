import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { AudioScrubber } from '../components/AudioScrubber';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { useReadAloud } from '../store/useReadAloud';
import { prepareReadAloudAudio, isReadAloudCached } from '../services/voice';
import {
  createReadAloudText,
  deleteReadAloudText,
  getKV,
  listReadAloudTexts,
  setKV,
  updateReadAloudTextAudio,
} from '../services/database';
import type { ReadAloudText } from '../types';

const RATE_OPTIONS = [0.75, 0.9, 1.0, 1.15, 1.3];

/** Formata segundos como M:SS. */
function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Extrai uma mensagem legível de um erro (para mostrar o motivo real). */
function errMsg(e: unknown): string {
  const daily = !!(e as { dailyQuota?: boolean })?.dailyQuota;
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (daily || /cota di[áa]ria|daily/i.test(raw)) {
    return 'cota DIÁRIA da API esgotada (Nível 1 ≈ 100 leituras/dia no projeto). Reseta à meia-noite no horário do Pacífico (~4-5h da manhã no Brasil). Por enquanto, leio com a voz do sistema.';
  }
  if (!raw) return 'erro desconhecido';
  const low = raw.toLowerCase();
  if (low.includes('429') || low.includes('quota') || low.includes('rate')) {
    return 'limite POR MINUTO da API atingido — aguarde um pouquinho e tente de novo.';
  }
  if (low.includes('api key') || low.includes('chave') || low.includes('api_key')) {
    return 'problema com a chave da API.';
  }
  return raw;
}

/** Heurística: o conteúdo parece binário (PDF/Word/zip) e não texto puro? */
function looksBinary(s: string): boolean {
  const sample = s.slice(0, 2000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  return bad / Math.max(1, sample.length) > 0.1;
}

const PREPARING_MSG =
  'Vou preparar o áudio — pode levar alguns minutos na 1ª vez. Você pode usar o ' +
  'app normalmente e até sair desta tela; quando ficar pronto, começo a ler em ' +
  'voz alta (mesmo em outra tela). Depois fica salvo e toca na hora.';

/**
 * Barra do player (▶/⏸/⏹ + tempo + barra arrastável). Subcomponente próprio para
 * que só ELE re-renderize a cada atualização de tempo (~2x/s), não a tela toda.
 */
function PlayerBar() {
  const currentTime = useReadAloud((s) => s.currentTime);
  const duration = useReadAloud((s) => s.duration);
  const playing = useReadAloud((s) => s.status === 'playing');
  const toggle = useReadAloud((s) => s.toggle);
  const seek = useReadAloud((s) => s.seek);
  const stop = useReadAloud((s) => s.stop);
  const progress = duration > 0 ? currentTime / duration : 0;
  return (
    <View style={styles.player}>
      <View style={styles.playerControls}>
        <Pressable onPress={stop} hitSlop={8} style={styles.ctrlBtn}>
          <Text style={styles.ctrlIcon}>■</Text>
        </Pressable>
        <Pressable onPress={toggle} hitSlop={8} style={[styles.ctrlBtn, styles.ctrlMain]}>
          <Text style={styles.ctrlMainIcon}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
      </View>
      <View style={styles.playerBar}>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{fmtTime(currentTime)}</Text>
          <Text style={styles.time}>{fmtTime(duration)}</Text>
        </View>
        <AudioScrubber progress={progress} onSeek={seek} disabled={duration <= 0} />
      </View>
    </View>
  );
}

/**
 * Tela "Leia para mim": cola/sobe um texto grande (visualização, auto-hipnose,
 * oração) e a Comentora lê em voz alta. Na voz do Gemini, gera o áudio COMPLETO
 * (em background — pode sair da tela) e toca num player com ▶/⏸/⏹ + barra
 * ARRASTÁVEL. Na voz do sistema, lê direto (sem barra). A leitura roda num store
 * GLOBAL, então continua tocando em qualquer tela.
 */
export function ReadAloudScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const autostart = !!route.params?.autostart;
  const { config, setConfig } = useAppStore();
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<ReadAloudText[]>([]);
  // "Em seguida, fazer o exercício de respiração" — encadeia as atividades.
  const [thenBreathing, setThenBreathing] = useState(false);
  const [savingAudio, setSavingAudio] = useState(false);
  const [saveGen, setSaveGen] = useState<{ done: number; total: number } | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const textRef = useRef('');
  const autostartedRef = useRef(false);
  const breathingRef = useRef(thenBreathing);
  breathingRef.current = thenBreathing;

  // Estado da leitura GLOBAL (continua entre telas).
  const status = useReadAloud((s) => s.status);
  const gen = useReadAloud((s) => s.gen);
  const isGemini = useReadAloud((s) => s.isGemini);
  const raError = useReadAloud((s) => s.error);
  const finishedTick = useReadAloud((s) => s.finishedTick);

  // Voz GLOBAL do app (a mesma do chat).
  const provider = config?.voiceProvider ?? 'system';
  const geminiVoiceName = config?.geminiVoiceName ?? 'Aoede';
  const voiceId = config?.voiceId ?? null;
  const voiceLanguage = config?.voiceLanguage ?? null;
  const rate = config?.readAloudRate ?? 1.0;
  const paused = config?.readAloudPaused ?? false;

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const reloadSaved = useCallback(async () => {
    try {
      setSaved(await listReadAloudTexts());
    } catch {
      /* lista opcional */
    }
  }, []);

  // Carrega o rascunho salvo e persiste ao sair. NÃO para a leitura ao sair —
  // ela é global e deve continuar tocando em outra tela.
  useEffect(() => {
    reloadSaved();
    (async () => {
      try {
        const draft = await getKV('read_aloud_draft');
        if (draft) setText(draft);
      } catch {
        /* rascunho opcional */
      } finally {
        setDraftLoaded(true);
      }
    })();
    return () => {
      setKV('read_aloud_draft', textRef.current).catch(() => {});
    };
  }, [reloadSaved]);

  // Mudar a velocidade aplica na leitura em andamento (no-op se nada tocando).
  useEffect(() => {
    useReadAloud.getState().setRate(rate);
  }, [rate]);

  // Erro da geração/leitura → mostra e limpa (se a tela estiver aberta).
  useEffect(() => {
    if (raError) {
      Alert.alert('Leitura', raError);
      useReadAloud.getState().clearError();
    }
  }, [raError]);

  // Término NATURAL da leitura → se marcado, encadeia a respiração (só dispara
  // com a tela aberta; em outra tela, não puxa o usuário pra cá).
  const prevFinishRef = useRef(finishedTick);
  useEffect(() => {
    if (finishedTick === prevFinishRef.current) return;
    prevFinishRef.current = finishedTick;
    if (breathingRef.current) {
      // PARA a leitura antes de ir pra respiração — senão o player global
      // continuaria tocando junto com o som da respiração.
      useReadAloud.getState().stop();
      setTimeout(() => navigation.navigate('Breathing'), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedTick]);

  const handleUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const content = await FileSystem.readAsStringAsync(res.assets[0].uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (looksBinary(content)) {
        Alert.alert(
          'Arquivo não suportado',
          'Esse arquivo não parece ser texto. Por enquanto, dá pra importar arquivos de texto (.txt). PDF e Word ainda não são suportados.',
        );
        return;
      }
      setText(content);
    } catch {
      Alert.alert('Não consegui ler o arquivo', 'Tente um arquivo de texto (.txt).');
    }
  };

  // Salva o texto na lista E (na voz Gemini) já gera e guarda o áudio. DEDUP.
  const handleSave = async () => {
    const t = text.trim();
    if (!t) return;
    Keyboard.dismiss();
    setKV('read_aloud_draft', text).catch(() => {});
    const title = (t.split('\n')[0] || t).slice(0, 48).trim() || 'Sem título';
    const voice = geminiVoiceName;
    const existing = saved.find((s) => s.content.trim() === t);

    if (provider !== 'gemini') {
      if (existing) {
        Alert.alert('Já está salvo', 'Esse texto já está na sua lista.');
        return;
      }
      setSavingAudio(true);
      try {
        await createReadAloudText({ title, content: text });
        await reloadSaved();
        Alert.alert('Salvo', 'Texto salvo na sua lista.');
      } catch {
        Alert.alert('Não consegui salvar', 'Tente novamente.');
      } finally {
        setSavingAudio(false);
      }
      return;
    }

    if (existing?.audioUri && existing.audioVoice === voice) {
      Alert.alert(
        'Já está salvo',
        'Esse texto já está salvo com áudio nessa voz — não precisa gerar de novo.',
      );
      return;
    }

    setSavingAudio(true);
    let targetId: number;
    try {
      if (existing) {
        targetId = existing.id;
      } else {
        const created = await createReadAloudText({ title, content: text });
        targetId = created.id;
        await reloadSaved();
      }
    } catch {
      setSavingAudio(false);
      Alert.alert('Não consegui salvar', 'Tente novamente.');
      return;
    }

    setSaveGen({ done: 0, total: 1 });
    try {
      const uri = await prepareReadAloudAudio(t, {
        geminiVoiceName: voice,
        paused,
        onProgress: (done, total) => setSaveGen({ done, total }),
      });
      if (uri) await updateReadAloudTextAudio(targetId, uri, voice);
      await reloadSaved();
      Alert.alert(
        'Salvo',
        'Texto e áudio guardados. Ao abrir de novo, toca na hora — sem gerar de novo nem gastar tokens.',
      );
    } catch (e) {
      Alert.alert(
        'Texto salvo (áudio falhou)',
        `Salvei o texto, mas não consegui gerar o áudio Gemini: ${errMsg(e)}\n\nO áudio é gerado na 1ª leitura.`,
      );
    } finally {
      setSaveGen(null);
      setSavingAudio(false);
    }
  };

  const handleDeleteSaved = (item: ReadAloudText) => {
    Alert.alert('Excluir texto', `Remover "${item.title}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          await deleteReadAloudText(item.id);
          await reloadSaved();
        },
      },
    ]);
  };

  // Dispara a leitura de um texto (gera em background na voz Gemini).
  const startRead = (raw: string, title: string) => {
    const t = raw.trim();
    if (!t) return;
    Keyboard.dismiss();
    const ra = useReadAloud.getState();
    if (provider === 'gemini') {
      if (!isReadAloudCached(t, { geminiVoiceName, paused })) {
        Alert.alert('Preparando o áudio', PREPARING_MSG, [{ text: 'Ok' }]);
      }
      void ra.startGemini(t, title, { provider: 'gemini', geminiVoiceName, paused, rate });
    } else {
      ra.startSystem(t, title, {
        provider: 'system',
        voiceId,
        language: voiceLanguage,
        rate,
        paused,
      });
    }
  };

  const titleFor = (t: string) => (t.split('\n')[0] || t).slice(0, 40).trim() || 'Leitura';

  const handlePlay = () => {
    setKV('read_aloud_draft', text).catch(() => {});
    startRead(text, titleFor(text.trim()));
  };

  // Texto SALVO: se já tem áudio guardado, toca direto (instantâneo); senão gera.
  const handlePlaySaved = (item: ReadAloudText) => {
    setText(item.content);
    if (item.audioUri) {
      Keyboard.dismiss();
      void useReadAloud.getState().playSavedUri(item.audioUri, item.title || 'Leitura', rate);
    } else {
      startRead(item.content, item.title || titleFor(item.content.trim()));
    }
  };

  // Início automático quando a tela é aberta encadeada (respiração → leitura).
  useEffect(() => {
    if (!autostart || autostartedRef.current || !draftLoaded || !text.trim()) return;
    autostartedRef.current = true;
    const t = setTimeout(() => handlePlay(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, draftLoaded, text]);

  const busy = status === 'generating' || status === 'playing' || status === 'paused';
  const showPlayer = (status === 'playing' || status === 'paused') && isGemini;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Leia para mim</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Cole ou importe um texto — visualização, oração, auto-hipnose — e a
          Comentora lê em voz alta. Na voz do Gemini, dá pra arrastar a barrinha
          para voltar/avançar, e você pode sair da tela enquanto o áudio é gerado.
        </Text>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Cole ou escreva aqui o texto que você quer ouvir…"
          placeholderTextColor={colors.text.tertiary}
          style={styles.input}
          multiline
          textAlignVertical="top"
          maxLength={20000}
        />
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{text.trim().length} caracteres</Text>
          {text.length > 0 && (
            <Pressable onPress={() => setText('')} hitSlop={8}>
              <Text style={styles.clear}>Limpar</Text>
            </Pressable>
          )}
        </View>

        <Button label="Enviar arquivo" variant="secondary" onPress={handleUpload} />
        <View style={{ height: spacing.sm }} />
        <Button
          label={
            savingAudio
              ? saveGen
                ? `Gerando ${saveGen.done}/${saveGen.total}…`
                : 'Salvando…'
              : 'Salvar e gerar áudio'
          }
          variant="secondary"
          onPress={handleSave}
          loading={savingAudio}
          disabled={!text.trim() || savingAudio}
        />
        <Text style={styles.uploadHint}>
          No seletor do Android você pode escolher um arquivo do aparelho ou do
          Google Drive (toque no menu ☰ → Drive). Por enquanto, arquivos de
          texto (.txt).
        </Text>

        {saved.length > 0 && (
          <View style={styles.savedWrap}>
            <Text style={styles.savedTitle}>SALVOS</Text>
            {saved.map((item) => (
              <View key={item.id} style={styles.savedRow}>
                <Pressable
                  style={styles.savedPlay}
                  onPress={() => handlePlaySaved(item)}
                  hitSlop={6}
                >
                  <Text style={styles.savedPlayIcon}>▶</Text>
                </Pressable>
                <Pressable style={styles.savedMain} onPress={() => handlePlaySaved(item)}>
                  <Text style={styles.savedName} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.savedSub} numberOfLines={1}>
                    {item.audioUri
                      ? 'áudio salvo · toque para ouvir'
                      : 'toque para ouvir (gera na 1ª vez)'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => handleDeleteSaved(item)} hitSlop={8}>
                  <Text style={styles.savedDelete}>Excluir</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: spacing.lg }} />

        {/* Voz: usa a voz GLOBAL do app; atalho para trocar em "Sons e Vozes". */}
        <Pressable style={styles.voiceShortcut} onPress={() => navigation.navigate('SonsVozes')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.voiceShortcutLabel}>VOZ DA LEITURA</Text>
            <Text style={styles.voiceShortcutValue}>
              {provider === 'gemini'
                ? `Gemini · ${geminiVoiceName}`
                : 'Voz do sistema (Android)'}
            </Text>
            <Text style={styles.voiceShortcutHint}>
              É a voz geral do app. Toque para trocar em “Sons e Vozes”.
            </Text>
          </View>
          <Text style={styles.voiceShortcutArrow}>›</Text>
        </Pressable>

        {/* Velocidade — sempre (sistema e Gemini) */}
        <Text style={styles.speedLabel}>Velocidade da leitura</Text>
        <View style={styles.speedRow}>
          {RATE_OPTIONS.map((r) => {
            const on = Math.abs(r - rate) < 0.01;
            return (
              <Pressable
                key={r}
                onPress={() => setConfig({ readAloudRate: r })}
                style={[styles.speedChip, on && styles.speedChipOn]}
              >
                <Text style={[styles.speedText, on && styles.speedTextOn]}>
                  {`${r}x`.replace('.', ',')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Leitura pausada (visualização / auto-hipnose) */}
        <View style={styles.chainRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.chainTitle}>Leitura pausada</Text>
            <Text style={styles.chainSub}>
              Insere uma pausa entre as frases — bom para visualização mental e
              auto-hipnose.
            </Text>
          </View>
          <Switch
            value={paused}
            onValueChange={(v) => setConfig({ readAloudPaused: v })}
            trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
            thumbColor={paused ? colors.text.onGold : colors.text.tertiary}
          />
        </View>

        <View style={styles.chainRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.chainTitle}>Em seguida, respiração</Text>
            <Text style={styles.chainSub}>
              Ao terminar a leitura, vai direto para o exercício de respiração.
            </Text>
          </View>
          <Switch
            value={thenBreathing}
            onValueChange={setThenBreathing}
            trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
            thumbColor={thenBreathing ? colors.text.onGold : colors.text.tertiary}
          />
        </View>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        {status === 'generating' ? (
          <>
            <Text style={styles.progress}>
              {gen
                ? `Preparando o áudio… ${gen.done}/${gen.total} · pode sair desta tela; começo a ler quando ficar pronto`
                : 'Preparando a leitura…'}
            </Text>
            <Button label="Parar" variant="secondary" onPress={() => useReadAloud.getState().stop()} />
          </>
        ) : showPlayer ? (
          <PlayerBar />
        ) : busy ? (
          // Leitura pela voz do sistema (sem barra)
          <Button label="Parar" variant="secondary" onPress={() => useReadAloud.getState().stop()} />
        ) : (
          <Button
            label="▶  Leia para mim"
            onPress={handlePlay}
            disabled={!text.trim() || savingAudio}
          />
        )}
      </View>
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
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    minWidth: 60,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  intro: {
    ...typography.small,
    color: colors.text.secondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  input: {
    ...typography.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 160,
    maxHeight: 300,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  meta: {
    ...typography.small,
    color: colors.text.tertiary,
  },
  clear: {
    ...typography.small,
    color: colors.accent.gold,
  },
  uploadHint: {
    ...typography.small,
    color: colors.text.tertiary,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  savedWrap: {
    marginTop: spacing.lg,
  },
  savedTitle: {
    ...typography.label,
    color: colors.accent.gold,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  savedPlay: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  savedPlayIcon: {
    color: colors.accent.gold,
    fontSize: 14,
  },
  savedMain: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  savedName: {
    ...typography.body,
    color: colors.text.primary,
  },
  savedSub: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  savedDelete: {
    ...typography.small,
    color: colors.accent.danger,
  },
  voiceShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  voiceShortcutLabel: {
    ...typography.label,
    color: colors.accent.gold,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  voiceShortcutValue: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  voiceShortcutHint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: 2,
    lineHeight: 16,
  },
  voiceShortcutArrow: {
    ...typography.subtitle,
    color: colors.accent.gold,
    marginLeft: spacing.md,
  },
  speedLabel: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  speedChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  speedChipOn: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.12)',
  },
  speedText: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
  speedTextOn: {
    color: colors.accent.gold,
    fontWeight: '700',
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chainTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  chainSub: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
    lineHeight: 17,
  },
  bottomBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg.primary,
  },
  progress: {
    ...typography.small,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  ctrlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  ctrlIcon: {
    color: colors.text.secondary,
    fontSize: 16,
  },
  ctrlMain: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.12)',
  },
  ctrlMainIcon: {
    color: colors.accent.gold,
    fontSize: 18,
    fontWeight: '700',
  },
  playerBar: {
    flex: 1,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    ...typography.small,
    color: colors.text.tertiary,
    fontVariant: ['tabular-nums'],
  },
});
