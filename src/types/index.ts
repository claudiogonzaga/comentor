export type Tone = 'gentle' | 'firm' | 'brutal';

export type GeminiModel =
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.1-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-flash'
  | 'gemini-2.0-flash-lite'
  | 'gemini-2.0-flash';

export type AIBackend = 'remote' | 'local';

export type LocalModelId =
  | 'gemma-4-e4b'
  | 'qwen3-4b-thinking-2507'
  | 'qwen3.5-4b';

export type LocalChatTemplate = 'gemma' | 'chatml';

export interface LocalModelInfo {
  id: LocalModelId;
  label: string;
  vendor: string;
  description: string;
  downloadUrl: string;
  fileName: string;
  sizeBytes: number;
  contextWindow: number;
  hasThinking: boolean;
  chatTemplate: LocalChatTemplate;
}

export type OwlMood = 'calm' | 'worried' | 'serious' | 'sleeping' | 'celebrating';

export type OwlSpeciesId =
  | 'buraqueira'
  | 'corujinha_mato'
  | 'bubo_bubo'
  | 'default';

/**
 * Provider de TTS. `system` usa expo-speech (vozes do Android, grátis mas
 * pobres em pt-BR). `gemini` usa a API gemini-2.5-flash-preview-tts —
 * voz neural muito superior, mas consome cota da API key configurada.
 */
export type VoiceProvider = 'system' | 'gemini';

export type IntensityLevel = 1 | 2 | 3 | 4 | 5;

export type HabitType = 'sleep' | 'reading' | 'exercise' | 'custom';

export type ChatRole = 'corujinha' | 'user';

export interface UserConfig {
  id: number;
  name: string | null;
  bedtime: string;
  reminderIntervalMinutes: number;
  maxReminders: number;
  tone: Tone;
  geminiModel: GeminiModel;
  hasApiKey: boolean;
  onboardingDone: boolean;
  systemPrompt: string;
  prepRemindersEnabled: boolean;
  voiceModeEnabled: boolean;
  aiBackend: AIBackend;
  localModelId: LocalModelId | null;
  localModelDownloaded: boolean;
  allowMobileDataDownload: boolean;
  interviewCompletedAt: string | null;
  voiceId: string | null;
  voiceLanguage: string | null;
  /** Provider de TTS ativo. `system` é o default; `gemini` consome cota. */
  voiceProvider: VoiceProvider;
  /** Nome da voz Gemini pré-construída (Aoede, Charon, Kore, ...). */
  geminiVoiceName: string;
  owlSpecies: OwlSpeciesId;
  sleepAwarenessEnabled: boolean;
  /** Quantos lembretes da Comentora por dia (a densidade dobra após o pôr do sol). */
  notificationsPerDay: number;
  /**
   * Quando true, a coruja usa um canal que atravessa o "Não Perturbe": ela
   * apenas vibra (padrão do canto da coruja), sem tocar som. Requer que o
   * usuário conceda "acesso ao Não Perturbe" nas configurações do sistema.
   */
  dndBypassEnabled: boolean;
  /**
   * Quando true e o app está em primeiro plano (sem áudio tocando/gravando),
   * a Comentora também FALA o nudge por voz (TTS), além de mostrar o texto.
   */
  voiceNudgesEnabled: boolean;
  /**
   * Modo "inspiração": quando true, a Comentora envia alertas de hora em hora
   * (janela diurna) com mensagens de otimismo, persistência e inspiração.
   */
  inspirationModeEnabled: boolean;
}

export interface InterviewSummary {
  causes: string[];
  triggers: string[];
  notes: string;
  derivedReasons: string[];
}

export interface Interview {
  id: number;
  habitId: number | null;
  status: 'in_progress' | 'completed';
  summary: InterviewSummary | null;
  createdAt: string;
  completedAt: string | null;
}

export interface InterviewMessage {
  id: number;
  interviewId: number;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface SnoozeFeedback {
  id: number;
  habitId: number;
  logId: number | null;
  snoozeMinutes: number;
  reason: string | null;
  customText: string | null;
  createdAt: string;
}

export interface Habit {
  id: number;
  type: HabitType;
  name: string;
  target: string;
  daysOfWeek: string;
  reminderTime: string;
  isActive: boolean;
}

export interface DailyLog {
  id: number;
  habitId: number;
  date: string;
  targetTime: string;
  actualTime: string | null;
  remindersSent: number;
  remindersDismissed: number;
  completed: boolean;
  notes: string | null;
}

export interface ChatMessage {
  id: number;
  habitId: number;
  role: ChatRole;
  content: string;
  intensityLevel: IntensityLevel | null;
  createdAt: string;
}

export interface Streak {
  id: number;
  habitId: number;
  currentStreak: number;
  bestStreak: number;
  lastCompletedDate: string | null;
}

export type NudgeType =
  | 'supplements'
  | 'bluelight'
  | 'breathing'
  | string; // forward-compat for custom user-defined nudges

export interface Nudge {
  id: number;
  type: NudgeType;
  title: string;
  body: string;
  emoji: string | null;
  enabled: boolean;
  scheduleTime: string; // HH:MM
  orderIndex: number;
}
