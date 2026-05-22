import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { OwlSoundPicker } from '../components/OwlSoundPicker';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { rescheduleAllNotifications } from '../services/coach';
import type { OwlSpeciesId } from '../types';

export function OwlSoundScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();
  const value = (config?.owlSpecies ?? 'cabure') as OwlSpeciesId;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>
          Som das corujas
        </Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <OwlSoundPicker
          value={value}
          onChange={async (species: OwlSpeciesId) => {
            await setConfig({ owlSpecies: species });
            await rescheduleAllNotifications();
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
