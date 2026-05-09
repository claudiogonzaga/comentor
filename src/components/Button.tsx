import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing, typography } from '../theme';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  icon,
  loading,
  fullWidth = true,
  style,
  onPress,
  disabled,
  ...rest
}: ButtonProps) {
  const handlePress = (e: any) => {
    Haptics.selectionAsync();
    onPress?.(e);
  };
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        fullWidth && { alignSelf: 'stretch' },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={variant === 'primary' ? colors.text.onGold : colors.accent.gold}
          />
        ) : (
          <>
            {icon}
            <Text
              style={[
                typography.button,
                variant === 'primary' && { color: colors.text.onGold },
                variant === 'secondary' && { color: colors.accent.gold },
                variant === 'ghost' && { color: colors.text.primary },
              ]}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    minHeight: 52,
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent.gold,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
