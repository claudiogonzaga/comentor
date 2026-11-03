import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureResponderEvent, Linking, View } from 'react-native';
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
import { useShareIntent } from 'expo-share-intent';
import { RootNavigator } from './src/navigation/RootNavigator';
import { startAspis } from './src/aspis/bootstrap';
import { startKinesis } from './src/kinesis/store';
import { SplashScreen as InAppSplash } from './src/screens/SplashScreen';
import { useAppStore } from './src/store/useAppStore';
import {
  ensureChannel,
  ensureNotificationCategories,
  ensurePermissions,
} from './src/services/notifications';
import { scheduleAllNudges } from './src/services/nudges';
import { rearmSleepReminders } from './src/services/coach';
import { scheduleSleepAwarenessNotifications } from './src/services/sleepAwareness';
import { scheduleInspirationNotifications } from './src/services/inspiration';
import { rearmSpoken } from './src/services/spokenNudges';
import { captureHealthDaily } from './src/services/health';
import { colors } from './src/theme';

SplashScreenAPI.preventAutoHideAsync().catch(() => {});

export default function App() {
  const navigationRef = useRef<any>(null);
  const { ready, init } = useAppStore();
  const [navReady, setNavReady] = useState(false);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

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
        // A corrente do sono é de gatilhos DATE (poucas noites): sem re-armar
        // a cada abertura, depois da primeira noite ela nunca mais tocava.
        await rearmSleepReminders().catch(() => {});
        await scheduleSleepAwarenessNotifications().catch(() => {});
        await scheduleInspirationNotifications().catch(() => {});
        // Re-arma os alarmes falados persistidos (sobrevive a reboot via boot
        // receiver nativo; aqui é o belt-and-suspenders no launch do app).
        await rearmSpoken().catch(() => {});
        // Série histórica de saúde (health_daily) para a exportação. Sem await:
        // é telemetria, não pode segurar o boot.
        void captureHealthDaily().catch(() => {});
      }
    })();
  }, []);

  useEffect(() => {
    if (ready && fontsLoaded) {
      SplashScreenAPI.hideAsync().catch(() => {});
    }
  }, [ready, fontsLoaded]);

  // O Aspis sobe depois da Comentora: uma falha nele não pode impedir os lembretes.
  useEffect(() => {
    if (ready) void startAspis();
  }, [ready]);

  // O Kinesis também: o timer retoma de onde estava, sem segurar o boot.
  useEffect(() => {
    if (ready) void startKinesis();
  }, [ready]);

  // Tocar na notificação do timer abre a aba do Kinesis.
  useEffect(() => {
    if (!ready || !navReady) return;
    const open = (url: string | null) => {
      if (url?.startsWith('askesis://kinesis') && navigationRef.current?.isReady?.()) {
        navigationRef.current.navigate('Main', { screen: 'Kinesis' });
      }
    };
    void Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => open(e.url));
    return () => sub.remove();
  }, [ready, navReady]);

  // Compartilhar → Áskesis (YouTube, navegador): abre a análise do Aspis.
  useEffect(() => {
    if (!hasShareIntent || !ready || !fontsLoaded || !navReady) return;
    const text = shareIntent?.webUrl || shareIntent?.text || '';
    resetShareIntent();
    if (text && navigationRef.current?.isReady?.()) {
      navigationRef.current.navigate('Main', {
        screen: 'Aspis',
        params: { screen: 'Share', initial: false, params: { sharedText: text } },
      });
    }
  }, [hasShareIntent, shareIntent, ready, fontsLoaded, navReady, resetShareIntent]);

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
        <RootNavigator navigationRef={navigationRef} onNavReady={() => setNavReady(true)} />
        <StatusBar style="light" />
      </View>
    </SafeAreaProvider>
  );
}

// suppress unused var warnings on default RN onPress signatures
export type _ = GestureResponderEvent;
