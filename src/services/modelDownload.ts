// Gerencia download e armazenamento dos modelos GGUF locais.
//
// Usa createDownloadResumable do expo-file-system pra suportar pause/resume
// (importante: arquivos de 2.5-5 GB não cabem numa única sessão sem interrupção).
// Verifica via NetInfo se está em Wi-Fi antes de iniciar — falha com erro
// específico se estiver em dados móveis e o usuário não autorizou.

import * as FileSystem from 'expo-file-system/legacy';
import NetInfo from '@react-native-community/netinfo';
import { LOCAL_MODELS } from '../constants/models';
import type { LocalModelId, LocalModelInfo } from '../types';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;

export interface DownloadProgress {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  fraction: number;
}

export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export class MobileDataNotAllowedError extends Error {
  constructor() {
    super('mobile-data-not-allowed');
    this.name = 'MobileDataNotAllowedError';
  }
}

async function ensureModelsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

export function getModelLocalPath(modelId: LocalModelId): string {
  const model = LOCAL_MODELS[modelId];
  return `${MODELS_DIR}${model.fileName}`;
}

export async function isModelDownloaded(modelId: LocalModelId): Promise<boolean> {
  const path = getModelLocalPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists && !info.isDirectory && (info.size ?? 0) > 0;
}

export async function getDownloadedModelSize(modelId: LocalModelId): Promise<number> {
  const path = getModelLocalPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory) return 0;
  return info.size ?? 0;
}

export async function deleteDownloadedModel(modelId: LocalModelId): Promise<void> {
  const path = getModelLocalPath(modelId);
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
}

export async function deleteAllDownloadedModels(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (info.exists) {
    await FileSystem.deleteAsync(MODELS_DIR, { idempotent: true });
  }
}

interface ConnectionCheck {
  isConnected: boolean;
  isWifi: boolean;
}

export async function checkConnection(): Promise<ConnectionCheck> {
  const state = await NetInfo.fetch();
  return {
    isConnected: !!state.isConnected,
    isWifi: state.type === 'wifi',
  };
}

interface DownloadHandle {
  cancel(): Promise<void>;
  promise: Promise<LocalModelInfo>;
}

export async function startModelDownload(
  modelId: LocalModelId,
  options: {
    allowMobileData: boolean;
    onProgress?: DownloadProgressCallback;
  },
): Promise<DownloadHandle> {
  const conn = await checkConnection();
  if (!conn.isConnected) {
    throw new Error('Sem conexão com a internet.');
  }
  if (!conn.isWifi && !options.allowMobileData) {
    throw new MobileDataNotAllowedError();
  }

  await ensureModelsDir();

  const model = LOCAL_MODELS[modelId];
  const localPath = getModelLocalPath(modelId);

  // Se já existe parcial/completo, deletamos pra começar limpo. (Resumo robusto
  // de uploads parciais via Range header não é trivial com expo-file-system —
  // pra v1, restart é mais seguro.)
  const existing = await FileSystem.getInfoAsync(localPath);
  if (existing.exists) {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  }

  const resumable = FileSystem.createDownloadResumable(
    model.downloadUrl,
    localPath,
    {},
    (downloadProgress) => {
      if (!options.onProgress) return;
      const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
      const expected = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : model.sizeBytes;
      options.onProgress({
        totalBytesWritten,
        totalBytesExpectedToWrite: expected,
        fraction: expected > 0 ? Math.min(1, totalBytesWritten / expected) : 0,
      });
    },
  );

  const promise = (async () => {
    const result = await resumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error('Download falhou (sem resultado).');
    }
    const info = await FileSystem.getInfoAsync(result.uri);
    if (!info.exists || (info.size ?? 0) < 100_000) {
      throw new Error('Arquivo baixado parece corrompido ou vazio.');
    }
    return model;
  })();

  return {
    cancel: async () => {
      try {
        await resumable.pauseAsync();
      } catch {
        /* noop */
      }
      await FileSystem.deleteAsync(localPath, { idempotent: true });
    },
    promise,
  };
}
