import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { OwlSoundPicker } from '../components/OwlSoundPicker';
import { BreathingSoundPicker } from '../components/BreathingSoundPicker';
import { VoiceProviderCard } from '../components/VoiceProviderCard';
import { VoicePicker } from '../components/VoicePicker';
import type { EnrichedVoice } from '../services/voice';
import { colors, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { rescheduleAllNotifications } from '../services/coach';
import type { OwlSpeciesId } from '../types';

/**
 * #6 — Reúne, numa tela própria, os três seletores de áudio que antes
 * ocupavam muito espaço em Configurações: o canto da coruja (notificações),
 * o provedor de voz (sistema/Gemini) e a voz da Comentora (TTS do sistema).
 */
export function SoundsVoiceScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>Sons e Vozes</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.md }]}>
          Escolha o canto da coruja que toca nas notificações e a voz que a
          Comentora usa para falar em voz alta.
        </Text>

        <OwlSoundPicker
          value={(config?.owlSpecies ?? 'buraqueira') as OwlSpeciesId}
          onChange={async (species: OwlSpeciesId) => {
            await setConfig({ owlSpecies: species });
            await rescheduleAllNotifications();
          }}
        />

        <BreathingSoundPicker
          value={config?.breathingSoundId ?? 'tone'}
          customUri={config?.breathingSoundUri ?? null}
          onSelect={async (id: string) => {
            await setConfig({ breathingSoundId: id });
          }}
          onUploadCustom={async (uri: string) => {
            await setConfig({ breathingSoundId: 'custom', breathingSoundUri: uri });
          }}
        />

        <VoiceProviderCard
          provider={config?.voiceProvider ?? 'system'}
          geminiVoiceName={config?.geminiVoiceName ?? 'Aoede'}
          hasApiKey={!!config?.hasApiKey}
          onProviderChange={async (p) => {
            await setConfig({ voiceProvider: p });
          }}
          onGeminiVoiceChange={async (name) => {
            await setConfig({ geminiVoiceName: name });
          }}
        />

        {(config?.voiceProvider ?? 'system') === 'system' ? (
          <VoicePicker
            value={config?.voiceId ?? null}
            onChange={async (v: EnrichedVoice | null) => {
              await setConfig({
                voiceId: v?.identifier ?? null,
                voiceLanguage: v?.language ?? null,
              });
            }}
          />
        ) : null}

        <View style={{ height: spacing.xxl }} />
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
  },
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    minWidth: 60,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
});
