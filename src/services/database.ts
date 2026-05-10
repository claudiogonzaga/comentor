import * as SQLite from 'expo-sqlite';
import type {
  AIBackend,
  ChatMessage,
  DailyLog,
  Habit,
  HabitType,
  IntensityLevel,
  Interview,
  InterviewMessage,
  InterviewSummary,
  LocalModelId,
  SnoozeFeedback,
  Streak,
  Tone,
  UserConfig,
  GeminiModel,
  ChatRole,
} from '../types';
import { DEFAULT_SYSTEM_PROMPT, LEGACY_DEFAULT_PROMPT_MARKER } from '../constants/promptTemplate';

const DB_NAME = 'comentor.db';
let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    await runMigrations(db);
  }
  return db;
}

async function runMigrations(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS user_config (
      id INTEGER PRIMARY KEY,
      name TEXT,
      bedtime TEXT NOT NULL DEFAULT '23:00',
      reminder_interval_minutes INTEGER NOT NULL DEFAULT 10,
      max_reminders INTEGER NOT NULL DEFAULT 12,
      tone TEXT NOT NULL DEFAULT 'firm',
      gemini_model TEXT NOT NULL DEFAULT 'gemini-3.1-flash-lite',
      has_api_key INTEGER NOT NULL DEFAULT 0,
      onboarding_done INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT,
      prep_reminders_enabled INTEGER NOT NULL DEFAULT 1,
      voice_mode_enabled INTEGER NOT NULL DEFAULT 1,
      ai_backend TEXT NOT NULL DEFAULT 'remote',
      local_model_id TEXT,
      local_model_downloaded INTEGER NOT NULL DEFAULT 0,
      allow_mobile_data_download INTEGER NOT NULL DEFAULT 0,
      interview_completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'in_progress',
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS interview_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snooze_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      log_id INTEGER REFERENCES daily_log(id) ON DELETE CASCADE,
      snooze_minutes INTEGER NOT NULL DEFAULT 15,
      reason TEXT,
      custom_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_interview_messages ON interview_messages(interview_id, id);
    CREATE INDEX IF NOT EXISTS idx_snooze_feedback ON snooze_feedback(habit_id, created_at);

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      target TEXT,
      days_of_week TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
      reminder_time TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      target_time TEXT,
      actual_time TEXT,
      reminders_sent INTEGER NOT NULL DEFAULT 0,
      reminders_dismissed INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, date)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      intensity_level INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS streaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL UNIQUE REFERENCES habits(id) ON DELETE CASCADE,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_completed_date TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_daily_log_habit_date ON daily_log(habit_id, date);
    CREATE INDEX IF NOT EXISTS idx_chat_habit ON chat_messages(habit_id, created_at);
  `);

  // Defensive migrations: add columns if missing (older installs).
  const cols = await database.getAllAsync<{ name: string }>(
    "PRAGMA table_info('user_config')",
  );
  const colNames = cols.map((c) => c.name);
  if (!colNames.includes('system_prompt')) {
    await database.execAsync(`ALTER TABLE user_config ADD COLUMN system_prompt TEXT`);
  }
  if (!colNames.includes('prep_reminders_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN prep_reminders_enabled INTEGER NOT NULL DEFAULT 1`,
    );
  }
  if (!colNames.includes('voice_mode_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN voice_mode_enabled INTEGER NOT NULL DEFAULT 1`,
    );
  }
  if (!colNames.includes('ai_backend')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN ai_backend TEXT NOT NULL DEFAULT 'remote'`,
    );
  }
  if (!colNames.includes('local_model_id')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN local_model_id TEXT`,
    );
  }
  if (!colNames.includes('local_model_downloaded')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN local_model_downloaded INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('allow_mobile_data_download')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN allow_mobile_data_download INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('interview_completed_at')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN interview_completed_at TEXT`,
    );
  }

  const existing = await database.getFirstAsync<{ id: number; system_prompt: string | null }>(
    'SELECT id, system_prompt FROM user_config WHERE id = 1',
  );
  if (!existing) {
    await database.runAsync(
      `INSERT INTO user_config (id, bedtime, reminder_interval_minutes, max_reminders, tone, gemini_model, has_api_key, onboarding_done, system_prompt, prep_reminders_enabled, voice_mode_enabled)
       VALUES (1, '23:00', 10, 12, 'firm', 'gemini-3.1-flash-lite', 0, 0, ?, 1, 1)`,
      [DEFAULT_SYSTEM_PROMPT],
    );
  } else if (!existing.system_prompt) {
    await database.runAsync(`UPDATE user_config SET system_prompt = ? WHERE id = 1`, [
      DEFAULT_SYSTEM_PROMPT,
    ]);
  } else if (existing.system_prompt.startsWith(LEGACY_DEFAULT_PROMPT_MARKER)) {
    // v1.2 migration: user is still on the legacy v1.0/v1.1 default prompt
    // (didn't customize it). Replace with the new "coach noturna" default.
    // Customized prompts are left untouched.
    await database.runAsync(`UPDATE user_config SET system_prompt = ? WHERE id = 1`, [
      DEFAULT_SYSTEM_PROMPT,
    ]);
  }
}

interface UserConfigRow {
  id: number;
  name: string | null;
  bedtime: string;
  reminder_interval_minutes: number;
  max_reminders: number;
  tone: string;
  gemini_model: string;
  has_api_key: number;
  onboarding_done: number;
  system_prompt: string | null;
  prep_reminders_enabled: number;
  voice_mode_enabled: number;
  ai_backend: string | null;
  local_model_id: string | null;
  local_model_downloaded: number;
  allow_mobile_data_download: number;
  interview_completed_at: string | null;
}

const rowToUserConfig = (r: UserConfigRow): UserConfig => ({
  id: r.id,
  name: r.name,
  bedtime: r.bedtime,
  reminderIntervalMinutes: r.reminder_interval_minutes,
  maxReminders: r.max_reminders,
  tone: r.tone as Tone,
  geminiModel: r.gemini_model as GeminiModel,
  hasApiKey: r.has_api_key === 1,
  onboardingDone: r.onboarding_done === 1,
  systemPrompt: r.system_prompt ?? DEFAULT_SYSTEM_PROMPT,
  prepRemindersEnabled: r.prep_reminders_enabled === 1,
  voiceModeEnabled: r.voice_mode_enabled === 1,
  aiBackend: (r.ai_backend ?? 'remote') as AIBackend,
  localModelId: (r.local_model_id ?? null) as LocalModelId | null,
  localModelDownloaded: r.local_model_downloaded === 1,
  allowMobileDataDownload: r.allow_mobile_data_download === 1,
  interviewCompletedAt: r.interview_completed_at,
});

export async function getUserConfig(): Promise<UserConfig> {
  const d = await getDb();
  const row = await d.getFirstAsync<UserConfigRow>('SELECT * FROM user_config WHERE id = 1');
  if (!row) throw new Error('User config row missing');
  return rowToUserConfig(row);
}

export async function updateUserConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
  const d = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  const map: Record<keyof UserConfig, string> = {
    id: 'id',
    name: 'name',
    bedtime: 'bedtime',
    reminderIntervalMinutes: 'reminder_interval_minutes',
    maxReminders: 'max_reminders',
    tone: 'tone',
    geminiModel: 'gemini_model',
    hasApiKey: 'has_api_key',
    onboardingDone: 'onboarding_done',
    systemPrompt: 'system_prompt',
    prepRemindersEnabled: 'prep_reminders_enabled',
    voiceModeEnabled: 'voice_mode_enabled',
    aiBackend: 'ai_backend',
    localModelId: 'local_model_id',
    localModelDownloaded: 'local_model_downloaded',
    allowMobileDataDownload: 'allow_mobile_data_download',
    interviewCompletedAt: 'interview_completed_at',
  };

  Object.entries(patch).forEach(([k, v]) => {
    if (k === 'id') return;
    const col = map[k as keyof UserConfig];
    if (!col) return;
    fields.push(`${col} = ?`);
    if (typeof v === 'boolean') values.push(v ? 1 : 0);
    else values.push((v as string | number | null) ?? null);
  });

  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    await d.runAsync(`UPDATE user_config SET ${fields.join(', ')} WHERE id = 1`, values);
  }
  return getUserConfig();
}

interface HabitRow {
  id: number;
  type: string;
  name: string;
  target: string | null;
  days_of_week: string;
  reminder_time: string | null;
  is_active: number;
}

const rowToHabit = (r: HabitRow): Habit => ({
  id: r.id,
  type: r.type as HabitType,
  name: r.name,
  target: r.target ?? '',
  daysOfWeek: r.days_of_week,
  reminderTime: r.reminder_time ?? '',
  isActive: r.is_active === 1,
});

export async function getActiveHabits(): Promise<Habit[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<HabitRow>(
    'SELECT * FROM habits WHERE is_active = 1 ORDER BY id ASC',
  );
  return rows.map(rowToHabit);
}

export async function getHabitByType(type: HabitType): Promise<Habit | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<HabitRow>(
    'SELECT * FROM habits WHERE type = ? AND is_active = 1 LIMIT 1',
    [type],
  );
  return row ? rowToHabit(row) : null;
}

export async function upsertHabit(habit: Omit<Habit, 'id' | 'isActive'> & { isActive?: boolean }) {
  const d = await getDb();
  const existing = await d.getFirstAsync<HabitRow>(
    'SELECT * FROM habits WHERE type = ? LIMIT 1',
    [habit.type],
  );
  if (existing) {
    await d.runAsync(
      `UPDATE habits SET name = ?, target = ?, days_of_week = ?, reminder_time = ?, is_active = ? WHERE id = ?`,
      [
        habit.name,
        habit.target,
        habit.daysOfWeek,
        habit.reminderTime,
        habit.isActive === false ? 0 : 1,
        existing.id,
      ],
    );
    return existing.id;
  }
  const result = await d.runAsync(
    `INSERT INTO habits (type, name, target, days_of_week, reminder_time, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      habit.type,
      habit.name,
      habit.target,
      habit.daysOfWeek,
      habit.reminderTime,
      habit.isActive === false ? 0 : 1,
    ],
  );
  return result.lastInsertRowId as number;
}

interface DailyLogRow {
  id: number;
  habit_id: number;
  date: string;
  target_time: string | null;
  actual_time: string | null;
  reminders_sent: number;
  reminders_dismissed: number;
  completed: number;
  notes: string | null;
}

const rowToLog = (r: DailyLogRow): DailyLog => ({
  id: r.id,
  habitId: r.habit_id,
  date: r.date,
  targetTime: r.target_time ?? '',
  actualTime: r.actual_time,
  remindersSent: r.reminders_sent,
  remindersDismissed: r.reminders_dismissed,
  completed: r.completed === 1,
  notes: r.notes,
});

export async function getOrCreateLog(habitId: number, date: string, targetTime: string) {
  const d = await getDb();
  const existing = await d.getFirstAsync<DailyLogRow>(
    'SELECT * FROM daily_log WHERE habit_id = ? AND date = ?',
    [habitId, date],
  );
  if (existing) return rowToLog(existing);
  const result = await d.runAsync(
    'INSERT INTO daily_log (habit_id, date, target_time) VALUES (?, ?, ?)',
    [habitId, date, targetTime],
  );
  const created = await d.getFirstAsync<DailyLogRow>('SELECT * FROM daily_log WHERE id = ?', [
    result.lastInsertRowId as number,
  ]);
  return rowToLog(created!);
}

export async function markLogCompleted(logId: number, actualTime: string) {
  const d = await getDb();
  await d.runAsync(
    'UPDATE daily_log SET completed = 1, actual_time = ? WHERE id = ?',
    [actualTime, logId],
  );
}

export async function incrementReminders(logId: number, dismissed = false) {
  const d = await getDb();
  if (dismissed) {
    await d.runAsync(
      'UPDATE daily_log SET reminders_sent = reminders_sent + 1, reminders_dismissed = reminders_dismissed + 1 WHERE id = ?',
      [logId],
    );
  } else {
    await d.runAsync('UPDATE daily_log SET reminders_sent = reminders_sent + 1 WHERE id = ?', [
      logId,
    ]);
  }
}

export async function getRecentLogs(habitId: number, days: number): Promise<DailyLog[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<DailyLogRow>(
    `SELECT * FROM daily_log WHERE habit_id = ? ORDER BY date DESC LIMIT ?`,
    [habitId, days],
  );
  return rows.map(rowToLog);
}

interface StreakRow {
  id: number;
  habit_id: number;
  current_streak: number;
  best_streak: number;
  last_completed_date: string | null;
}

const rowToStreak = (r: StreakRow): Streak => ({
  id: r.id,
  habitId: r.habit_id,
  currentStreak: r.current_streak,
  bestStreak: r.best_streak,
  lastCompletedDate: r.last_completed_date,
});

export async function getStreak(habitId: number): Promise<Streak> {
  const d = await getDb();
  const row = await d.getFirstAsync<StreakRow>('SELECT * FROM streaks WHERE habit_id = ?', [
    habitId,
  ]);
  if (row) return rowToStreak(row);
  await d.runAsync('INSERT INTO streaks (habit_id) VALUES (?)', [habitId]);
  return getStreak(habitId);
}

export async function setStreak(
  habitId: number,
  current: number,
  best: number,
  lastDate: string,
) {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO streaks (habit_id, current_streak, best_streak, last_completed_date, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(habit_id) DO UPDATE SET
       current_streak = excluded.current_streak,
       best_streak = excluded.best_streak,
       last_completed_date = excluded.last_completed_date,
       updated_at = datetime('now')`,
    [habitId, current, best, lastDate],
  );
}

interface ChatRow {
  id: number;
  habit_id: number;
  role: string;
  content: string;
  intensity_level: number | null;
  created_at: string;
}

const rowToChat = (r: ChatRow): ChatMessage => ({
  id: r.id,
  habitId: r.habit_id,
  role: r.role as ChatRole,
  content: r.content,
  intensityLevel: r.intensity_level as IntensityLevel | null,
  createdAt: r.created_at,
});

export async function addChatMessage(
  habitId: number,
  role: ChatRole,
  content: string,
  intensityLevel: IntensityLevel | null = null,
) {
  const d = await getDb();
  const result = await d.runAsync(
    'INSERT INTO chat_messages (habit_id, role, content, intensity_level) VALUES (?, ?, ?, ?)',
    [habitId, role, content, intensityLevel],
  );
  return result.lastInsertRowId as number;
}

export async function getRecentChat(habitId: number, limit = 20): Promise<ChatMessage[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<ChatRow>(
    'SELECT * FROM chat_messages WHERE habit_id = ? ORDER BY id DESC LIMIT ?',
    [habitId, limit],
  );
  return rows.map(rowToChat).reverse();
}

export async function clearChat(habitId: number) {
  const d = await getDb();
  await d.runAsync('DELETE FROM chat_messages WHERE habit_id = ?', [habitId]);
}

interface InterviewRow {
  id: number;
  habit_id: number | null;
  status: string;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
}

const rowToInterview = (r: InterviewRow): Interview => ({
  id: r.id,
  habitId: r.habit_id,
  status: r.status as Interview['status'],
  summary: (() => {
    if (!r.summary) return null;
    try {
      return JSON.parse(r.summary) as InterviewSummary;
    } catch {
      return null;
    }
  })(),
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

export async function createInterview(habitId: number | null): Promise<number> {
  const d = await getDb();
  const result = await d.runAsync(
    `INSERT INTO interviews (habit_id, status) VALUES (?, 'in_progress')`,
    [habitId],
  );
  return result.lastInsertRowId as number;
}

export async function addInterviewMessage(
  interviewId: number,
  role: ChatRole,
  content: string,
): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO interview_messages (interview_id, role, content) VALUES (?, ?, ?)`,
    [interviewId, role, content],
  );
}

interface InterviewMessageRow {
  id: number;
  interview_id: number;
  role: string;
  content: string;
  created_at: string;
}

export async function getInterviewMessages(interviewId: number): Promise<InterviewMessage[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<InterviewMessageRow>(
    `SELECT * FROM interview_messages WHERE interview_id = ? ORDER BY id ASC`,
    [interviewId],
  );
  return rows.map((r) => ({
    id: r.id,
    interviewId: r.interview_id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export async function completeInterview(
  interviewId: number,
  summary: InterviewSummary,
): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `UPDATE interviews SET status = 'completed', summary = ?, completed_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(summary), interviewId],
  );
}

export async function getLatestCompletedInterview(): Promise<Interview | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<InterviewRow>(
    `SELECT * FROM interviews WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
  );
  return row ? rowToInterview(row) : null;
}

interface SnoozeFeedbackRow {
  id: number;
  habit_id: number;
  log_id: number | null;
  snooze_minutes: number;
  reason: string | null;
  custom_text: string | null;
  created_at: string;
}

export async function addSnoozeFeedback(
  habitId: number,
  logId: number | null,
  snoozeMinutes: number,
  reason: string | null,
  customText: string | null,
): Promise<number> {
  const d = await getDb();
  const result = await d.runAsync(
    `INSERT INTO snooze_feedback (habit_id, log_id, snooze_minutes, reason, custom_text) VALUES (?, ?, ?, ?, ?)`,
    [habitId, logId, snoozeMinutes, reason, customText],
  );
  return result.lastInsertRowId as number;
}

export async function getRecentSnoozeFeedback(
  habitId: number,
  limit = 5,
): Promise<SnoozeFeedback[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<SnoozeFeedbackRow>(
    `SELECT * FROM snooze_feedback WHERE habit_id = ? ORDER BY id DESC LIMIT ?`,
    [habitId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    habitId: r.habit_id,
    logId: r.log_id,
    snoozeMinutes: r.snooze_minutes,
    reason: r.reason,
    customText: r.custom_text,
    createdAt: r.created_at,
  }));
}

export async function resetAllUserData(): Promise<void> {
  const d = await getDb();
  await d.execAsync(`
    DELETE FROM snooze_feedback;
    DELETE FROM interview_messages;
    DELETE FROM interviews;
    DELETE FROM chat_messages;
    DELETE FROM streaks;
    DELETE FROM daily_log;
    DELETE FROM habits;
    DELETE FROM user_config WHERE id = 1;
  `);
  await d.runAsync(
    `INSERT INTO user_config (id, bedtime, reminder_interval_minutes, max_reminders, tone, gemini_model, has_api_key, onboarding_done, system_prompt, prep_reminders_enabled, voice_mode_enabled, ai_backend, local_model_downloaded, allow_mobile_data_download)
     VALUES (1, '23:00', 10, 12, 'firm', 'gemini-3.1-flash-lite', 0, 0, ?, 1, 1, 'remote', 0, 0)`,
    [DEFAULT_SYSTEM_PROMPT],
  );
}
