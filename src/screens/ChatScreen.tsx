import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { ChatBubble } from '../components/ChatBubble';
import { ScreenContainer } from '../components/ScreenContainer';
import { MicButton } from '../components/MicButton';
import { colors, radius, spacing, typography } from '../theme';
import {
  getCoachMessageForNow,
  markSleepDone,
  sendUserMessage,
} from '../services/coach';
import { getRecentChat } from '../services/database';
import { cancelAllReminders } from '../services/notifications';
import { speak, startListening, stopListening, stopSpeaking } from '../services/voice';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';
import { useAppStore } from '../store/useAppStore';
import type { ChatMessage, IntensityLevel, OwlMood } from '../types';

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const { config } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [habitId, setHabitId] = useState<number | null>(null);
  const [level, setLevel] = useState<IntensityLevel>(1);
  const [offline, setOffline] = useState(false);
  const [micState, setMicState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [interimText, setInterimText] = useState('');
  const [speaking, setSpeaking] = useState(false);
  // Voice output is OFF by default: the chat just shows text. The user turns
  // the speaker on (header button) when they want messages read aloud.
  const [speechEnabled, setSpeechEnabled] = useState(config?.voiceModeEnabled ?? false);

  const scrollRef = useRef<ScrollView>(null);
  const lastSpokenIdRef = useRef<number | null>(null);
  const stopListenerRef = useRef<(() => void) | null>(null);
  const finalTranscriptRef = useRef<string>('');

  const speakMessage = async (text: string) => {
    if (!speechEnabled) return;
    setSpeaking(true);
    await speak(text, {
      onDone: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const handleStopSpeaking = async () => {
    await stopSpeaking();
    setSpeaking(false);
  };

  const toggleSpeech = async () => {
    if (speechEnabled) {
      await stopSpeaking();
      setSpeaking(false);
      setSpeechEnabled(false);
    } else {
      setSpeechEnabled(true);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      setBusy(true);
      try {
        const result = await getCoachMessageForNow();
        if (!mounted) return;
        setHabitId(result.habitId);
        setLevel(result.level);
        setOffline(result.offline);
        const recent = await getRecentChat(result.habitId, 20);
        if (mounted) setMessages(recent);
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
      stopSpeaking();
      stopListening();
    };
  }, []);

  // Read the most recent Comentora message aloud — only when the user has
  // explicitly turned the speaker on.
  useEffect(() => {
    if (!speechEnabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'corujinha') return;
    if (lastSpokenIdRef.current === last.id) return;
    lastSpokenIdRef.current = last.id;
    speakMessage(last.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, speechEnabled]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  const sendTranscript = async (text: string) => {
    if (!text.trim() || !habitId) return;
    setSending(true);
    setMessages((m) => [
      ...m,
      {
        id: Date.now(),
        habitId,
        role: 'user',
        content: text,
        intensityLevel: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const result = await sendUserMessage(habitId, text, level);
      setOffline(result.offline);
      const recent = await getRecentChat(habitId, 20);
      setMessages(recent);
    } finally {
      setSending(false);
    }
  };

  const handleSendText = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    await sendTranscript(text);
  };

  const handleMicPressIn = async () => {
    if (sending || micState !== 'idle') return;
    await stopSpeaking();
    setSpeaking(false);
    setInterimText('');
    finalTranscriptRef.current = '';
    setMicState('listening');
    const stop = await startListening({
      onResult: (transcript, isFinal) => {
        setInterimText(transcript);
        if (isFinal && transcript) finalTranscriptRef.current = transcript;
      },
      onError: (code, msg) => {
        setMicState('idle');
        setInterimText('');
        if (code !== 'aborted' && code !== 'no-speech') {
          // surface to chat as a system note
          setMessages((m) => [
            ...m,
            {
              id: Date.now(),
              habitId: habitId ?? 0,
              role: 'corujinha',
              content: `(não consegui ouvir: ${msg})`,
              intensityLevel: null,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      },
      onEnd: () => {
        // handled in onPressOut
      },
    });
    stopListenerRef.current = stop;
  };

  const handleMicPressOut = async () => {
    if (micState !== 'listening') return;
    setMicState('processing');
    await stopListening();
    // wait briefly for final result event to land
    setTimeout(async () => {
      const final = finalTranscriptRef.current.trim() || interimText.trim();
      stopListenerRef.current?.();
      stopListenerRef.current = null;
      setInterimText('');
      setMicState('idle');
      if (final) {
        await sendTranscript(final);
      }
    }, 250);
  };

  const handleSleepNow = async () => {
    if (!habitId) return;
    await stopSpeaking();
    await markSleepDone(habitId);
    await cancelAllReminders();
    navigation.navigate('Home');
  };

  const handleSnooze = () => {
    if (!habitId || sending) return;
    navigation.navigate('SnoozeFeedback', { habitId, level });
  };

  // Reload messages when returning from SnoozeFeedback so the new Comentora
  // counter-argument shows up.
  useFocusEffect(
    useCallback(() => {
      if (!habitId) return;
      let cancelled = false;
      (async () => {
        const recent = await getRecentChat(habitId, 20);
        if (!cancelled) setMessages(recent);
      })();
      return () => {
        cancelled = true;
      };
    }, [habitId]),
  );

  const owlMood: OwlMood =
    micState === 'listening' ? 'celebrating'
      : speaking ? 'celebrating'
      : level >= 4 ? 'serious'
      : level >= 3 ? 'worried'
      : 'calm';

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>‹ Voltar</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Owl mood={owlMood} size={48} animated={false} />
            <View>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Comentora
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                {INTENSITY_LEVELS[level].title} · nível {level}/5
              </Text>
            </View>
          </View>
          <Pressable
            onPress={speaking ? handleStopSpeaking : toggleSpeech}
            hitSlop={12}
            style={styles.speechToggle}
          >
            <Text style={styles.muteIcon}>{speechEnabled ? '🔊' : '🔇'}</Text>
            <Text style={styles.speechToggleLabel}>
              {speaking ? 'parar' : speechEnabled ? 'voz on' : 'voz off'}
            </Text>
          </Pressable>
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
            messages.map((m, idx) => (
              <ChatBubble
                key={m.id}
                role={m.role}
                content={m.content}
                offline={idx === messages.length - 1 && offline}
              />
            ))
          )}
          {micState === 'listening' && interimText ? (
            <View style={[styles.interimWrap]}>
              <Text style={styles.interimText}>{interimText}</Text>
            </View>
          ) : null}
          {sending && (
            <View style={[styles.row, styles.rowLeft]}>
              <View style={styles.typing}>
                <ActivityIndicator color={colors.text.secondary} />
              </View>
            </View>
          )}
        </ScrollView>

        <View style={styles.actionsRow}>
          <Button
            label="Vou dormir 🌙"
            variant="primary"
            onPress={handleSleepNow}
            fullWidth={false}
            style={{ flex: 1 }}
          />
          <View style={{ width: spacing.sm }} />
          <Button
            label="+15min"
            variant="secondary"
            onPress={handleSnooze}
            fullWidth={false}
            style={{ flex: 1 }}
            loading={sending}
          />
        </View>

        <MicButton
          state={micState}
          onPressIn={handleMicPressIn}
          onPressOut={handleMicPressOut}
        />

        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Argumente comigo..."
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            multiline
            maxLength={500}
          />
          <Pressable
            onPress={handleSendText}
            disabled={!input.trim() || sending}
            style={[
              styles.sendBtn,
              (!input.trim() || sending) && { opacity: 0.4 },
            ]}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </Pressable>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    minWidth: 60,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  speechToggle: {
    minWidth: 60,
    alignItems: 'center',
  },
  muteIcon: {
    fontSize: 20,
  },
  speechToggleLabel: {
    ...typography.small,
    color: colors.text.secondary,
    fontSize: 10,
    marginTop: 1,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  row: {
    width: '100%',
    flexDirection: 'row',
    marginVertical: spacing.xs,
  },
  rowLeft: {
    justifyContent: 'flex-start',
  },
  typing: {
    backgroundColor: colors.bg.surfaceStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  interimWrap: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(244,197,83,0.18)',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  interimText: {
    ...typography.body,
    color: colors.text.primary,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
    fontSize: 22,
    color: colors.text.onGold,
    fontWeight: '700',
  },
});
