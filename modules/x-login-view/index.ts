// Ponte JS da tela de login do X (Android): um WebView nativo que abre dentro do app
// a janela do "Entrar com o Google", ainda ligada à página do X.
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

export interface XLoginViewProps extends ViewProps {
  url: string;
  onUrl?: (event: { nativeEvent: { url: string } }) => void;
}

const native = requireOptionalNativeModule<{ chromeUserAgent(): string | null }>('XLoginView');

/** O WebView nativo do login, ou null num build sem o módulo. */
export const XLoginView: ComponentType<XLoginViewProps> | null = native
  ? requireNativeViewManager<XLoginViewProps>('XLoginView')
  : null;

/** O user agent do Chrome deste aparelho, o mesmo que o login usa. */
export function chromeUserAgent(): string | null {
  try {
    return native?.chromeUserAgent() ?? null;
  } catch {
    return null;
  }
}
