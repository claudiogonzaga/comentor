import { useEffect } from 'react';
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
import type { LocalModelId } from '../types';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme';

export type RootStackParamList = {
  Onboarding: undefined;
  AIChoice: undefined;
  ModelDownload: { modelId: LocalModelId; fromOnboarding?: boolean };
  Interview: { mode: 'onboarding' | 'redo' };
  SnoozeFeedback: { habitId: number; level: 1 | 2 | 3 | 4 | 5 };
  Main: undefined;
  Home: undefined;
  Chat: undefined;
  Settings: undefined;
  History: undefined;
  Breathing: undefined;
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

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string };
      const type = data?.type ?? '';
      if (!navigationRef.current) return;
      if (type === 'sleep-reminder') {
        navigationRef.current.navigate('Chat');
      } else if (type === 'prep-reminder' || type === 'nudge:breathing') {
        navigationRef.current.navigate('Breathing');
      } else if (type === 'nudge:supplements' || type === 'nudge:bluelight') {
        // Info nudges — just dismiss to Home for context.
        navigationRef.current.navigate('Home');
      }
    });
    return () => sub.remove();
  }, [navigationRef]);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
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
      </Stack.Navigator>
    </NavigationContainer>
  );
}
