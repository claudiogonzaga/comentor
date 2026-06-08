import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { OwlSoundPicker } from '../components/OwlSoundPicker';
import { BreathingSoundPicker } from '../components/BreathingSoundPicker';
import { BreathingDurationPicker } from '../components/BreathingDurationPicker';
import { VoiceProviderCard } from '../components/VoiceProviderCard';
import { VoicePicker } from '../components/VoicePicker';
import type { EnrichedVoice } from '../services/voice';
import { colors, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { rescheduleAllNotifications } from '../services/coach';
import {
  listBreathingCustomSounds,
  createBreathingCustomSound,
  renameBreathingCustomSound,
  deleteBreathingCustomSound,
} from '../services/database';
import type { BreathingCustomSound, OwlSpeciesId } from '../types';

/**
 * #6 — Reúne, numa tela própria, os três seletores de áudio que antes
 * ocupavam muito espaço em Configurações: o canto da coruja (notificações),
 * o provedor de voz (sistema/Gemini) e a voz da Comentora (TTS do sistema).
 */
export function SoundsVoiceScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();
  const [customSounds, setCustomSounds] = useState<BreathingCustomSound[]>([]);

  const reloadCustomSounds = useCallback(async () => {
    try {
      setCustomSounds(await listBreathingCustomSounds());
    } catch {
      /* lista opcional */
    }
  }, []);

  useEffect(() => {
    reloadCustomSounds();
  }, [reloadCustomSounds]);

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
          value={config?.breathingSoundId ?? 'cello'}
          customSounds={customSounds}
          onSelect={async (id: string) => {
            await setConfig({ breathingSoundId: id });
          }}
          onAddSound={async (name: string, uri: string) => {
            const created = await createBreathingCustomSound({ name, uri });
            await reloadCustomSounds();
            await setConfig({ breathingSoundId: `custom:${created.id}` });
          }}
          onRename={async (id: number, name: string) => {
            await renameBreathingCustomSound(id, name);
            await reloadCustomSounds();
          }}
          onDelete={async (id: number) => {
            await deleteBreathingCustomSound(id);
            // se o excluído era o selecionado, volta para o som padrão.
            if (config?.breathingSoundId === `custom:${id}`) {
              await setConfig({ breathingSoundId: 'cello' });
            }
            await reloadCustomSounds();
          }}
        />

        <BreathingDurationPicker
          value={config?.breathingDurationMinutes ?? 16}
          onChange={async (minutes: number) => {
            await setConfig({ breathingDurationMinutes: minutes });
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
