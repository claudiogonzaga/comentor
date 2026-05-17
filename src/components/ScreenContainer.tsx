import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VaseBackground } from './VaseBackground';
import { StarryBackground } from './StarryBackground';
import { activeTheme } from '../theme';

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
      {activeTheme === 'dark' ? (
        <StarryBackground />
      ) : (
        <VaseBackground meander={meander} />
      )}
      <SafeAreaView style={styles.safe} edges={edges}>
        <View style={[styles.content, contentStyle]}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: { flex: 1 },
});
