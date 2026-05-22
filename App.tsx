import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, GestureResponderEvent, View } from 'react-native';
import * as Updates from 'expo-updates';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreenAPI from 'expo-splash-screen';
import {
  useFonts,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SplashScreen as InAppSplash } from './src/screens/SplashScreen';
import { useAppStore } from './src/store/useAppStore';
import {
  ensureChannel,
  ensureNotificationCategories,
  ensurePermissions,
} from './src/services/notifications';
import { scheduleAllNudges } from './src/services/nudges';
import { scheduleSleepAwarenessNotifications } from './src/services/sleepAwareness';
import { colors, activeTheme, themePreference, isNightNow } from './src/theme';

SplashScreenAPI.preventAutoHideAsync().catch(() => {});

export default function App() {
  const navigationRef = useRef<any>(null);
  const { ready, init } = useAppStore();

  const [fontsLoaded] = useFonts({
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    init().catch((e) => console.error('init failed', e));
  }, [init]);

  useEffect(() => {
    (async () => {
      const granted = await ensurePermissions();
      if (granted) {
        await ensureChannel();
        await ensureNotificationCategories();
        // Re-agenda após a permissão: numa instalação nova, init() pode rodar
        // antes de o usuário conceder a permissão, e aí nada seria entregue.
        await scheduleAllNudges().catch(() => {});
        await scheduleSleepAwarenessNotifications().catch(() => {});
      }
    })();
  }, []);

  // Tema automático: ao voltar para o app, se o pôr do sol já passou (ou o
  // dia nasceu) e o tema em uso não bate mais, recarrega para trocar.
  useEffect(() => {
    if (themePreference !== 'auto') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const want = isNightNow() ? 'dark' : 'light';
      if (want !== activeTheme) {
        Updates.reloadAsync().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (ready && fontsLoaded) {
      SplashScreenAPI.hideAsync().catch(() => {});
    }
  }, [ready, fontsLoaded]);

  if (!ready || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bg.primary }}>
          <InAppSplash />
          <StatusBar style="light" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg.primary }}>
        <RootNavigator navigationRef={navigationRef} />
        <StatusBar style="light" />
      </View>
    </SafeAreaProvider>
  );
}

// suppress unused var warnings on default RN onPress signatures
export type _ = GestureResponderEvent;
