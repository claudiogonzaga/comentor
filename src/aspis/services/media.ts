// Áudio e vídeo OFFLINE: baixa (yt-dlp embarcado) o áudio ou o vídeo de um
// vídeo para o armazenamento privado do celular, toca dentro do Aspis e apaga
// sozinho depois do prazo escolhido. O disco é a fonte da verdade — o nome do
// arquivo "<videoId>.<kind>.<ext>" identifica o vídeo; nada vai para o banco
// além da posição de reprodução.
import { Platform } from 'react-native';

import AspisMedia, { type NativeMediaFile } from '../../../modules/aspis-media';
import * as db from './db';

export type MediaKind = 'audio' | 'video';

export interface MediaFile {
  videoId: string;
  kind: MediaKind;
  uri: string;
  size: number;
  downloadedAt: number;
  expiresAt: number;
}

export const MEDIA_SUPPORTED = Platform.OS === 'android';

export const RETENTION_OPTIONS: { hours: number; label: string }[] = [
  { hours: 24, label: '1 dia' },
  { hours: 24 * 3, label: '3 dias' },
  { hours: 24 * 7, label: '7 dias' },
  { hours: 24 * 30, label: '30 dias' },
];
export const DEFAULT_RETENTION_HOURS = 24 * 7;

// Pré-download: ao abrir um vídeo, áudio e vídeo já começam a baixar em
// segundo plano, para tocar sem espera se você decidir ouvir/assistir.
export type PrefetchMode = 'wifi' | 'always' | 'off';
export const PREFETCH_OPTIONS: { mode: PrefetchMode; label: string }[] = [
  { mode: 'wifi', label: 'Só no Wi-Fi' },
  { mode: 'always', label: 'Wi-Fi e dados móveis' },
  { mode: 'off', label: 'Desligado' },
];
const PREFETCH_KEY = 'media:prefetch';

export function getPrefetchMode(): PrefetchMode {
  const v = db.getMeta(PREFETCH_KEY);
  return v === 'always' || v === 'off' ? v : 'wifi';
}

export function setPrefetchMode(mode: PrefetchMode): void {
  db.setMeta(PREFETCH_KEY, mode);
}

export function isUnmeteredNetwork(): boolean {
  if (!MEDIA_SUPPORTED) return false;
  try {
    return AspisMedia.isUnmeteredNetwork();
  } catch {
    return false;
  }
}

// O modo atual permite pré-baixar AGORA (checa a rede na hora)?
export function canPrefetchNow(mode = getPrefetchMode()): boolean {
  if (!MEDIA_SUPPORTED || mode === 'off') return false;
  return mode === 'always' || isUnmeteredNetwork();
}

const ENGINE_CHECK_KEY = 'media:engineCheckedAt';
const ENGINE_CHECK_EVERY_MS = 24 * 3600 * 1000;

export const mediaBase = (videoId: string, kind: MediaKind) => `${videoId}.${kind}`;

function parse(f: NativeMediaFile, retentionHours: number): MediaFile | null {
  const [videoId, kind] = f.name.split('.');
  if (!videoId || (kind !== 'audio' && kind !== 'video')) return null;
  return {
    videoId,
    kind,
    uri: f.uri,
    size: f.size,
    downloadedAt: f.downloadedAt,
    expiresAt: f.downloadedAt + retentionHours * 3600 * 1000,
  };
}

export function getRetentionHours(): number {
  if (!MEDIA_SUPPORTED) return DEFAULT_RETENTION_HOURS;
  return AspisMedia.getRetentionHours();
}

// Muda o prazo e já aplica: o que venceu pelo novo prazo é apagado agora.
export function setRetentionHours(hours: number): void {
  if (!MEDIA_SUPPORTED) return;
  AspisMedia.setRetentionHours(hours);
  purgeExpired();
}

export function purgeExpired(): number {
  if (!MEDIA_SUPPORTED) return 0;
  return AspisMedia.purgeExpired().length;
}

export function listMedia(): MediaFile[] {
  if (!MEDIA_SUPPORTED) return [];
  const hours = AspisMedia.getRetentionHours();
  return AspisMedia.list()
    .map((f) => parse(f, hours))
    .filter((m): m is MediaFile => m !== null)
    .sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export function findMedia(videoId: string, kind: MediaKind): MediaFile | null {
  return listMedia().find((m) => m.videoId === videoId && m.kind === kind) ?? null;
}

export function deleteMedia(videoId: string, kind?: MediaKind): void {
  if (!MEDIA_SUPPORTED) return;
  const kinds: MediaKind[] = kind ? [kind] : ['audio', 'video'];
  for (const k of kinds) {
    AspisMedia.delete(mediaBase(videoId, k));
    db.setMeta(positionKey(videoId, k), '0');
  }
}

export function deleteAllMedia(): void {
  if (!MEDIA_SUPPORTED) return;
  AspisMedia.deleteAll();
}

export async function downloadMedia(url: string, videoId: string, kind: MediaKind): Promise<MediaFile> {
  if (!MEDIA_SUPPORTED) throw new Error('Disponível só no Android por enquanto.');
  const base = mediaBase(videoId, kind);
  try {
    const f = await AspisMedia.download(url, kind, base);
    return parse(f, AspisMedia.getRetentionHours())!;
  } catch (e) {
    if (isCanceled(e)) throw e;
    // O YouTube muda e o yt-dlp envelhece: atualiza o motor e tenta de novo.
    const updated = await updateEngine(true).catch(() => null);
    if (updated?.status !== 'DONE') throw e;
    const f = await AspisMedia.download(url, kind, base);
    return parse(f, AspisMedia.getRetentionHours())!;
  }
}

export function cancelDownload(videoId: string, kind: MediaKind): void {
  if (MEDIA_SUPPORTED) AspisMedia.cancel(mediaBase(videoId, kind));
}

export function isCanceled(e: unknown): boolean {
  return (e as { code?: string })?.code === 'E_CANCELED';
}

export function onDownloadProgress(
  listener: (base: string, progress: number) => void,
): () => void {
  if (!MEDIA_SUPPORTED) return () => {};
  const sub = AspisMedia.addListener('onProgress', (e) => listener(e.base, e.progress));
  return () => sub.remove();
}

// Atualiza o yt-dlp no máximo 1×/dia (ou já, com force).
export async function updateEngine(
  force = false,
): Promise<{ status: string; version: string | null } | null> {
  if (!MEDIA_SUPPORTED) return null;
  const last = Number(db.getMeta(ENGINE_CHECK_KEY) || 0);
  if (!force && Date.now() - last < ENGINE_CHECK_EVERY_MS) return null;
  const res = await AspisMedia.updateEngine();
  db.setMeta(ENGINE_CHECK_KEY, String(Date.now()));
  return res;
}

export function engineVersion(): string | null {
  if (!MEDIA_SUPPORTED) return null;
  try {
    return AspisMedia.engineVersion();
  } catch {
    return null;
  }
}

// --- posição de reprodução (retomar de onde parou) --------------------------
const positionKey = (videoId: string, kind: MediaKind) => `media:pos:${videoId}:${kind}`;

export function getPosition(videoId: string, kind: MediaKind): number {
  return Number(db.getMeta(positionKey(videoId, kind)) || 0);
}

export function savePosition(videoId: string, kind: MediaKind, seconds: number): void {
  db.setMeta(positionKey(videoId, kind), String(Math.max(0, Math.floor(seconds))));
}

// --- formatação --------------------------------------------------------------
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "apaga em 3 dias" / "apaga em 5 h" / "apaga em breve"
export function expiresLabel(expiresAt: number, now = Date.now()): string {
  const hours = (expiresAt - now) / 3600000;
  if (hours <= 1) return 'apaga em breve';
  if (hours < 36) return `apaga em ${Math.round(hours)} h`;
  return `apaga em ${Math.round(hours / 24)} dias`;
}
