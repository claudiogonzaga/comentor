import { requireNativeModule } from 'expo-modules-core';

export interface SpokenNudgesNativeModule {
  /** Android 12+: o usuário permitiu alarmes exatos? (true em <12) */
  isExactAlarmAllowed(): boolean;
  /** Abre a tela do sistema para conceder alarme exato. */
  openExactAlarmSettings(): void;
  /** O app está isento de otimização de bateria? */
  isIgnoringBatteryOptimizations(): boolean;
  /** Abre o diálogo do sistema pedindo isenção de otimização de bateria. */
  requestIgnoreBatteryOptimizations(): void;
  /**
   * Agenda um alarme que, ao disparar (mesmo com app fechado/tela apagada),
   * inicia um foreground service que TOCA o WAV em `audioPath`.
   * @param atEpochMs horário (ms desde epoch). Se repeatDaily, é deslocado p/ o futuro.
   */
  schedule(
    id: string,
    atEpochMs: number,
    audioPath: string,
    repeatDaily: boolean,
    title: string,
    body: string,
  ): Promise<void>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  scheduledIds(): string[];
  /** Re-arma todos os alarmes persistidos (chamar no launch do app). */
  rearmAll(): Promise<void>;
  /** Pausa (s) entre o canto da coruja e a fala. */
  setOwlPauseSeconds(seconds: number): void;
  /** Último "Calar agora" (epoch ms; 0 = nunca). */
  getSilencedAt(): number;
  /** O usuário concedeu "Acesso ao uso"? */
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  openAppDetails(): void;
  // ---- hábitos rigorosos (vibram em pulsos até a resposta; ver src/services/strictHabits.ts) ----
  /** Lista dos rigorosos de uma fonte ('nudge' | 'med'), em JSON. */
  setStrictHabits(source: string, json: string): Promise<void>;
  /** Janelas de sono (minutos do dia) em que não vibra: [{start, end}]. */
  setStrictSleepWindows(json: string): void;
  /** O app marcou o hábito no dia `day`: para de insistir. */
  stopStrict(key: string, day: string): void;
  /** "Mais tempo" dado no app: volta a insistir em `untilEpochMs`. */
  snoozeStrict(key: string, untilEpochMs: number): void;
  /** Entrega e esvazia a fila de respostas dadas na notificação (JSON). */
  takeStrictAnswers(): string;
  /** Evento 'onStrictAnswer': há resposta na fila. */
  addListener(event: 'onStrictAnswer', listener: () => void): { remove(): void };
}

// Lança se o módulo nativo não estiver presente (ex.: Expo Go, web). Quem
// consome deve tratar (ver src/services/spokenNudges.ts).
export default requireNativeModule<SpokenNudgesNativeModule>('SpokenNudges');
