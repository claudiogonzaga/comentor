// Entrar no X, na página oficial dele. A senha fica lá; o app só guarda a sessão.
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { XLoginView } from '../../../modules/x-login-view';
import { ScreenContainer } from '../components/ScreenContainer';
import type { RootStackParamList } from '../navigation/types';
import { useXStore, X_LOGIN_URL, X_LOGOUT_URL, X_USER_AGENT } from '../services/x';
import { colors, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'XLogin'>;

export function XLoginScreen({ navigation, route }: Props) {
  const logout = route.params?.logout === true;
  const setConnected = useXStore((s) => s.setConnected);
  const done = useRef(false);
  const url = logout ? X_LOGOUT_URL : X_LOGIN_URL;

  const onUrl = (address: string) => {
    if (done.current) return;
    const path = address.replace(/^https:\/\/(www\.)?x\.com/, '');
    if (!logout && path.startsWith('/home')) {
      done.current = true;
      setConnected(true);
      navigation.goBack();
    } else if (logout && (path === '/' || path.startsWith('/i/flow/login') || path.startsWith('/login'))) {
      done.current = true;
      setConnected(false);
      navigation.goBack();
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.head}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={styles.hint}>
          {logout
            ? 'Confirme a saída na página do X.'
            : 'Entre na sua conta na página do X, com o Google ou com usuário e senha. A senha fica no X ou no Google: o Áskesis guarda só a sessão, neste aparelho.'}
        </Text>
      </View>
      {XLoginView ? (
        // A janela do "Entrar com o Google" abre por cima, dentro do app (ver modules/x-login-view).
        <XLoginView style={styles.web} url={url} onUrl={(e) => onUrl(e.nativeEvent.url)} />
      ) : (
        <WebView
          style={styles.web}
          source={{ uri: url }}
          userAgent={X_USER_AGENT}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          onNavigationStateChange={(nav) => onUrl(nav.url)}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  back: { ...typography.bodyMedium, color: colors.text.primary },
  hint: { ...typography.small, color: colors.text.secondary },
  web: { flex: 1 },
});
