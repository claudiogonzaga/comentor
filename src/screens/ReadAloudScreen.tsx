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
import { VoicePicker } from '../components/VoicePicker';
import { VoiceProviderCard } from '../components/VoiceProviderCard';
import { GreekIcon } from '../components/GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { speakLongText, stopSpeaking, type EnrichedVoice } from '../services/voice';
import {
  createReadAloudText,
  deleteReadAloudText,
  getKV,
  listReadAloudTexts,
  setKV,
} from '../services/database';
import type { ReadAloudText } from '../types';

const RATE_OPTIONS = [0.75, 0.9, 1.0, 1.15, 1.3];

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

/**
 * Tela "Leia para mim": cola/sobe um texto grande (visualização mental,
 * auto-hipnose, oração) e a Comentora lê em voz alta — com a mesma seleção de
 * voz do chat (sistema ou Gemini), velocidade ajustável e textos salvos.
 */
export function ReadAloudScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const autostart = !!route.params?.autostart;
  const { config, setConfig } = useAppStore();
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);
  const [saved, setSaved] = useState<ReadAloudText[]>([]);
  // "Em seguida, fazer o exercício de respiração" — encadeia as atividades.
  const [thenBreathing, setThenBreathing] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const textRef = useRef('');
  const autostartedRef = useRef(false);

  const provider = config?.readAloudProvider ?? 'system';
  const rate = config?.readAloudRate ?? 1.0;

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

  // Carrega o rascunho salvo (para a sequência "respiração → leitura" funcionar
  // sem digitar de novo) e persiste ao sair.
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
      stopSpeaking();
      setKV('read_aloud_draft', textRef.current).catch(() => {});
    };
  }, [reloadSaved]);

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

  const handleSave = async () => {
    const t = text.trim();
    if (!t) return;
    const title = (t.split('\n')[0] || t).slice(0, 48).trim() || 'Sem título';
    try {
      await createReadAloudText({ title, content: text });
      await reloadSaved();
      Alert.alert('Salvo', 'O texto foi salvo na sua lista.');
    } catch {
      Alert.alert('Não consegui salvar', 'Tente novamente.');
    }
  };

  const handleLoad = (item: ReadAloudText) => {
    setText(item.content);
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

  const handlePlay = () => {
    const t = text.trim();
    if (!t) return;
    Keyboard.dismiss();
    setKV('read_aloud_draft', text).catch(() => {});
    setReading(true);
    setProgress(null);
    speakLongText(t, {
      provider,
      voiceId: config?.readAloudVoiceId ?? null,
      language: config?.readAloudVoiceLanguage ?? null,
      geminiVoiceName: config?.readAloudGeminiVoice ?? 'Aoede',
      rate,
      onProgress: (i, total) => setProgress({ i: i + 1, total }),
      onDone: () => {
        setReading(false);
        setProgress(null);
        // Encadeamento: ao terminar a leitura, vai para a respiração (que já
        // começa sozinha). Pequeno atraso para o áudio liberar.
        if (thenBreathing) {
          setTimeout(() => navigation.navigate('Breathing'), 400);
        }
      },
      onError: () => {
        setReading(false);
        setProgress(null);
        Alert.alert(
          'Não consegui ler',
          provider === 'gemini'
            ? 'A voz Gemini falhou (verifique a chave da API e a cota). Tente a voz do sistema.'
            : 'Algo deu errado ao ler o texto.',
        );
      },
    });
  };

  const handleStop = async () => {
    await stopSpeaking();
    setReading(false);
    setProgress(null);
  };

  // Início automático quando a tela é aberta encadeada (respiração → leitura).
  useEffect(() => {
    if (!autostart || autostartedRef.current || !draftLoaded || !text.trim()) return;
    autostartedRef.current = true;
    const t = setTimeout(() => handlePlay(), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, draftLoaded, text]);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            stopSpeaking();
            navigation.goBack();
          }}
        >
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Leia para mim</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          Cole ou importe um texto — visualização, oração, auto-hipnose — e a
          Comentora lê em voz alta. Use a voz do Gemini para uma leitura mais
          profissional e pausada.
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

        <View style={styles.btnRow}>
          <Button
            label="Enviar arquivo"
            variant="secondary"
            onPress={handleUpload}
            fullWidth={false}
            style={{ flex: 1 }}
          />
          <View style={{ width: spacing.sm }} />
          <Button
            label="Salvar"
            variant="secondary"
            onPress={handleSave}
            disabled={!text.trim()}
            fullWidth={false}
            style={{ flex: 1 }}
          />
        </View>

        {saved.length > 0 && (
          <View style={styles.savedWrap}>
            <Text style={styles.savedTitle}>SALVOS</Text>
            {saved.map((item) => (
              <View key={item.id} style={styles.savedRow}>
                <Pressable style={styles.savedMain} onPress={() => handleLoad(item)}>
                  <GreekIcon name="bell" size={16} color={colors.accent.gold} />
                  <Text style={styles.savedName} numberOfLines={1}>
                    {item.title}
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
        <VoiceProviderCard
          provider={provider}
          geminiVoiceName={config?.readAloudGeminiVoice ?? 'Aoede'}
          hasApiKey={!!config?.hasApiKey}
          onProviderChange={async (p) => {
            await setConfig({ readAloudProvider: p });
          }}
          onGeminiVoiceChange={async (name) => {
            await setConfig({ readAloudGeminiVoice: name });
          }}
        />

        {provider === 'system' ? (
          <>
            <VoicePicker
              title="Voz da leitura"
              value={config?.readAloudVoiceId ?? null}
              onChange={async (v: EnrichedVoice | null) => {
                await setConfig({
                  readAloudVoiceId: v?.identifier ?? null,
                  readAloudVoiceLanguage: v?.language ?? null,
                });
              }}
            />

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
          </>
        ) : (
          <Text style={styles.geminiNote}>
            A voz do Gemini lê em ritmo profissional e pausado. (O controle de
            velocidade vale para a voz do sistema.)
          </Text>
        )}

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
        {progress && (
          <Text style={styles.progress}>
            Lendo… parte {progress.i} de {progress.total}
          </Text>
        )}
        {reading ? (
          <Button label="Parar" variant="secondary" onPress={handleStop} />
        ) : (
          <Button label="▶  Leia para mim" onPress={handlePlay} disabled={!text.trim()} />
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
  btnRow: {
    flexDirection: 'row',
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
  savedMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  savedName: {
    ...typography.body,
    color: colors.text.primary,
    flex: 1,
  },
  savedDelete: {
    ...typography.small,
    color: colors.accent.danger,
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
  geminiNote: {
    ...typography.small,
    color: colors.text.tertiary,
    lineHeight: 17,
    marginBottom: spacing.lg,
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
});
