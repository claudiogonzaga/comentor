// Ponte JS do módulo nativo ReadAloudAudio (Android): o áudio das leituras longas
// do "Leia para mim" gerado num serviço em primeiro plano e montado em disco.
// Ausente (iOS, web, build antigo) → null, e o app usa o caminho em JavaScript.
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type ReadAloudJobState = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface ReadAloudJobStatus {
  id: string;
  state: ReadAloudJobState;
  done: number;
  total: number;
  uri?: string | null;
  error?: string | null;
  dailyQuota?: boolean;
  tag?: string;
  voice?: string;
  title?: string;
  updatedAt?: number;
}

export interface ReadAloudJobSpec {
  id: string;
  chunks: string[];
  model: string;
  legacyModel: string;
  voice: string;
  legacyVoice: string;
  interactions: boolean;
  apiKey: string;
  /** Caminho do WAV final (sem file://). */
  outPath: string;
  /** Pasta dos trechos já prontos (retomada). */
  workDir: string;
  /** Liga o resultado a algo do app (ex.: "text:12", um texto salvo). */
  tag?: string;
  title?: string;
}

interface ReadAloudAudioNative {
  startJob(spec: ReadAloudJobSpec): boolean;
  isActive(id: string): boolean;
  jobStatus(id: string): ReadAloudJobStatus | null;
  jobs(): ReadAloudJobStatus[];
  forgetJob(id: string): void;
  cancelJob(id: string): void;
  concatWav(paths: string[], outPath: string): Promise<number>;
  addListener(event: 'onJob', listener: (e: ReadAloudJobStatus) => void): EventSubscription;
}

export default requireOptionalNativeModule<ReadAloudAudioNative>('ReadAloudAudio');
