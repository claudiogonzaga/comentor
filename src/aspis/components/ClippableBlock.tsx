// Envolve um bloco da análise tornando-o "clipável": tocar salva (ou remove) o
// trecho como uma NOTA ATÔMICA no vault. Mostra estado salvo (borda + ✓).
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radius, spacing, typography } from '../theme';

interface Props {
  saved: boolean;
  busy?: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function ClippableBlock({ saved, busy, onToggle, children }: Props) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onToggle();
      }}
      disabled={busy}
      style={({ pressed }) => [styles.wrap, saved && styles.wrapSaved, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.content}>{children}</View>
      <View style={styles.mark}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.accent.gold} />
        ) : (
          <Text style={[styles.icon, saved && styles.iconOn]}>{saved ? '✓' : '＋'}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    paddingLeft: spacing.sm,
  },
  wrapSaved: {
    borderLeftColor: colors.accent.gold,
    backgroundColor: colors.bg.surface,
  },
  content: { flex: 1 },
  mark: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 1,
  },
  icon: { ...typography.body, fontSize: 15, color: colors.text.tertiary, lineHeight: 18 },
  iconOn: { color: colors.accent.gold, fontFamily: 'Inter_600SemiBold' },
});
