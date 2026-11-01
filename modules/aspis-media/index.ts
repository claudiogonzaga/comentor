// Ponte JS do módulo nativo AspisMedia (Android): yt-dlp embarcado para baixar
// áudio/vídeo temporários no armazenamento privado do app.
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface NativeMediaFile {
  name: string; // "<videoId>.<audio|video>.<ext>"
  uri: string; // file://…
  size: number; // bytes
  downloadedAt: number; // epoch ms (base do prazo de exclusão)
}

export interface ProgressEvent {
  base: string; // "<videoId>.<kind>"
  progress: number; // 0–100
  eta: number; // segundos
}

interface AspisMediaNative {
  list(): NativeMediaFile[];
  getRetentionHours(): number;
  setRetentionHours(hours: number): void;
  purgeExpired(): string[];
  delete(base: string): number;
  deleteAll(): number;
  download(url: string, kind: 'audio' | 'video', base: string): Promise<NativeMediaFile>;
  cancel(base: string): boolean;
  updateEngine(): Promise<{ status: string; version: string | null }>;
  engineVersion(): string | null;
  isUnmeteredNetwork(): boolean;

  // Transcrição no celular (Parakeet via sherpa-onnx)
  modelStatus(): ModelStatus;
  downloadModel(): Promise<boolean>;
  cancelModelDownload(): void;
  deleteModel(): void;
  transcribe(uri: string, id: string): Promise<NativeSegment[]>;
  cancelTranscription(id: string): void;
  releaseModel(): void;
  startKeepAlive(text: string): void;
  updateKeepAlive(text: string): void;
  stopKeepAlive(): void;

  addListener(event: 'onProgress', listener: (e: ProgressEvent) => void): EventSubscription;
  addListener(
    event: 'onModelProgress',
    listener: (e: { received: number; total: number }) => void,
  ): EventSubscription;
  addListener(
    event: 'onTranscribeProgress',
    listener: (e: { id: string; progress: number }) => void,
  ): EventSubscription;
}

export interface ModelStatus {
  installed: boolean;
  downloadedBytes: number;
  totalBytes: number;
  downloading: boolean;
}

export interface NativeSegment {
  start: number; // segundos
  end: number;
  text: string;
}

export default requireNativeModule<AspisMediaNative>('AspisMedia');
