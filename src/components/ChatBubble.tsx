import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import type { ChatRole } from '../types';

interface ChatBubbleProps {
  role: ChatRole;
  content: string;
  offline?: boolean;
}

export function ChatBubble({ role, content, offline }: ChatBubbleProps) {
  const isOwl = role === 'corujinha';
  return (
    <View style={[styles.row, isOwl ? styles.rowLeft : styles.rowRight]}>
      <View
        style={[
          styles.bubble,
          isOwl ? styles.owl : styles.user,
          isOwl ? { borderBottomLeftRadius: 4 } : { borderBottomRightRadius: 4 },
        ]}
      >
        <Text style={[typography.body, isOwl ? { color: colors.text.primary } : styles.userText]}>
          {content}
        </Text>
        {isOwl && offline && (
          <Text style={[typography.label, styles.offline]}>OFFLINE</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    marginVertical: spacing.xs,
  },
  rowLeft: {
    justifyContent: 'flex-start',
  },
  rowRight: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  owl: {
    backgroundColor: colors.bg.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  user: {
    backgroundColor: colors.accent.gold,
  },
  userText: {
    color: colors.text.onGold,
  },
  offline: {
    marginTop: spacing.xs,
    color: colors.text.tertiary,
  },
});
