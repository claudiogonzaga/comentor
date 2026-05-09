export type Tone = 'gentle' | 'firm' | 'brutal';

export type GeminiModel = 'gemini-2.0-flash-lite' | 'gemini-2.0-flash';

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
