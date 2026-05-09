import { useEffect, useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { ChatBubble } from '../components/ChatBubble';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  getCoachMessageForNow,
  markSleepDone,
  sendUserMessage,
} from '../services/coach';
import { getRecentChat } from '../services/database';
import { cancelAllReminders, snoozeFor } from '../services/notifications';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';
import type { ChatMessage, IntensityLevel, OwlMood } from '../types';

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [habitId, setHabitId] = useState<number | null>(null);
  const [level, setLevel] = useState<IntensityLevel>(1);
  const [offline, setOffline] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

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
    };
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !habitId || sending) return;
    setSending(true);
    setInput('');
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

  const handleSleepNow = async () => {
    if (!habitId) return;
    await markSleepDone(habitId);
    await cancelAllReminders();
    navigation.navigate('Home');
  };

  const handleSnooze = async () => {
    if (!habitId) return;
    await snoozeFor(15, level, habitId);
    navigation.navigate('Home');
  };

  const owlMood: OwlMood =
    level >= 4 ? 'serious' : level >= 3 ? 'worried' : 'calm';

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>‹ Voltar</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Owl mood={owlMood} size={48} animated={false} />
            <View>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Corujinha
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                {INTENSITY_LEVELS[level].title} · nível {level}/5
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
                A Corujinha está pensando…
              </Text>
            </View>
          ) : (
            messages.map((m) => (
              <ChatBubble
                key={m.id}
                role={m.role}
                content={m.content}
                offline={m === messages[messages.length - 1] && offline}
              />
            ))
          )}
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
          />
        </View>

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
            onPress={handleSend}
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
