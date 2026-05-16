import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ChatBubble } from '../components/ChatBubble';
import { Button } from '../components/Button';
import { Owl } from '../components/Owl';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  addInterviewMessage,
  completeInterview,
  createInterview,
} from '../services/database';
import { ensureSleepHabit } from '../services/coach';
import {
  backendIsAvailable,
  generateInterviewQuestion,
  isInterviewEndSignal,
  stripEndMarker,
  summarizeInterview,
} from '../services/interview';
import { useAppStore } from '../store/useAppStore';
import { activateApp } from '../services/onboardingFinalize';
import type { ChatRole } from '../types';

type InterviewParams = {
  Interview: {
    mode: 'onboarding' | 'redo';
  };
};

interface LocalMsg {
  id: string;
  role: ChatRole;
  content: string;
}

export function InterviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<InterviewParams, 'Interview'>>();
  const mode = route.params?.mode ?? 'onboarding';
  const { config, refreshConfig, setConfig } = useAppStore();

  const [interviewId, setInterviewId] = useState<number | null>(null);
  const [messages, setMessages] = useState<LocalMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [readyToFinish, setReadyToFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const backendOpts = {
    aiBackend: config?.aiBackend ?? 'remote',
    geminiModel: config?.geminiModel ?? 'gemini-3.1-flash-lite',
    localModelId: config?.localModelId ?? null,
    localModelDownloaded: !!config?.localModelDownloaded,
  } as const;

  useEffect(() => {
    void initInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [messages, sending]);

  const initInterview = async () => {
    setBusy(true);
    try {
      const available = await backendIsAvailable(backendOpts);
      if (!available) {
        Alert.alert(
          'Backend não disponível',
          'Configure uma chave de API ou baixe um modelo local antes de iniciar a entrevista.',
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
        return;
      }
      const habit = await ensureSleepHabit(config?.bedtime ?? '23:00');
      const id = await createInterview(habit.id);
      setInterviewId(id);
      // Gera a primeira pergunta
      const text = await generateInterviewQuestion(backendOpts, [], null);
      const cleaned = stripEndMarker(text).trim();
      await addInterviewMessage(id, 'corujinha', cleaned);
      setMessages([{ id: `m-${Date.now()}`, role: 'corujinha', content: cleaned }]);
    } catch (err) {
      Alert.alert(
        'Erro ao iniciar entrevista',
        err instanceof Error ? err.message : 'Tente de novo daqui a pouco.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!interviewId || sending) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    setSending(true);
    try {
      await addInterviewMessage(interviewId, 'user', text);
      const userMsg: LocalMsg = { id: `m-${Date.now()}-u`, role: 'user', content: text };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);

      const history = updatedMessages.map((m) => ({ role: m.role, content: m.content }));
      const response = await generateInterviewQuestion(backendOpts, history, text);
      const endsHere = isInterviewEndSignal(response);
      const cleaned = stripEndMarker(response).trim();
      const final = cleaned || (endsHere ? 'Obrigada por compartilhar.' : '…');

      await addInterviewMessage(interviewId, 'corujinha', final);
      setMessages((prev) => [
        ...prev,
        { id: `m-${Date.now()}-c`, role: 'corujinha', content: final },
      ]);
      if (endsHere) setReadyToFinish(true);
    } catch (err) {
      Alert.alert('Erro', err instanceof Error ? err.message : 'Falha ao gerar próxima pergunta.');
    } finally {
      setSending(false);
    }
  };

  const finalize = async () => {
    if (!interviewId || finishing) return;
    setFinishing(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const summary = await summarizeInterview(backendOpts, history);
      await completeInterview(interviewId, summary);
      await setConfig({ interviewCompletedAt: new Date().toISOString() });
      await refreshConfig();
      if (mode === 'onboarding') {
        await activateApp();
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      } else {
        Alert.alert('Pronto', 'Sua entrevista foi atualizada. As próximas mensagens vão usar essas informações.');
        navigation.goBack();
      }
    } catch (err) {
      Alert.alert(
        'Erro ao finalizar',
        err instanceof Error ? err.message : 'Não consegui sumarizar a entrevista. Tente de novo.',
      );
    } finally {
      setFinishing(false);
    }
  };

  const handleSkip = () => {
    Alert.alert(
      'Pular entrevista?',
      'Você pode fazer depois em Configurações. Sem ela, as mensagens serão menos personalizadas.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Pular',
          style: 'destructive',
          onPress: async () => {
            if (mode === 'onboarding') {
              await activateApp();
              navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
            } else {
              navigation.goBack();
            }
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Pressable onPress={handleSkip}>
            <Text style={styles.skip}>Pular</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Owl mood="calm" size={36} animated={false} />
            <View>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Entrevista inicial
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                pra eu te entender melhor
              </Text>
            </View>
          </View>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
        >
          {busy && messages.length === 0 ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent.gold} />
              <Text style={[typography.small, { color: colors.text.secondary, marginTop: spacing.sm }]}>
                A Comentora está pensando…
              </Text>
            </View>
          ) : (
            messages.map((m) => (
              <ChatBubble key={m.id} role={m.role} content={m.content} />
            ))
          )}
          {sending && (
            <View style={styles.typing}>
              <ActivityIndicator color={colors.text.secondary} />
            </View>
          )}
        </ScrollView>

        {readyToFinish && (
          <View style={styles.finishBanner}>
            <Text style={[typography.small, { color: colors.text.secondary, textAlign: 'center' }]}>
              Quando estiver pronta, finalize abaixo.
            </Text>
          </View>
        )}

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="responda aqui…"
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            multiline
            editable={!sending && !finishing}
          />
          <Pressable
            onPress={sendMessage}
            disabled={!input.trim() || sending || finishing}
            style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          {readyToFinish ? (
            <Button
              label={finishing ? 'Processando…' : 'Concluir entrevista 🦉'}
              onPress={finalize}
              loading={finishing}
            />
          ) : (
            <Pressable
              onPress={finalize}
              disabled={messages.length < 4 || finishing}
              style={[
                styles.endEarlyBtn,
                (messages.length < 4 || finishing) && { opacity: 0.4 },
              ]}
            >
              <Text style={styles.endEarlyBtnText}>
                {finishing ? 'Processando…' : 'Já falei o suficiente'}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  skip: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
    minWidth: 60,
  },
  messages: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  messagesContent: {
    paddingVertical: spacing.lg,
  },
  loading: {
    paddingTop: spacing.xxl,
    alignItems: 'center',
  },
  typing: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  finishBanner: {
    backgroundColor: 'rgba(125,211,168,0.1)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {
    color: colors.text.onGold,
    fontSize: 22,
    fontWeight: '900',
  },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  endEarlyBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  endEarlyBtnText: {
    ...typography.button,
    color: colors.accent.gold,
  },
});
