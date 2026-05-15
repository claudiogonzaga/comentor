import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureResponderEvent, View } from 'react-native';
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
import { colors } from './src/theme';

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
      }
    })();
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
