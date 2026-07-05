import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VaseBackground } from './VaseBackground';
import { spacing } from '../theme';

interface Props {
  children: ReactNode;
  contentStyle?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
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
  root: { flex: 1 },
  safe: { flex: 1 },
  // Afasta o conteúdo das FAIXAS DO MEANDRO (desenhadas full-screen atrás):
  // sem isto, headers ("Voltar"/título) sobrepunham a borda grega no topo e
  // nas laterais. Central aqui = vale para TODAS as telas de uma vez.
  content: { flex: 1, paddingTop: spacing.xl, paddingHorizontal: spacing.md },
});
