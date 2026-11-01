// Configurações › Transcrição no celular: modelo Parakeet (baixar / progresso /
// apagar) e a transcrição automática que refaz a triagem.
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as db from '../services/db';
import { isUnmeteredNetwork } from '../services/media';
import { AUTO_OPTIONS } from '../services/transcription';
import { useTranscribeStore } from '../store/useTranscribeStore';
import { colors, spacing, typography } from '../theme';
import { Button } from './Button';
import { Chip } from './Chip';

const MB = 1024 * 1024;

export function TranscriptionSettings() {
  const model = useTranscribeStore((s) => s.model);
  const autoMode = useTranscribeStore((s) => s.autoMode);
  const autoRunning = useTranscribeStore((s) => s.autoRunning);
  const version = useTranscribeStore((s) => s.version);
  const jobs = useTranscribeStore((s) => s.jobs);
  const setAuto = useTranscribeStore((s) => s.setAuto);
  const downloadModel = useTranscribeStore((s) => s.downloadModel);
  const cancelModelDownload = useTranscribeStore((s) => s.cancelModelDownload);
  const deleteModel = useTranscribeStore((s) => s.deleteModel);
  const init = useTranscribeStore((s) => s.init);

  useEffect(() => init(), [init]); // relê o estado do modelo ao abrir

  const pending = useMemo(() => db.autoTranscribeCandidates(200).length, [version, autoRunning]);
  const totalMb = Math.round((model.total || 670 * MB) / MB);
  const pct = model.total ? Math.round((model.received / model.total) * 100) : 0;
  const current = Object.entries(jobs).find(([, j]) => j.auto);
  const currentTitle = current ? db.getVideo(current[0])?.neutral_title : null;

  return (
    <View style={{ gap: spacing.sm }}>
      {model.installed ? (
        <View style={styles.row}>
          <Text style={styles.ok}>✓ Modelo Parakeet pronto ({totalMb} MB)</Text>
          <Pressable onPress={deleteModel} hitSlop={8}>
            <Text style={styles.danger}>apagar</Text>
          </Pressable>
        </View>
      ) : model.downloading ? (
        <View style={styles.row}>
          <Text style={styles.text}>
            Baixando o modelo… {pct}% · {Math.round(model.received / MB)}/{totalMb} MB
          </Text>
          <Pressable onPress={cancelModelDownload} hitSlop={8}>
            <Text style={styles.link}>cancelar</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: spacing.xs }}>
          <Button
            label={`Baixar o modelo (${totalMb} MB)`}
            onPress={downloadModel}
            fullWidth={false}
          />
          {model.received > 0 && (
            <Text style={styles.hint}>Continua de onde parou ({Math.round(model.received / MB)} MB já baixados).</Text>
          )}
          {!isUnmeteredNetwork() && (
            <Text style={styles.warn}>Você está em dados móveis — prefira baixar no Wi-Fi.</Text>
          )}
        </View>
      )}
      {model.error && <Text style={styles.warn}>{model.error}</Text>}

      <Text style={[styles.text, { marginTop: spacing.md }]}>
        Transcrição automática (vídeos sem legenda, para refazer a triagem):
      </Text>
      <View style={styles.chips}>
        {AUTO_OPTIONS.map((o) => (
          <Chip key={o.mode} label={o.label} active={autoMode === o.mode} onPress={() => setAuto(o.mode)} />
        ))}
      </View>
      <Text style={styles.hint}>
        {currentTitle
          ? `Transcrevendo agora: ${currentTitle}. `
          : ''}
        {pending > 0
          ? `${pending} vídeo${pending === 1 ? '' : 's'} na fila${model.installed ? '' : ' (esperando o modelo)'}.`
          : 'Nenhum vídeo esperando transcrição.'}
        {' '}“Só no Wi-Fi” vale para baixar o áudio; a transcrição em si não usa internet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  text: { ...typography.small, color: colors.text.primary, flexShrink: 1 },
  ok: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.accent.success, flexShrink: 1 },
  hint: { ...typography.small, color: colors.text.secondary, lineHeight: 18 },
  warn: { ...typography.small, color: colors.accent.danger },
  link: { ...typography.small, color: colors.accent.gold },
  danger: { ...typography.small, color: colors.accent.danger },
});
