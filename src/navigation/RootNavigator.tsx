import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AIChoiceScreen } from '../screens/AIChoiceScreen';
import { ModelDownloadScreen } from '../screens/ModelDownloadScreen';
import { InterviewScreen } from '../screens/InterviewScreen';
import { SnoozeFeedbackScreen } from '../screens/SnoozeFeedbackScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { BreathingScreen } from '../screens/BreathingScreen';
import { ReadAloudScreen } from '../screens/ReadAloudScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { SoundsVoiceScreen } from '../screens/SoundsVoiceScreen';
import type { IntensityLevel, LocalModelId } from '../types';
import { useAppStore } from '../store/useAppStore';
import {
  SLEEP_NOW_ACTION,
  SNOOZE_ACTION,
  NUDGE_DONE_ACTION,
  NUDGE_SNOOZE_ACTION,
  MED_DONE_ACTION,
  MED_SNOOZE_ACTION,
  cancelSleepEscalationReminders,
} from '../services/notifications';
import { confirmNudge, snoozeNudge } from '../services/nudges';
import { confirmMedication, snoozeMedication } from '../services/medications';
import { saveLastNotification } from '../services/lastNotification';
import { isHeadphonesConnected, isSpokenQuietNow } from '../services/spokenNudges';
import { markSleepDone } from '../services/coach';
import { isSpeaking, speak } from '../services/voice';
import { colors } from '../theme';

export type RootStackParamList = {
  Onboarding: undefined;
  AIChoice: undefined;
  ModelDownload: { modelId: LocalModelId; fromOnboarding?: boolean };
  Interview: { mode: 'onboarding' | 'redo' };
  SnoozeFeedback: { habitId: number; level: 1 | 2 | 3 | 4 | 5 };
  Main: undefined;
  Home: undefined;
  Chat: { mode?: 'convince' } | undefined;
  Settings: undefined;
  History: undefined;
  Breathing: undefined;
  ReadAloud: { autostart?: boolean } | undefined;
  Reminders: undefined;
  SonsVozes: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: 'transparent',
    card: colors.bg.primary,
    primary: colors.accent.gold,
    text: colors.text.primary,
    border: colors.border,
    notification: colors.accent.gold,
  },
};

export function RootNavigator({ navigationRef }: { navigationRef: any }) {
  const { config } = useAppStore();
  const onboarded = config?.onboardingDone ?? false;

  // A notification tapped while the app was killed fires its response before
  // the navigator mounts. We stash it here and flush it once navigation is
  // ready, instead of dropping it (the old bug: the app opened but never
  // navigated, so taps and the snooze button "did nothing").
  const navReadyRef = useRef(false);
  const pendingResponseRef = useRef<Notifications.NotificationResponse | null>(null);
  const flushRef = useRef<(() => void) | null>(null);
  // A notification that launches the app is delivered both by
  // getLastNotificationResponseAsync() and the live listener — dedup so the
  // action (e.g. marking sleep done) doesn't run twice.
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const routeResponse = async (response: Notifications.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as {
        type?: string;
        habitId?: number;
        level?: number;
        nudgeType?: string;
        medId?: number;
      };
      const type = data.type ?? '';
      const action = response.actionIdentifier;
      const nav = navigationRef.current;
      if (!nav) return;

      if (type === 'sleep-reminder') {
        if (action === SLEEP_NOW_ACTION) {
          // "Vou dormir" button: mark done, stop the escalation chain, go home.
          if (typeof data.habitId === 'number') {
            try {
              await markSleepDone(data.habitId);
            } catch {
              /* still navigate even if logging fails */
            }
          }
          // Encerra só a corrente do sono — mantém inspiração/nudges vivos.
          await cancelSleepEscalationReminders();
          nav.navigate('Home');
          return;
        }
        if (action === SNOOZE_ACTION) {
          // "Adiar 15 min" button: open the snooze flow (asks the reason,
          // generates the counter-argument, reschedules).
          if (typeof data.habitId === 'number') {
            nav.navigate('SnoozeFeedback', {
              habitId: data.habitId,
              level: (data.level ?? 1) as IntensityLevel,
            });
          } else {
            nav.navigate('Chat');
          }
          return;
        }
        // Tap on the notification body.
        nav.navigate('Chat');
      } else if (type === 'prep-reminder' || type === 'nudge:breathing') {
        nav.navigate('Breathing');
      } else if (type.startsWith('nudge:') || type === 'awareness') {
        // Verify-behavior nudges (óculos de luz azul) carry the
        // "Já fiz ✅" / "Lembrar depois" buttons. Resolve the action, then go
        // Home so the user lands somewhere sensible.
        if (action === NUDGE_DONE_ACTION && data.nudgeType) {
          try {
            await confirmNudge(data.nudgeType);
          } catch {
            /* still navigate even if it fails */
          }
        } else if (action === NUDGE_SNOOZE_ACTION && data.nudgeType) {
          try {
            await snoozeNudge(data.nudgeType);
          } catch {
            /* still navigate even if it fails */
          }
        }
        nav.navigate('Home');
      } else if (type.startsWith('med:')) {
        // Lembretes de remédio/hábito trazem "Já tomei 💊" / "Lembrar depois".
        // Resolve a ação e vai para a HOME (lista de TODOs/hábitos), NÃO para a
        // tela de gerenciar/editar lembretes — tocar em "Já fiz" e cair na tela
        // de edição era confuso (o usuário tinha que voltar pra ver o item feito).
        if (action === MED_DONE_ACTION && typeof data.medId === 'number') {
          try {
            await confirmMedication(data.medId);
          } catch {
            /* still navigate even if it fails */
          }
        } else if (action === MED_SNOOZE_ACTION && typeof data.medId === 'number') {
          try {
            await snoozeMedication(data.medId);
          } catch {
            /* still navigate even if it fails */
          }
        }
        nav.navigate('Home');
      }
    };

    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const key = [
        response.notification.request.identifier,
        response.actionIdentifier,
        response.notification.date,
      ].join('|');
      if (processedRef.current.has(key)) return;
      processedRef.current.add(key);
      if (navReadyRef.current && navigationRef.current) {
        void routeResponse(response);
      } else {
        pendingResponseRef.current = response;
      }
    };

    // Cold start: a notification may have launched the app.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        handle(response);
        // Clear it so a later normal cold start doesn't replay it.
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {});

    // Warm: app already running when the user taps.
    const sub = Notifications.addNotificationResponseReceivedListener(handle);

    // Voice nudges (foreground only): when an owl notification arrives while
    // the app is open and "falar nudges" is on, read it aloud via TTS. A
    // killed/background app can't run JS at fire time, so this is the honest,
    // reliable subset — speaking when the user actually has the app open.
    const speakIfEnabled = async (notification: Notifications.Notification) => {
      try {
        if (AppState.currentState !== 'active') return;
        const cfg = useAppStore.getState().config;
        if (!cfg?.voiceNudgesEnabled) return;
        // "Só falar com fone de ouvido": vale para TODAS as falas/avisos — não só
        // os alarmes em background, mas TAMBÉM esta fala em primeiro plano. Sem
        // fone conectado, NÃO fala (evita constrangimento em reunião/audiência).
        if (cfg?.spokenHeadphonesOnly && !isHeadphonesConnected()) return;
        // Horário silencioso (janela + dias sem voz) — não fala em primeiro plano.
        if (isSpokenQuietNow(cfg)) return;
        // Don't talk over the owl's own voice (chat reading / preview).
        if (isSpeaking()) return;
        const d = (notification.request.content.data ?? {}) as { type?: string };
        const t = d.type ?? '';
        const speakable =
          t.startsWith('nudge:') ||
          t.startsWith('med:') ||
          t === 'awareness' ||
          t === 'sleep-reminder';
        if (!speakable) return;
        const title = notification.request.content.title ?? '';
        const body = notification.request.content.body ?? '';
        // Strip emojis/decoration so the TTS doesn't read "owl face" etc.
        const text = [title, body]
          .filter(Boolean)
          .join('. ')
          .replace(/[^\p{L}\p{N}\p{P}\p{Z}\n]/gu, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) return;
        await speak(text);
      } catch {
        /* speaking is best-effort */
      }
    };
    const receivedSub = Notifications.addNotificationReceivedListener((n) => {
      // #2 — guarda a última notificação exibida para a Home espelhar o card.
      void saveLastNotification(n);
      void speakIfEnabled(n);
    });

    // Runs whatever notification response arrived before navigation was ready.
    const flush = () => {
      navReadyRef.current = true;
      const pending = pendingResponseRef.current;
      if (pending) {
        pendingResponseRef.current = null;
        void routeResponse(pending);
      }
    };
    flushRef.current = flush;
    // Guard against onReady having already fired before this effect ran.
    if (navigationRef.current?.isReady?.()) flush();

    return () => {
      sub.remove();
      receivedSub.remove();
    };
  }, [navigationRef]);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={() => {
        flushRef.current?.();
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg.primary },
          animation: 'fade',
        }}
        initialRouteName={onboarded ? 'Main' : 'Onboarding'}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="AIChoice" component={AIChoiceScreen} />
        <Stack.Screen name="ModelDownload" component={ModelDownloadScreen} />
        <Stack.Screen name="Interview" component={InterviewScreen} />
        <Stack.Screen
          name="SnoozeFeedback"
          component={SnoozeFeedbackScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="Main" component={HomeScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Breathing" component={BreathingScreen} options={{ animation: 'fade' }} />
        <Stack.Screen
          name="ReadAloud"
          component={ReadAloudScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="Reminders"
          component={RemindersScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="SonsVozes"
          component={SoundsVoiceScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
