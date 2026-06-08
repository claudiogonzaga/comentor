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
   * Quando true, os nudges/avisos/inspirações são FALADOS em voz alta (voz
   * Gemini pré-renderizada) mesmo com a tela apagada / app fechado, via um
   * alarme exato + foreground service nativo. Requer chave Gemini configurada.
   */
  spokenNudgesEnabled: boolean;
  /**
   * Só falar os avisos em voz alta quando houver FONE de ouvido conectado
   * (com fio, Bluetooth ou USB). Útil pra não tocar no alto-falante em público.
   * Independente disso, quando há fone conectado o áudio SEMPRE sai pelo fone
   * (roteado como mídia), nunca pelo alto-falante.
   */
  spokenHeadphonesOnly: boolean;
  /**
   * Modo "inspiração": quando true, a Comentora envia alertas de hora em hora
   * (janela diurna) com mensagens de otimismo, persistência e inspiração.
   */
  inspirationModeEnabled: boolean;
  /** Quantas mensagens de inspiração por dia (espalhadas na janela diurna). */
  inspirationPerDay: number;
  /**
   * Som de fundo do exercício de respiração: id de uma trilha embutida
   * ('cello' | 'piano' | 'organ') ou 'custom' para um áudio que o usuário
   * subiu (cujo caminho fica em `breathingSoundUri`).
   */
  breathingSoundId: string;
  /** file:// do áudio próprio do usuário, quando `breathingSoundId === 'custom'`. */
  breathingSoundUri: string | null;
  /** Nome dado pelo usuário ao seu áudio próprio (exibido na lista de sons). */
  breathingSoundName: string | null;
  /** Duração desejada do exercício de respiração, em minutos (vira nº de ciclos). */
  breathingDurationMinutes: number;
  /**
   * Voz do sistema usada na tela "Leia para mim" (independente da voz do chat).
   * null = automática (melhor pt-* disponível).
   */
  readAloudVoiceId: string | null;
  readAloudVoiceLanguage: string | null;
  /** Provedor de voz da leitura (system/gemini) — independente do chat. */
  readAloudProvider: VoiceProvider;
  /** Voz Gemini usada na leitura quando o provedor é 'gemini'. */
  readAloudGeminiVoice: string;
  /** Velocidade da leitura (sistema E Gemini). 1.0 = normal. <1 = mais lento. */
  readAloudRate: number;
  /**
   * Leitura PAUSADA (visualização / auto-hipnose): insere uma pequena pausa
   * entre as frases, deixando a leitura mais lenta e meditativa.
   */
  readAloudPaused: boolean;
  /** Nudge de "trabalho sentado": lembra de levantar e mover durante o expediente. */
  sedentaryEnabled: boolean;
  /** Dias com trabalho sentado (0=domingo … 6=sábado, CSV). */
  sedentaryDays: number[];
  /** Início da janela de trabalho sentado (HH:MM). */
  sedentaryStart: string;
  /** Fim da janela de trabalho sentado (HH:MM). */
  sedentaryEnd: string;
  /** Intervalo entre os lembretes de levantar, em minutos. */
  sedentaryIntervalMin: number;
}

/** Texto salvo na tela "Leia para mim" (visualização, oração, hipnose…). */
export interface ReadAloudText {
  id: number;
  title: string;
  content: string;
  /** file:// do áudio Gemini guardado para este texto (null = ainda não gerado). */
  audioUri: string | null;
  /** Voz Gemini usada no áudio guardado. */
  audioVoice: string | null;
  updatedAt: string;
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

/**
 * Lembrete de medicamento/suplemento definido pelo usuário. Insiste
 * (corrente verify-until-confirmed) até a pessoa marcar que tomou.
 */
export interface Medication {
  id: number;
  name: string;
  dosage: string | null;
  time: string; // HH:MM
  emoji: string | null;
  enabled: boolean;
  orderIndex: number;
  /**
   * Dias da semana em que o lembrete dispara (0=domingo … 6=sábado, igual a
   * Date.getDay()). Os 7 dias = diário (padrão). Subconjunto = semanal em
   * dias específicos (ex.: [2, 4] = terça e quinta).
   */
  daysOfWeek: number[];
}
