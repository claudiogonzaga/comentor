import { useMemo } from 'react';
import { Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { GreekIcon } from '../components/GreekIcon';
import { HomeScreen } from '../screens/HomeScreen';
import { AspisNavigator } from '../aspis/navigation/AspisNavigator';
import { KairosScreen } from '../kairos/KairosScreen';
import { KinesisScreen } from '../kinesis/KinesisScreen';
import { LOGO_ESCUDO } from '../aspis/theme/logo';
import { colors, typography } from '../theme';

export type MainTabParamList = {
  Home: undefined;
  Aspis: { screen: 'Share'; initial: false; params: { sharedText: string } } | undefined;
  Kinesis: undefined;
  Kairos: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

/** A prancheta com o ✓, o mesmo desenho da aba no Mac (ui/img/kairos.svg). */
function KairosIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={4} y={3.5} width={16} height={17} rx={2.5} />
      <Path d="M8 9l2 2 4-4" />
      <Path d="M8 15.5h8" />
    </Svg>
  );
}

/**
 * Os quatro espaços do Áskesis: a Comentora (estimula o comportamento), o Escudo
 * (o Aspis no código: protege a atenção), o Kinesis (tira da cadeira) e o Kairós (as tarefas). Telas que
 * abrem por cima (chat, configurações, respiração…) continuam na pilha raiz e cobrem
 * a barra; as do Aspis ficam dentro da aba dele.
 */
export function MainTabs() {
  const insets = useSafeAreaInsets();
  // A barra fica em cima e já desconta a barra de status: para as telas dentro
  // das abas, não há recuo no topo (a moldura grega começa logo abaixo dela).
  const sceneInsets = useMemo(() => ({ ...insets, top: 0 }), [insets]);

  return (
    <Tab.Navigator
      backBehavior="firstRoute"
      screenLayout={({ children }) => (
        <SafeAreaInsetsContext.Provider value={sceneInsets}>{children}</SafeAreaInsetsContext.Provider>
      )}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg.primary },
        tabBarPosition: 'top',
        tabBarLabelPosition: 'beside-icon',
        tabBarActiveTintColor: colors.accent.gold,
        tabBarInactiveTintColor: colors.text.tertiary,
        // Com quatro abas, os 12 pontos que a barra deixa depois do texto cortavam o
        // "Comentora" (cerca de 108 pontos por aba no Motorola).
        tabBarLabelStyle: { ...typography.small, fontSize: 13, marginEnd: 0 },
        tabBarStyle: {
          backgroundColor: colors.bg.primary,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Comentora',
          tabBarIcon: ({ color, size }) => <GreekIcon name="owl" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Aspis"
        component={AspisNavigator}
        options={{
          title: 'Escudo',
          tabBarIcon: ({ size, focused }) => (
            <Image
              source={LOGO_ESCUDO}
              style={{ width: size, height: size, borderRadius: size / 2, opacity: focused ? 1 : 0.55 }}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Kinesis"
        component={KinesisScreen}
        options={{
          title: 'Kinesis',
          tabBarIcon: ({ size, focused }) => (
            <Image
              source={require('../../assets/kinesis/icon-mini.png')}
              style={{ width: size, height: size, borderRadius: size / 5, opacity: focused ? 1 : 0.55 }}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Kairos"
        component={KairosScreen}
        options={{
          title: 'Kairós',
          tabBarIcon: ({ color, size }) => <KairosIcon size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
