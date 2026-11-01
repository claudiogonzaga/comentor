import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radius, spacing } from '../theme';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  blur?: boolean;
}

export function Card({ children, style, blur = false }: CardProps) {
  if (blur) {
    return (
      <BlurView intensity={30} tint="dark" style={[styles.card, styles.cardBlur, style]}>
        {children}
      </BlurView>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardBlur: {
    overflow: 'hidden',
  },
});
