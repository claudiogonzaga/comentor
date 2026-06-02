import { useEffect, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { VoicePicker } from '../components/VoicePicker';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { speakLongText, stopSpeaking, type EnrichedVoice } from '../services/voice';

/**
 * Tela "Leia para mim": a pessoa cola um texto grande (visualização mental,
 * auto-hipnose, oração…) e a Comentora lê em voz alta usando uma voz do
 * Android escolhida — independente da voz do chat. Textos longos são lidos em
 * pedaços, em sequência.
 */
export function ReadAloudScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ i: number; total: number } | null>(null);

  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const handleRead = () => {
    const t = text.trim();
    if (!t) return;
    Keyboard.dismiss();
    setReading(true);
    setProgress(null);
    speakLongText(t, {
      voiceId: config?.readAloudVoiceId ?? null,
      language: config?.readAloudVoiceLanguage ?? null,
      onProgress: (i, total) => setProgress({ i: i + 1, total }),
      onDone: () => {
        setReading(false);
        setProgress(null);
      },
      onError: () => {
        setReading(false);
        setProgress(null);
      },
    });
  };

  const handleStop = async () => {
    await stopSpeaking();
    setReading(false);
    setProgress(null);
  };

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

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Cole um texto — uma visualização mental, uma oração, um roteiro de
          auto-hipnose — e a Comentora lê em voz alta na voz que você escolher.
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
          <Button label="Leia para mim" onPress={handleRead} disabled={!text.trim()} />
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
    minHeight: 180,
    maxHeight: 320,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  meta: {
    ...typography.small,
    color: colors.text.tertiary,
  },
  clear: {
    ...typography.small,
    color: colors.accent.gold,
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
