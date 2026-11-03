// Ponte JS do módulo nativo KinesisTimer (Android): executa a linha do tempo do
// timer de pausas ativas com o app fechado (alarmes exatos, sinos, notificação).
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface KinesisNotif {
  title: string;
  text: string;
  /** Instante do relógio da notificação (epoch ms); 0 = sem relógio. */
  chronoTo: number;
  /** true = contagem regressiva até chronoTo; false = contando desde chronoTo. */
  chronoDown: boolean;
}

export interface KinesisEvent {
  at: number;
  sound: string | null;
  /** Três bipes nos 3 segundos antes de `at`. */
  beeps?: boolean;
  /** Novo conteúdo da notificação a partir de `at`. */
  notif?: KinesisNotif;
  vibrate?: boolean;
  /** Repete o evento a cada repeatMs, repeatLeft vezes mais. */
  repeatMs?: number;
  repeatLeft?: number;
  /** Fim do treino: a notificação some depois do som. */
  finish?: boolean;
}

export interface KinesisTimeline {
  current: KinesisNotif | null;
  events: KinesisEvent[];
}

interface KinesisTimerNative {
  arm(json: string): void;
  disarm(): void;
  play(sound: string): void;
  setVolume(volume: number): void;
}

// Opcional: sem o módulo (iOS, build antigo) a aba abre, só não toca com a tela apagada.
export default requireOptionalNativeModule<KinesisTimerNative>('KinesisTimer');
