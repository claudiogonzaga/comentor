import { Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { GreekIcon } from '../components/GreekIcon';
import { HomeScreen } from '../screens/HomeScreen';
import { AspisNavigator } from '../aspis/navigation/AspisNavigator';
import { colors, typography } from '../theme';

export type MainTabParamList = {
  Home: undefined;
  Aspis: { screen: 'Share'; initial: false; params: { sharedText: string } } | undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Os dois espaços do Áskesis: a Comentora (estimula o comportamento) e o Aspis
 * (protege a atenção). Telas que abrem por cima (chat, configurações, respiração…)
 * continuam na pilha raiz e cobrem a barra; as do Aspis ficam dentro da aba dele.
 */
export function MainTabs() {
  return (
    <Tab.Navigator
      backBehavior="firstRoute"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg.primary },
        tabBarActiveTintColor: colors.accent.gold,
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarLabelStyle: { ...typography.small, fontSize: 12 },
        tabBarStyle: {
          backgroundColor: colors.bg.primary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
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
          title: 'Aspis',
          tabBarIcon: ({ size, focused }) => (
            <Image
              source={require('../../assets/aspis/logo-mark.png')}
              style={{ width: size, height: size, borderRadius: size / 2, opacity: focused ? 1 : 0.55 }}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
