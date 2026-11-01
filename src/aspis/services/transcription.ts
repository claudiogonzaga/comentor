// Transcrição NO CELULAR com o NVIDIA Parakeet TDT 0.6B v3 (sherpa-onnx), para
// vídeos sem legenda. O modelo (~670 MB) é baixado uma vez; a transcrição roda
// offline. Serve à TRIAGEM: com o texto real do vídeo, o Aspis refaz a
// pontuação de alinhamento aos pilares (antes feita só por título/descrição).
import AspisMedia, { type ModelStatus } from '../../../modules/aspis-media';
import type { Transcript } from '../types';
import { msToTimestamp } from '../utils/duration';
import * as db from './db';
import { isUnmeteredNetwork, MEDIA_SUPPORTED } from './media';

export type AutoMode = 'wifi' | 'always' | 'off';
export const AUTO_OPTIONS: { mode: AutoMode; label: string }[] = [
  { mode: 'wifi', label: 'Só no Wi-Fi' },
  { mode: 'always', label: 'Wi-Fi e dados móveis' },
  { mode: 'off', label: 'Desligada' },
];
const AUTO_KEY = 'asr:auto';

// Vídeos muito longos não entram na fila automática (o botão ainda funciona).
export const AUTO_MAX_MINUTES = 120;

export const TRANSCRIPTION_SUPPORTED = MEDIA_SUPPORTED;

export function getAutoMode(): AutoMode {
  const v = db.getMeta(AUTO_KEY);
  return v === 'always' || v === 'off' ? v : 'wifi';
}

export function setAutoMode(mode: AutoMode): void {
  db.setMeta(AUTO_KEY, mode);
}

// A transcrição em si é offline; a rede só importa para baixar o áudio.
export function canDownloadAudioNow(mode: AutoMode): boolean {
  if (mode === 'off') return false;
  return mode === 'always' || isUnmeteredNetwork();
}

const EMPTY_STATUS: ModelStatus = { installed: false, downloadedBytes: 0, totalBytes: 0, downloading: false };

export function modelStatus(): ModelStatus {
  if (!TRANSCRIPTION_SUPPORTED) return EMPTY_STATUS;
  try {
    return AspisMedia.modelStatus();
  } catch {
    return EMPTY_STATUS;
  }
}

export const downloadModel = () => AspisMedia.downloadModel();
export const cancelModelDownload = () => AspisMedia.cancelModelDownload();
export const deleteModel = () => AspisMedia.deleteModel();
export const releaseModel = () => AspisMedia.releaseModel();
export const cancelTranscription = (id: string) => AspisMedia.cancelTranscription(id);

export function onModelProgress(cb: (received: number, total: number) => void): () => void {
  if (!TRANSCRIPTION_SUPPORTED) return () => {};
  const sub = AspisMedia.addListener('onModelProgress', (e) => cb(e.received, e.total));
  return () => sub.remove();
}

export function onTranscribeProgress(cb: (id: string, progress: number) => void): () => void {
  if (!TRANSCRIPTION_SUPPORTED) return () => {};
  const sub = AspisMedia.addListener('onTranscribeProgress', (e) => cb(e.id, e.progress));
  return () => sub.remove();
}

export async function transcribeFile(uri: string, id: string): Promise<Transcript> {
  const segs = await AspisMedia.transcribe(uri, id);
  const segments = segs
    .map((s) => ({ ts: msToTimestamp(s.start * 1000), text: s.text.trim() }))
    .filter((s) => s.text);
  return { available: segments.length > 0, text: segments.map((s) => s.text).join(' '), segments };
}

export const keepAlive = {
  start: (text: string) => TRANSCRIPTION_SUPPORTED && AspisMedia.startKeepAlive(text),
  update: (text: string) => TRANSCRIPTION_SUPPORTED && AspisMedia.updateKeepAlive(text),
  stop: () => TRANSCRIPTION_SUPPORTED && AspisMedia.stopKeepAlive(),
};

// "18 min" / "1 h 20 min" / "2 h" (isoDurationToHuman) → minutos; null se não souber.
export function durationMinutes(human: string | null | undefined): number | null {
  if (!human) return null;
  const h = human.match(/(\d+)\s*h/);
  const m = human.match(/(\d+)\s*min/);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

export const isCanceled = (e: unknown) => (e as { code?: string })?.code === 'E_CANCELED';
