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
