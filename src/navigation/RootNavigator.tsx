import { useEffect } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AIChoiceScreen } from '../screens/AIChoiceScreen';
import { ModelDownloadScreen } from '../screens/ModelDownloadScreen';
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
      if (data?.type === 'sleep-reminder' && navigationRef.current) {
        navigationRef.current.navigate('Chat');
      } else if (data?.type === 'prep-reminder' && navigationRef.current) {
        navigationRef.current.navigate('Breathing');
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
