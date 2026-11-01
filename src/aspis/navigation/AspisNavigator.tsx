import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFocusEffect, useNavigation } from '@react-navigation/native';

import { useAppStore as useRootStore } from '../../store/useAppStore';
import { getNightGateEnabled, isSleepWindow, setNightGateEnabled } from '../bootstrap';
import { ScreenContainer } from '../components/ScreenContainer';
import { FeedScreen } from '../screens/FeedScreen';
import { NotesScreen } from '../screens/NotesScreen';
import { MediaScreen } from '../screens/MediaScreen';
import { NoteReaderScreen } from '../screens/NoteReaderScreen';
import { PillarEditScreen } from '../screens/PillarEditScreen';
import { PlayerScreen } from '../screens/PlayerScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ShareScreen } from '../screens/ShareScreen';
import { colors, spacing, typography } from '../theme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * O feed na hora de dormir: a Comentora está tentando te levar para a cama, e um
 * feed aberto trabalharia contra ela. Fecha, mas não tranca — "Abrir mesmo assim"
 * vale até sair da tela. Compartilhar um vídeo para o Aspis nunca passa por aqui.
 */
function GatedFeed(props: React.ComponentProps<typeof FeedScreen>) {
  const bedtime = useRootStore((s) => s.config?.bedtime);
  const [gateOn, setGateOn] = useState<boolean | null>(null);
  const [bypass, setBypass] = useState(false);
  const navigation = useNavigation<any>();

  useFocusEffect(
    useCallback(() => {
      void getNightGateEnabled().then(setGateOn);
      return () => setBypass(false);
    }, []),
  );

  if (gateOn === null) return <ScreenContainer>{null}</ScreenContainer>;
  if (gateOn && !bypass && isSleepWindow(bedtime)) {
    return (
      <ScreenContainer>
        <View style={styles.gate}>
          <Text style={styles.title}>O feed fechou por hoje</Text>
          <Text style={styles.body}>
            Já passou da sua hora de dormir ({bedtime}). Os vídeos continuam aqui amanhã, depois das 6h.
          </Text>
          <Pressable onPress={() => navigation.getParent()?.goBack()} style={styles.primary}>
            <Text style={styles.primaryText}>Voltar</Text>
          </Pressable>
          <Pressable onPress={() => setBypass(true)} hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>Abrir mesmo assim</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void setNightGateEnabled(false);
              setGateOn(false);
            }}
            hitSlop={8}
            style={styles.link}
          >
            <Text style={styles.linkText}>Não fechar mais à noite</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }
  return <FeedScreen {...props} />;
}

/** O Aspis como uma seção do Áskesis: uma pilha dentro da navegação principal. */
export function AspisNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Feed"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg.primary },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Feed" component={GatedFeed} />
      <Stack.Screen name="Share" component={ShareScreen} options={{ animation: 'fade_from_bottom' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="PillarEdit" component={PillarEditScreen} />
      <Stack.Screen name="Notes" component={NotesScreen} />
      <Stack.Screen name="NoteReader" component={NoteReaderScreen} />
      <Stack.Screen name="Player" component={PlayerScreen} />
      <Stack.Screen name="Media" component={MediaScreen} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  title: { ...typography.subtitle, color: colors.text.primary, textAlign: 'center', marginBottom: spacing.sm },
  body: { ...typography.body, color: colors.text.secondary, textAlign: 'center', marginBottom: spacing.xl },
  primary: {
    alignSelf: 'center',
    backgroundColor: colors.accent.gold,
    borderRadius: 999,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  primaryText: { ...typography.bodyMedium, color: colors.text.onGold },
  link: { alignSelf: 'center', marginTop: spacing.md },
  linkText: { ...typography.small, color: colors.text.secondary },
});
