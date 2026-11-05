// Configurações › Transcrição no celular: modelo Parakeet (baixar / progresso /
// apagar), a transcrição automática que refaz a triagem (só os bem ranqueados)
// e o que chegou do Mac pelo Drive — com o motivo, quando a fila está parada.
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as db from '../services/db';
import { desktopStatus } from '../services/desktopTranscripts';
import { isUnmeteredNetwork } from '../services/media';
import { AUTO_OPTIONS } from '../services/transcription';
import { autoQueue, useTranscribeStore } from '../store/useTranscribeStore';
import { colors, spacing, typography } from '../theme';
import { Button } from './Button';
import { Chip } from './Chip';

const MB = 1024 * 1024;

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function TranscriptionSettings() {
  const model = useTranscribeStore((s) => s.model);
  const autoMode = useTranscribeStore((s) => s.autoMode);
  const autoRunning = useTranscribeStore((s) => s.autoRunning);
  const autoBlocked = useTranscribeStore((s) => s.autoBlocked);
  const version = useTranscribeStore((s) => s.version);
  const jobs = useTranscribeStore((s) => s.jobs);
  const setAuto = useTranscribeStore((s) => s.setAuto);
  const downloadModel = useTranscribeStore((s) => s.downloadModel);
  const cancelModelDownload = useTranscribeStore((s) => s.cancelModelDownload);
  const deleteModel = useTranscribeStore((s) => s.deleteModel);
  const init = useTranscribeStore((s) => s.init);

  useEffect(() => init(), [init]); // relê o estado do modelo ao abrir

  const queue = useMemo(() => autoQueue(), [version, autoRunning]);
  const pending = queue.ready.length;
  const failure = useMemo(() => db.lastAsrFailure(), [version, autoRunning]);
  const desk = useMemo(() => desktopStatus(), [version, autoRunning]);
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
          ? `${plural(pending, 'vídeo bem ranqueado', 'vídeos bem ranqueados')} na fila${model.installed ? '' : ' (esperando o modelo)'}.`
          : 'Nenhum vídeo bem ranqueado esperando transcrição.'}
        {queue.waitingMac.length > 0
          ? ` ${plural(queue.waitingMac.length, 'espera', 'esperam')} o Mac (o celular assume 3 h depois da triagem).`
          : ''}
        {queue.below > 0
          ? ` ${queue.below} abaixo do seu limiar de estrelas: só pelo botão Transcrever.`
          : ''}
        {' '}“Só no Wi-Fi” vale para baixar o áudio; a transcrição em si não usa internet.
      </Text>
      {autoMode !== 'off' && autoBlocked === 'network' && pending > 0 && !currentTitle && (
        <Text style={styles.warn}>
          Parada: sem Wi-Fi para baixar o áudio. Volta sozinha no Wi-Fi — ou escolha “Wi-Fi e dados móveis”.
        </Text>
      )}
      {failure && (
        <Text style={styles.hint}>
          Última falha: “{failure.title}” — {failure.error || 'sem detalhe'} ({ago(Date.parse(failure.at))}).
          {failure.tries < db.ASR_MAX_TRIES ? ' Tenta de novo sozinha mais tarde.' : ' Desistiu dele: só pelo botão.'}
        </Text>
      )}
      <Text style={styles.hint}>
        {desk.newest > 0
          ? `Do Mac: ${plural(desk.received, 'transcrição recebida', 'transcrições recebidas')} · a última feita ${ago(desk.newest)}` +
            (desk.waiting > 0 ? ` · ${desk.waiting} à espera de o vídeo chegar ao feed` : '') +
            '.'
          : desk.lastCheck > 0
            ? `Do Mac: nada ainda (Drive conferido ${ago(desk.lastCheck)}; o Mac grava em Askesis/aspis-transcricoes.json).`
            : 'Do Mac: conecte a conta Google para receber as transcrições feitas no Mac.'}
        {desk.error ? ` Erro do Drive: ${desk.error}` : ''}
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
