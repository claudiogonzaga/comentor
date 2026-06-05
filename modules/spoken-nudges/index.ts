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
}

// Lança se o módulo nativo não estiver presente (ex.: Expo Go, web). Quem
// consome deve tratar (ver src/services/spokenNudges.ts).
export default requireNativeModule<SpokenNudgesNativeModule>('SpokenNudges');
