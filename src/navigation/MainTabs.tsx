import { useEffect, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { GreekIcon } from '../components/GreekIcon';
import { HomeScreen } from '../screens/HomeScreen';
import { AspisNavigator } from '../aspis/navigation/AspisNavigator';
import { KairosScreen } from '../kairos/KairosScreen';
import { KinesisScreen } from '../kinesis/KinesisScreen';
import { SengaiIcon } from '../zazen/arte';
import { ZazenScreen } from '../zazen/ZazenScreen';
import { LOGO_ESCUDO } from '../aspis/theme/logo';
import { naoLidos, useAvisos } from '../avisos/store';
import { colors, typography } from '../theme';

export type MainTabParamList = {
  Home: undefined;
  Aspis: { screen: 'Share'; initial: false; params: { sharedText: string } } | undefined;
  Kinesis: undefined;
  Kairos: undefined;
  Zazen: undefined;
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

/** O sino da caixa de avisos (a IA pessoal e ele), o mesmo do Mac. */
function SinoIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  );
}

/** Largura do sino, à direita das abas. */
const SINO = 38;

function Sino({ topo }: { topo: number }) {
  const navigation = useNavigation();
  const n = useAvisos((s) => naoLidos(s.avisos));
  const load = useAvisos((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Pressable
      onPress={() => navigation.navigate('Avisos' as never)}
      style={[sinoStyles.botao, { paddingTop: topo }]}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={n ? `Avisos da sua IA: ${n} não lido${n > 1 ? 's' : ''}` : 'Avisos da sua IA'}
    >
      <View>
        <SinoIcon size={22} color={n ? colors.accent.gold : colors.text.tertiary} />
        {n > 0 && (
          <View style={sinoStyles.badge}>
            <Text style={sinoStyles.badgeTxt}>{n > 99 ? '99+' : n}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const sinoStyles = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    backgroundColor: colors.bg.primary,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  botao: { width: SINO, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTxt: { ...typography.small, fontSize: 10, lineHeight: 13, fontFamily: 'Inter_600SemiBold', color: colors.text.onGold },
});

// ---- cinco abas numa barra só ----
//
// Com um quinto da tela para cada (uns 93 pontos no Motorola), "Comentora" ao lado
// do ícone não cabe. Então cada aba ganha a largura do que mostra (ícone + rótulo),
// a fonte desce um ponto e a caixa do ícone perde a folga. Se nem assim couber
// (tela estreita, fonte do sistema grande), o rótulo vai para baixo do ícone.

const ROTULOS: Record<keyof MainTabParamList, string> = {
  Home: 'Comentora',
  Aspis: 'Escudo',
  Kinesis: 'Kinesis',
  Kairos: 'Kairós',
  Zazen: 'Zazen',
};
const FONTE_ROTULO = 12;
/** Com o sino à direita, se o 12 não couber ao lado do ícone, tenta o 11 antes de descer o rótulo. */
const FONTE_ROTULO_MIN = 11;
/** O ícone redondo da barra tem 25 pontos; a caixa padrão (31) tem 3 de folga de cada lado. */
const CAIXA_ICONE = 25;
/** O ○△□ é mais largo que alto (41×24). */
const ALTURA_SENGAI = 20;
const CAIXA_SENGAI = Math.ceil((ALTURA_SENGAI * 41) / 24);
/** Padding do item (5 de cada lado) + o espaço entre o ícone e o rótulo. */
const FOLGA_ABA = 5 * 2 + 4;
/** Largura estimada do rótulo: a Inter tem ~0,58 em por letra nestas palavras; 0,6 com margem. */
function larguraRotulo(texto: string, escalaFonte: number, fonte = FONTE_ROTULO): number {
  return texto.length * fonte * 0.6 * escalaFonte;
}

/**
 * Os cinco espaços da Noosfera: a Comentora (estimula o comportamento), o Escudo
 * (o Aspis no código: protege a atenção), o Kinesis (tira da cadeira), o Kairós (as
 * tarefas) e o Zazen (senta). Telas que abrem por cima (chat, configurações,
 * respiração…) continuam na pilha raiz e cobrem a barra; as do Aspis ficam dentro da aba dele.
 */
export function MainTabs() {
  const insets = useSafeAreaInsets();
  // A barra fica em cima e já desconta a barra de status: para as telas dentro
  // das abas, não há recuo no topo (a moldura grega começa logo abaixo dela).
  const sceneInsets = useMemo(() => ({ ...insets, top: 0 }), [insets]);

  const { width, fontScale } = useWindowDimensions();
  const barra = useMemo(() => {
    const nomes = Object.keys(ROTULOS) as (keyof MainTabParamList)[];
    const cabe = width - insets.left - insets.right - SINO;
    const medir = (fonte: number) => {
      const precisa = {} as Record<keyof MainTabParamList, number>;
      for (const nome of nomes) {
        const icone = nome === 'Zazen' ? CAIXA_SENGAI : CAIXA_ICONE;
        precisa[nome] = icone + FOLGA_ABA + larguraRotulo(ROTULOS[nome], fontScale || 1, fonte);
      }
      return { precisa, total: nomes.reduce((soma, nome) => soma + precisa[nome], 0) };
    };
    let fonte = FONTE_ROTULO;
    let m = medir(fonte);
    if (m.total > cabe) {
      const menor = medir(FONTE_ROTULO_MIN);
      if (menor.total <= cabe) {
        fonte = FONTE_ROTULO_MIN;
        m = menor;
      }
    }
    const lado = m.total <= cabe;
    const media = m.total / nomes.length;
    return {
      lado,
      fonte,
      item: (nome: keyof MainTabParamList) => ({ flex: lado ? m.precisa[nome] / media : 1 }),
    };
  }, [width, fontScale, insets.left, insets.right]);

  return (
    <Tab.Navigator
      backBehavior="firstRoute"
      // A barra das abas e, à direita, o sino da caixa de avisos (abre por cima de tudo).
      tabBar={(props) => (
        <View style={sinoStyles.barra}>
          <View style={{ flex: 1 }}>
            <BottomTabBar {...props} />
          </View>
          <Sino topo={insets.top} />
        </View>
      )}
      screenLayout={({ children }) => (
        <SafeAreaInsetsContext.Provider value={sceneInsets}>{children}</SafeAreaInsetsContext.Provider>
      )}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg.primary },
        tabBarPosition: 'top',
        tabBarLabelPosition: barra.lado ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: colors.accent.gold,
        tabBarInactiveTintColor: colors.text.tertiary,
        // Os 12 pontos que a barra deixa depois do texto cortavam o "Comentora"
        // (marginEnd: 0); com cinco abas, também a fonte e a folga do ícone (acima).
        tabBarLabelStyle: barra.lado
          ? { ...typography.small, fontSize: barra.fonte, marginStart: 4, marginEnd: 0 }
          : { ...typography.small, fontSize: 11, lineHeight: 14, marginStart: 0, marginEnd: 0 },
        tabBarIconStyle: barra.lado ? { width: CAIXA_ICONE } : undefined,
        tabBarStyle: {
          backgroundColor: colors.bg.primary,
          // A borda de baixo é da barra inteira (abas + sino), logo acima.
          borderBottomWidth: 0,
          // Rótulo embaixo: a altura padrão (49) não comporta ícone + texto.
          ...(barra.lado ? null : { height: 56 + insets.top }),
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: ROTULOS.Home,
          tabBarItemStyle: barra.item('Home'),
          tabBarIcon: ({ color, size }) => <GreekIcon name="owl" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Aspis"
        component={AspisNavigator}
        options={{
          title: ROTULOS.Aspis,
          tabBarItemStyle: barra.item('Aspis'),
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
          title: ROTULOS.Kinesis,
          tabBarItemStyle: barra.item('Kinesis'),
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
          title: ROTULOS.Kairos,
          tabBarItemStyle: barra.item('Kairos'),
          tabBarIcon: ({ color, size }) => <KairosIcon size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Zazen"
        component={ZazenScreen}
        options={{
          title: ROTULOS.Zazen,
          tabBarItemStyle: barra.item('Zazen'),
          tabBarIconStyle: { width: CAIXA_SENGAI },
          tabBarIcon: ({ color }) => <SengaiIcon height={ALTURA_SENGAI} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
