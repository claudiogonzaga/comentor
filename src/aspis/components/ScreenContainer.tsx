import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { VaseBackground } from './VaseBackground';

interface Props {
  children: ReactNode;
  contentStyle?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  /** Mostra a moldura de meandro (grega) ao redor da tela. Padrão: true. */
  meander?: boolean;
}

export function ScreenContainer({
  children,
  contentStyle,
  edges = ['top', 'bottom'],
  meander = true,
}: Props) {
  return (
    <View style={styles.root}>
      <VaseBackground meander={meander} />
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={[styles.content, contentStyle]}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.primary },
  safe: { flex: 1 },
  content: { flex: 1 },
});
