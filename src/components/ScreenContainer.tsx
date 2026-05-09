import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StarryBackground } from './StarryBackground';

interface Props {
  children: ReactNode;
  showMoon?: boolean;
  starDensity?: number;
  contentStyle?: ViewStyle;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function ScreenContainer({
  children,
  showMoon = true,
  starDensity = 60,
  contentStyle,
  edges = ['top', 'bottom'],
}: Props) {
  return (
    <View style={styles.root}>
      <StarryBackground showMoon={showMoon} density={starDensity} />
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
