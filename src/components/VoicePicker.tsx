import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme';
import {
  listPortugueseVoices,
  openAndroidTTSSettings,
  previewVoice,
  stopSpeaking,
  type EnrichedVoice,
} from '../services/voice';

interface Props {
  /** identifier of the currently saved voice, if any */
  value: string | null;
  /** called when the user picks a different voice */
  onChange: (voice: EnrichedVoice | null) => void;
}

const PLAY_HOLD_MS = 6000;

export function VoicePicker({ value, onChange }: Props) {
  const [voices, setVoices] = useState<EnrichedVoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listPortugueseVoices();
      setVoices(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const hasBrazilian = !!voices?.some((v) => v.isBrazilian);
  const hasAnyPortuguese = !!voices?.length;

  const handlePreview = async (v: EnrichedVoice) => {
    if (previewingId === v.identifier) {
      await stopSpeaking();
      setPreviewingId(null);
      return;
    }
    setPreviewingId(v.identifier);
    await previewVoice(v);
    // Auto-clear preview state after a max hold window even if onDone fires late
    setTimeout(() => {
      setPreviewingId((curr) => (curr === v.identifier ? null : curr));
    }, PLAY_HOLD_MS);
  };

  const handleOpenSettings = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Apenas no Android',
        'A instalação de vozes adicionais funciona via Configurações do Android.',
      );
      return;
    }
    const ok = await openAndroidTTSSettings();
    if (!ok) {
      Alert.alert(
        'Não consegui abrir as configurações',
        'Vá em: Configurações do Android → Acessibilidade → Saída de texto para voz → motor do Google → Instalar dados de voz → Português (Brasil) → marcar todas as vozes.',
      );
    } else {
      Alert.alert(
        'Quase lá',
        'Você precisa ir em: motor do Google → Instalar dados de voz → Português (Brasil) → marcar todas. Depois volta aqui e a lista atualiza.',
        [{ text: 'Ok', onPress: () => setTimeout(reload, 500) }],
      );
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Voz do CoMentor 🦉</Text>
        <Pressable onPress={reload} style={styles.reloadBtn} hitSlop={8}>
          <Text style={styles.reloadIcon}>↻</Text>
        </Pressable>
      </View>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      )}

      {!loading && !hasAnyPortuguese && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>
            Nenhuma voz em português instalada
          </Text>
          <Text style={styles.warningBody}>
            Seu celular não tem voz em português. Sem isso, o CoMentor vai usar
            a voz padrão (provavelmente em inglês).
          </Text>
          <Pressable style={styles.installBtn} onPress={handleOpenSettings}>
            <Text style={styles.installBtnText}>Abrir Configurações de TTS</Text>
          </Pressable>
        </View>
      )}

      {!loading && hasAnyPortuguese && !hasBrazilian && (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>
            Você só tem voz de Portugal (pt-PT)
          </Text>
          <Text style={styles.warningBody}>
            Pra ouvir o CoMentor em português brasileiro, instale as vozes
            pt-BR do Google: <Text style={styles.warningBold}>
            Acessibilidade → Saída de texto para voz → motor do Google →
            Instalar dados de voz → Português (Brasil) → marcar todas
            </Text>.
          </Text>
          <Pressable style={styles.installBtn} onPress={handleOpenSettings}>
            <Text style={styles.installBtnText}>Abrir Configurações de TTS</Text>
          </Pressable>
        </View>
      )}

      {!loading && (
        <View>
          <Pressable
            style={[styles.row, value === null && styles.rowSelected]}
            onPress={() => onChange(null)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Automática (padrão do sistema)</Text>
              <Text style={styles.rowSub}>
                Deixar o app escolher a melhor pt-* disponível
              </Text>
            </View>
            <View style={[styles.radio, value === null && styles.radioActive]} />
          </Pressable>

          {voices?.map((v) => {
            const selected = v.identifier === value;
            const playing = previewingId === v.identifier;
            return (
              <View key={v.identifier} style={[styles.row, selected && styles.rowSelected]}>
                <Pressable style={styles.rowMain} onPress={() => onChange(v)}>
                  <Text style={styles.rowTitle}>{v.displayName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {v.language}
                    {v.quality === Speech.VoiceQuality.Enhanced ? ' · alta qualidade' : ''}
                    {v.gender === 'unknown' ? ' · gênero não identificado' : ''}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => handlePreview(v)}
                  style={[styles.playBtn, playing && styles.playBtnActive]}
                  hitSlop={6}
                >
                  <Text style={styles.playIcon}>{playing ? '◼' : '▶'}</Text>
                </Pressable>
                <Pressable onPress={() => onChange(v)} hitSlop={6}>
                  <View style={[styles.radio, selected && styles.radioActive]} />
                </Pressable>
              </View>
            );
          })}

          {hasAnyPortuguese && (
            <Pressable style={styles.moreVoicesBtn} onPress={handleOpenSettings}>
              <Text style={styles.moreVoicesText}>
                + Instalar mais vozes do Google
              </Text>
            </Pressable>
          )}

          <Text style={styles.hint}>
            Não está vendo a voz que quer? Clique acima pra ir nas configurações
            do Android e baixar todas as vozes pt-BR. Depois, toque em ↻ pra
            recarregar a lista.
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.subtitle,
    color: colors.text.primary,
  },
  reloadBtn: {
    padding: spacing.xs,
  },
  reloadIcon: {
    fontSize: 22,
    color: colors.accent.gold,
  },
  loading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  warningBox: {
    backgroundColor: 'rgba(244,197,83,0.10)',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    marginBottom: spacing.md,
  },
  warningTitle: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    marginBottom: spacing.xs,
  },
  warningBody: {
    ...typography.small,
    color: colors.text.primary,
    lineHeight: 18,
  },
  warningBold: {
    fontFamily: typography.bodyMedium.fontFamily,
    color: colors.text.primary,
  },
  installBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.accent.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  installBtnText: {
    ...typography.button,
    color: colors.text.onGold,
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
  rowMain: {
    flex: 1,
  },
  rowSelected: {
    borderColor: colors.accent.gold,
    backgroundColor: 'rgba(244,197,83,0.08)',
  },
  rowTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  rowSub: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: 2,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnActive: {
    backgroundColor: colors.accent.gold,
  },
  playIcon: {
    color: colors.accent.gold,
    fontSize: 14,
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
  moreVoicesBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  moreVoicesText: {
    ...typography.small,
    color: colors.accent.gold,
  },
  hint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
