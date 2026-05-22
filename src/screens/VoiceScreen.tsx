import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { VoicePicker } from '../components/VoicePicker';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import type { EnrichedVoice } from '../services/voice';

export function VoiceScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>
          Voz da Comentora
        </Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <VoicePicker
          value={config?.voiceId ?? null}
          onChange={async (v: EnrichedVoice | null) => {
            await setConfig({
              voiceId: v?.identifier ?? null,
              voiceLanguage: v?.language ?? null,
            });
          }}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    minWidth: 60,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
});
