import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { GreekIcon } from './GreekIcon';
import { colors, radius, spacing, typography } from '../theme';
import { GEMINI_VOICES } from '../services/geminiTTS';
import { previewGeminiVoice, stopSpeaking } from '../services/voice';
import type { VoiceProvider } from '../types';

interface Props {
  provider: VoiceProvider;
  geminiVoiceName: string;
  hasApiKey: boolean;
  onProviderChange: (provider: VoiceProvider) => void;
  onGeminiVoiceChange: (name: string) => void;
}

export function VoiceProviderCard({
  provider,
  geminiVoiceName,
  hasApiKey,
  onProviderChange,
  onGeminiVoiceChange,
}: Props) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreview = async (voiceName: string) => {
    setPreviewError(null);
    if (previewing === voiceName) {
      await stopSpeaking();
      setPreviewing(null);
      return;
    }
    setPreviewing(voiceName);
    try {
      await previewGeminiVoice(voiceName);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'falhou ao gerar áudio');
    } finally {
      // O onDone do speak limparia automaticamente, mas como o preview pode
      // demorar e o usuário pode trocar de voz, deixamos o estado por uns
      // segundos para feedback visual e zeramos depois.
      setTimeout(() => setPreviewing((c) => (c === voiceName ? null : c)), 8000);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.sectionRow}>
        <GreekIcon name="voice" size={20} />
        <Text style={styles.section}>Provedor de voz</Text>
      </View>
      <Text style={styles.subtitle}>
        A voz do sistema é grátis mas costuma soar artificial em português. A
        voz do Gemini é neural, muito mais realista — mas cada resposta
        consome cota da sua chave da API.
      </Text>

      <View style={styles.segmented}>
        <Pressable
          onPress={() => onProviderChange('system')}
          style={[styles.segment, provider === 'system' && styles.segmentActive]}
        >
          <Text
            style={[
              styles.segmentText,
              provider === 'system' && styles.segmentTextActive,
            ]}
          >
            Sistema
          </Text>
          <Text style={styles.segmentSub}>grátis</Text>
        </Pressable>
        <Pressable
          onPress={() => onProviderChange('gemini')}
          style={[styles.segment, provider === 'gemini' && styles.segmentActive]}
        >
          <Text
            style={[
              styles.segmentText,
              provider === 'gemini' && styles.segmentTextActive,
            ]}
          >
            Gemini
          </Text>
          <Text style={styles.segmentSub}>premium</Text>
        </Pressable>
      </View>

      {provider === 'gemini' && !hasApiKey ? (
        <Text style={styles.warn}>
          Voz Gemini precisa de chave da API configurada (mesma chave do chat).
        </Text>
      ) : null}

      {provider === 'gemini' ? (
        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.label}>Escolha a voz</Text>
          {GEMINI_VOICES.map((v) => {
            const selected = v.name === geminiVoiceName;
            return (
              <View
                key={v.name}
                style={[styles.row, selected && styles.rowSelected]}
              >
                <Pressable
                  style={styles.rowMain}
                  onPress={() => onGeminiVoiceChange(v.name)}
                >
                  <Text style={styles.rowTitle}>
                    {v.label}{' '}
                    <Text style={styles.rowGender}>
                      ({v.gender === 'female' ? 'feminina' : 'masculina'})
                    </Text>
                  </Text>
                  <Text style={styles.rowSub}>{v.description}</Text>
                </Pressable>
                <Pressable
                  onPress={() => handlePreview(v.name)}
                  style={[
                    styles.playBtn,
                    previewing === v.name && styles.playBtnActive,
                  ]}
                  hitSlop={6}
                  disabled={!hasApiKey}
                >
                  {previewing === v.name ? (
                    <ActivityIndicator color={colors.accent.gold} size="small" />
                  ) : (
                    <Text
                      style={[
                        styles.playText,
                        !hasApiKey && { opacity: 0.4 },
                      ]}
                    >
                      ouvir
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => onGeminiVoiceChange(v.name)}
                  hitSlop={6}
                >
                  <View style={[styles.radio, selected && styles.radioActive]} />
                </Pressable>
              </View>
            );
          })}
          {previewError ? (
            <Text style={styles.err}>{previewError}</Text>
          ) : null}
          <Text style={styles.hint}>
            Cada preview e cada fala da Comentora no chat fazem uma chamada à
            API. No plano grátis do AI Studio, é gerenciável; se você usar
            muito, considere o sistema.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
  subtitle: {
    ...typography.small,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bg.surfaceStrong,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: colors.accent.gold,
  },
  segmentText: {
    ...typography.bodyMedium,
    color: colors.text.secondary,
  },
  segmentTextActive: {
    color: colors.text.onGold,
  },
  segmentSub: {
    ...typography.small,
    fontSize: 11,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  warn: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  label: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  rowGender: {
    ...typography.small,
    color: colors.accent.gold,
    fontStyle: 'italic',
  },
  rowSub: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
  },
  playBtn: {
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnActive: {
    backgroundColor: 'rgba(244,197,83,0.18)',
  },
  playText: {
    ...typography.small,
    color: colors.accent.gold,
    fontSize: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.text.tertiary,
  },
  radioActive: {
    borderColor: colors.accent.gold,
    backgroundColor: colors.accent.gold,
  },
  err: {
    ...typography.small,
    color: '#FF8A80',
    marginTop: spacing.xs,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    lineHeight: 17,
  },
});
