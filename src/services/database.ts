import * as SQLite from 'expo-sqlite';
import { File } from 'expo-file-system';
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
  BreathingCustomSound,
  Medication,
  Nudge,
  NudgeType,
  ReadAloudText,
  SnoozeFeedback,
  Streak,
  Tone,
  UserConfig,
  GeminiModel,
  ChatRole,
} from '../types';
import { DEFAULT_SYSTEM_PROMPT, LEGACY_DEFAULT_PROMPT_MARKER } from '../constants/promptTemplate';

const DB_NAME = 'comentor.db';
// Cacheia a Promise (não a instância) — chamadas concorrentes durante o boot
// esperam o mesmo init em vez de cada uma abrir o DB e rodar runMigrations,
// o que disparava UNIQUE constraint failed no seed do user_config.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync(DB_NAME);
      await d.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await runMigrations(d);
      return d;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
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
      gemini_model TEXT NOT NULL DEFAULT 'gemini-2.5-flash-lite',
      has_api_key INTEGER NOT NULL DEFAULT 0,
      onboarding_done INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT,
      prep_reminders_enabled INTEGER NOT NULL DEFAULT 1,
      voice_mode_enabled INTEGER NOT NULL DEFAULT 0,
      owl_species TEXT NOT NULL DEFAULT 'buraqueira',
      sleep_awareness_enabled INTEGER NOT NULL DEFAULT 1,
      notifications_per_day INTEGER NOT NULL DEFAULT 4,
      voice_provider TEXT NOT NULL DEFAULT 'system',
      gemini_voice_name TEXT NOT NULL DEFAULT 'Aoede',
      dnd_bypass_enabled INTEGER NOT NULL DEFAULT 0,
      voice_nudges_enabled INTEGER NOT NULL DEFAULT 0,
      spoken_nudges_enabled INTEGER NOT NULL DEFAULT 0,
      spoken_headphones_only INTEGER NOT NULL DEFAULT 0,
      spoken_quiet_enabled INTEGER NOT NULL DEFAULT 0,
      spoken_quiet_start TEXT NOT NULL DEFAULT '09:00',
      spoken_quiet_end TEXT NOT NULL DEFAULT '18:00',
      spoken_quiet_days INTEGER NOT NULL DEFAULT 127,
      inspiration_mode_enabled INTEGER NOT NULL DEFAULT 0,
      ai_backend TEXT NOT NULL DEFAULT 'remote',
      local_model_id TEXT,
      local_model_downloaded INTEGER NOT NULL DEFAULT 0,
      allow_mobile_data_download INTEGER NOT NULL DEFAULT 0,
      interview_completed_at TEXT,
      voice_id TEXT,
      voice_language TEXT,
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

    CREATE TABLE IF NOT EXISTS nudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      emoji TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      schedule_time TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- v1.19: registra que o usuário confirmou ter feito um comportamento
    -- (ex.: tomou suplemento, colocou óculos) num dia. Enquanto não houver
    -- registro do dia, a coruja insiste com a corrente de lembretes.
    CREATE TABLE IF NOT EXISTS nudge_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nudge_type TEXT NOT NULL,
      date TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(nudge_type, date)
    );

    -- v1.21: lembretes de medicamentos/suplementos definidos pelo usuário.
    -- A pessoa adiciona quantos quiser; cada um insiste (corrente
    -- verify-until-confirmed) até ela marcar que tomou. Reusa
    -- nudge_completions com a chave 'med:<id>' para registrar o dia feito.
    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dosage TEXT,
      time TEXT NOT NULL,
      emoji TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      days_of_week TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- v1.22: armazenamento chave/valor leve para estado de UI persistente
    -- (ex.: a última notificação exibida, mostrada no card da Home).
    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  if (!colNames.includes('voice_id')) {
    await database.execAsync(`ALTER TABLE user_config ADD COLUMN voice_id TEXT`);
  }
  if (!colNames.includes('voice_language')) {
    await database.execAsync(`ALTER TABLE user_config ADD COLUMN voice_language TEXT`);
  }
  // v1.6: owl notification sounds + chat voice off by default.
  // Adding owl_species is a one-time event for existing installs, so we use it
  // as the trigger to also force voice mode off (the chat now shows text only
  // unless the user explicitly turns the sound on).
  if (!colNames.includes('owl_species')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN owl_species TEXT NOT NULL DEFAULT 'buraqueira'`,
    );
    await database.execAsync(`UPDATE user_config SET voice_mode_enabled = 0`);
  }
  if (!colNames.includes('sleep_awareness_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN sleep_awareness_enabled INTEGER NOT NULL DEFAULT 1`,
    );
  }
  if (!colNames.includes('notifications_per_day')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN notifications_per_day INTEGER NOT NULL DEFAULT 4`,
    );
  }
  if (!colNames.includes('voice_provider')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN voice_provider TEXT NOT NULL DEFAULT 'system'`,
    );
  }
  if (!colNames.includes('gemini_voice_name')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN gemini_voice_name TEXT NOT NULL DEFAULT 'Aoede'`,
    );
  }
  if (!colNames.includes('dnd_bypass_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN dnd_bypass_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('voice_nudges_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN voice_nudges_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('inspiration_mode_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN inspiration_mode_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  // v1.30: quantas mensagens de inspiração por dia (antes: uma por hora fixa).
  if (!colNames.includes('inspiration_per_day')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN inspiration_per_day INTEGER NOT NULL DEFAULT 6`,
    );
  }
  // v1.24: som de fundo do exercício de respiração (trilha embutida ou áudio
  // próprio do usuário).
  if (!colNames.includes('breathing_sound_id')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN breathing_sound_id TEXT NOT NULL DEFAULT 'cello'`,
    );
  }
  if (!colNames.includes('breathing_sound_uri')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN breathing_sound_uri TEXT`,
    );
  }
  if (!colNames.includes('breathing_sound_name')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN breathing_sound_name TEXT`,
    );
  }
  // v1.25: duração configurável do exercício de respiração (em minutos).
  // Default = 16 min (sessão de breath work).
  if (!colNames.includes('breathing_duration_minutes')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN breathing_duration_minutes INTEGER NOT NULL DEFAULT 16`,
    );
  }
  // v1.26: voz da tela "Leia para mim" (sistema), independente da voz do chat.
  if (!colNames.includes('read_aloud_voice_id')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN read_aloud_voice_id TEXT`,
    );
  }
  if (!colNames.includes('read_aloud_voice_language')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN read_aloud_voice_language TEXT`,
    );
  }
  // v1.27: nudge de "trabalho sentado" (levantar e mover no expediente).
  if (!colNames.includes('sedentary_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN sedentary_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('sedentary_days')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN sedentary_days TEXT NOT NULL DEFAULT '1,2,3,4,5'`,
    );
  }
  if (!colNames.includes('sedentary_start')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN sedentary_start TEXT NOT NULL DEFAULT '09:00'`,
    );
  }
  if (!colNames.includes('sedentary_end')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN sedentary_end TEXT NOT NULL DEFAULT '17:00'`,
    );
  }
  if (!colNames.includes('sedentary_interval_min')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN sedentary_interval_min INTEGER NOT NULL DEFAULT 60`,
    );
  }
  // v1.28: voz da leitura igual à da Comentora (provider + Gemini) + velocidade.
  if (!colNames.includes('read_aloud_provider')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN read_aloud_provider TEXT NOT NULL DEFAULT 'system'`,
    );
  }
  if (!colNames.includes('read_aloud_gemini_voice')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN read_aloud_gemini_voice TEXT NOT NULL DEFAULT 'Aoede'`,
    );
  }
  if (!colNames.includes('read_aloud_rate')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN read_aloud_rate REAL NOT NULL DEFAULT 1.0`,
    );
  }
  if (!colNames.includes('read_aloud_paused')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN read_aloud_paused INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('spoken_nudges_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN spoken_nudges_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('spoken_headphones_only')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN spoken_headphones_only INTEGER NOT NULL DEFAULT 0`,
    );
  }
  // v1.54: horário silencioso (janela + dias sem voz).
  if (!colNames.includes('spoken_quiet_enabled')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN spoken_quiet_enabled INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!colNames.includes('spoken_quiet_start')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN spoken_quiet_start TEXT NOT NULL DEFAULT '09:00'`,
    );
  }
  if (!colNames.includes('spoken_quiet_end')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN spoken_quiet_end TEXT NOT NULL DEFAULT '18:00'`,
    );
  }
  if (!colNames.includes('spoken_quiet_days')) {
    await database.execAsync(
      `ALTER TABLE user_config ADD COLUMN spoken_quiet_days INTEGER NOT NULL DEFAULT 127`,
    );
  }
  // v1.57: ano de nascimento (estimar FC máxima p/ minutos de FC alta na semana).
  if (!colNames.includes('birth_year')) {
    await database.execAsync(`ALTER TABLE user_config ADD COLUMN birth_year INTEGER`);
  }

  // v1.28: textos salvos da tela "Leia para mim".
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS read_aloud_texts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      audio_uri TEXT,
      audio_voice TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // v1.51: VÁRIOS sons de respiração próprios (cada um nomeado), numa tabela.
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS breathing_custom_sounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      uri TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Migração (uma vez): move o som próprio ÚNICO antigo (breathing_sound_uri/name)
  // para a lista; depois zera breathing_sound_uri para não re-migrar.
  try {
    const oldCfg = await database.getFirstAsync<{
      breathing_sound_id: string | null;
      breathing_sound_uri: string | null;
      breathing_sound_name: string | null;
    }>(
      'SELECT breathing_sound_id, breathing_sound_uri, breathing_sound_name FROM user_config WHERE id = 1',
    );
    const oldUri = oldCfg?.breathing_sound_uri;
    if (oldUri) {
      const cnt = await database.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM breathing_custom_sounds',
      );
      if ((cnt?.n ?? 0) === 0) {
        const nm = (oldCfg?.breathing_sound_name ?? '').trim() || 'Meu áudio';
        const ins = await database.runAsync(
          'INSERT INTO breathing_custom_sounds (name, uri) VALUES (?, ?)',
          [nm, oldUri],
        );
        if (oldCfg?.breathing_sound_id === 'custom') {
          await database.runAsync('UPDATE user_config SET breathing_sound_id = ? WHERE id = 1', [
            `custom:${ins.lastInsertRowId as number}`,
          ]);
        }
      }
      await database.runAsync('UPDATE user_config SET breathing_sound_uri = NULL WHERE id = 1');
    }
  } catch {
    /* migração best-effort */
  }
  // v1.34: cada texto salvo guarda o seu próprio áudio (não regera nem gasta
  // token). Migração defensiva para instalações que já tinham a tabela.
  const raCols = await database.getAllAsync<{ name: string }>(
    "PRAGMA table_info('read_aloud_texts')",
  );
  if (!raCols.some((c) => c.name === 'audio_uri')) {
    await database.execAsync(`ALTER TABLE read_aloud_texts ADD COLUMN audio_uri TEXT`);
  }
  if (!raCols.some((c) => c.name === 'audio_voice')) {
    await database.execAsync(`ALTER TABLE read_aloud_texts ADD COLUMN audio_voice TEXT`);
  }

  // v1.23: dias da semana por lembrete (medications). Permite lembretes
  // semanais em dias específicos (ex.: VO2máx só Ter/Qui). Default = todos os
  // 7 dias, ou seja, diário — preserva o comportamento das instalações antigas.
  // Convenção 0=domingo … 6=sábado (igual a Date.getDay()).
  const medCols = await database.getAllAsync<{ name: string }>(
    "PRAGMA table_info('medications')",
  );
  if (!medCols.some((c) => c.name === 'days_of_week')) {
    await database.execAsync(
      `ALTER TABLE medications ADD COLUMN days_of_week TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6'`,
    );
  }
  // v1.53: jejum intermitente — N horas de jejum (NULL = hábito normal).
  if (!medCols.some((c) => c.name === 'fasting_hours')) {
    await database.execAsync(`ALTER TABLE medications ADD COLUMN fasting_hours INTEGER`);
  }

  // v1.5: seed default nudges if the table is empty. INSERT OR IGNORE keeps
  // existing per-user customizations from being overwritten on later runs.
  const existingConfig = await database.getFirstAsync<{
    bedtime: string;
    reminder_interval_minutes: number;
    prep_reminders_enabled: number;
  }>(
    'SELECT bedtime, reminder_interval_minutes, prep_reminders_enabled FROM user_config WHERE id = 1',
  );
  const bedtimeStr = existingConfig?.bedtime ?? '23:00';
  const intervalMin = existingConfig?.reminder_interval_minutes ?? 10;
  const breathingEnabled = (existingConfig?.prep_reminders_enabled ?? 1) === 1 ? 1 : 0;

  const [bh, bm] = bedtimeStr.split(':').map((n) => parseInt(n, 10));
  const bedtimeMins = (bh || 23) * 60 + (bm || 0);
  const breathingTime = (() => {
    let mins = bedtimeMins - intervalMin;
    if (mins < 0) mins += 24 * 60;
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();

  await database.runAsync(
    `INSERT OR IGNORE INTO nudges
       (type, title, body, emoji, enabled, schedule_time, order_index)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'bluelight',
      'Pôr do sol',
      'Sol indo embora. Hora dos óculos bloqueadores ou modo escuro nas telas — preserva a melatonina.',
      '🕶️',
      1,
      '18:00',
      1,
    ],
  );
  await database.runAsync(
    `INSERT OR IGNORE INTO nudges
       (type, title, body, emoji, enabled, schedule_time, order_index)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      'breathing',
      'Respiração 2-2-4',
      'Bora desacelerar? 2 inspiradas curtas + 1 expirada longa. Toca aqui pra começar.',
      '🌬️',
      breathingEnabled,
      breathingTime,
      3,
    ],
  );

  // v1.21: o lembrete fixo de "Suplementos" foi substituído pela tela de
  // Medicamentos/Suplementos (lembretes ilimitados, definidos pelo usuário).
  // Remove o nudge legado de instalações antigas — os lembretes agora vivem
  // na tabela `medications`.
  await database.execAsync(`DELETE FROM nudges WHERE type = 'supplements'`);

  const existing = await database.getFirstAsync<{ id: number; system_prompt: string | null }>(
    'SELECT id, system_prompt FROM user_config WHERE id = 1',
  );
  if (!existing) {
    await database.runAsync(
      `INSERT OR IGNORE INTO user_config (id, bedtime, reminder_interval_minutes, max_reminders, tone, gemini_model, has_api_key, onboarding_done, system_prompt, prep_reminders_enabled, voice_mode_enabled)
       VALUES (1, '23:00', 10, 12, 'firm', 'gemini-3.1-flash-lite', 0, 0, ?, 1, 0)`,
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

  // v1.24.1: o som de respiração "Tom original" (id 'tone') saiu da biblioteca.
  // Migra quem estava nele (inclusive o antigo default) para 'cello'. Roda
  // depois do seed acima, então a linha id=1 já existe. Não toca em quem
  // escolheu piano/órgão/custom.
  await database.runAsync(
    `UPDATE user_config SET breathing_sound_id = 'cello' WHERE breathing_sound_id = 'tone'`,
  );
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
  voice_id: string | null;
  voice_language: string | null;
  owl_species: string | null;
  sleep_awareness_enabled: number;
  notifications_per_day: number | null;
  voice_provider: string | null;
  gemini_voice_name: string | null;
  dnd_bypass_enabled: number | null;
  voice_nudges_enabled: number | null;
  spoken_nudges_enabled: number | null;
  spoken_headphones_only: number | null;
  spoken_quiet_enabled: number | null;
  spoken_quiet_start: string | null;
  spoken_quiet_end: string | null;
  spoken_quiet_days: number | null;
  inspiration_mode_enabled: number | null;
  inspiration_per_day: number | null;
  breathing_sound_id: string | null;
  breathing_sound_uri: string | null;
  breathing_sound_name: string | null;
  breathing_duration_minutes: number | null;
  read_aloud_voice_id: string | null;
  read_aloud_voice_language: string | null;
  read_aloud_provider: string | null;
  read_aloud_gemini_voice: string | null;
  read_aloud_rate: number | null;
  read_aloud_paused: number | null;
  sedentary_enabled: number | null;
  sedentary_days: string | null;
  sedentary_start: string | null;
  sedentary_end: string | null;
  sedentary_interval_min: number | null;
  birth_year: number | null;
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
  voiceId: r.voice_id,
  voiceLanguage: r.voice_language,
  owlSpecies: (r.owl_species ?? 'buraqueira') as UserConfig['owlSpecies'],
  sleepAwarenessEnabled: (r.sleep_awareness_enabled ?? 1) === 1,
  notificationsPerDay: r.notifications_per_day ?? 4,
  voiceProvider: (r.voice_provider ?? 'system') as UserConfig['voiceProvider'],
  geminiVoiceName: r.gemini_voice_name ?? 'Aoede',
  dndBypassEnabled: (r.dnd_bypass_enabled ?? 0) === 1,
  voiceNudgesEnabled: (r.voice_nudges_enabled ?? 0) === 1,
  spokenNudgesEnabled: (r.spoken_nudges_enabled ?? 0) === 1,
  spokenHeadphonesOnly: (r.spoken_headphones_only ?? 0) === 1,
  spokenQuietEnabled: (r.spoken_quiet_enabled ?? 0) === 1,
  spokenQuietStart: r.spoken_quiet_start ?? '09:00',
  spokenQuietEnd: r.spoken_quiet_end ?? '18:00',
  spokenQuietDays: r.spoken_quiet_days ?? 127,
  inspirationModeEnabled: (r.inspiration_mode_enabled ?? 0) === 1,
  inspirationPerDay: r.inspiration_per_day ?? 6,
  breathingSoundId: r.breathing_sound_id ?? 'cello',
  breathingSoundUri: r.breathing_sound_uri ?? null,
  breathingSoundName: r.breathing_sound_name ?? null,
  breathingDurationMinutes: r.breathing_duration_minutes ?? 16,
  readAloudVoiceId: r.read_aloud_voice_id ?? null,
  readAloudVoiceLanguage: r.read_aloud_voice_language ?? null,
  readAloudProvider: (r.read_aloud_provider ?? 'system') as UserConfig['readAloudProvider'],
  readAloudGeminiVoice: r.read_aloud_gemini_voice ?? 'Aoede',
  readAloudRate: r.read_aloud_rate ?? 1.0,
  readAloudPaused: (r.read_aloud_paused ?? 0) === 1,
  sedentaryEnabled: (r.sedentary_enabled ?? 0) === 1,
  sedentaryDays: parseDaysOfWeek(r.sedentary_days ?? '1,2,3,4,5'),
  sedentaryStart: r.sedentary_start ?? '09:00',
  sedentaryEnd: r.sedentary_end ?? '17:00',
  sedentaryIntervalMin: r.sedentary_interval_min ?? 60,
  birthYear: r.birth_year ?? null,
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
    voiceId: 'voice_id',
    voiceLanguage: 'voice_language',
    owlSpecies: 'owl_species',
    sleepAwarenessEnabled: 'sleep_awareness_enabled',
    notificationsPerDay: 'notifications_per_day',
    voiceProvider: 'voice_provider',
    geminiVoiceName: 'gemini_voice_name',
    dndBypassEnabled: 'dnd_bypass_enabled',
    voiceNudgesEnabled: 'voice_nudges_enabled',
    spokenNudgesEnabled: 'spoken_nudges_enabled',
    spokenHeadphonesOnly: 'spoken_headphones_only',
    spokenQuietEnabled: 'spoken_quiet_enabled',
    spokenQuietStart: 'spoken_quiet_start',
    spokenQuietEnd: 'spoken_quiet_end',
    spokenQuietDays: 'spoken_quiet_days',
    inspirationModeEnabled: 'inspiration_mode_enabled',
    inspirationPerDay: 'inspiration_per_day',
    breathingSoundId: 'breathing_sound_id',
    breathingSoundUri: 'breathing_sound_uri',
    breathingSoundName: 'breathing_sound_name',
    breathingDurationMinutes: 'breathing_duration_minutes',
    readAloudVoiceId: 'read_aloud_voice_id',
    readAloudVoiceLanguage: 'read_aloud_voice_language',
    readAloudProvider: 'read_aloud_provider',
    readAloudGeminiVoice: 'read_aloud_gemini_voice',
    readAloudRate: 'read_aloud_rate',
    readAloudPaused: 'read_aloud_paused',
    sedentaryEnabled: 'sedentary_enabled',
    sedentaryDays: 'sedentary_days',
    sedentaryStart: 'sedentary_start',
    sedentaryEnd: 'sedentary_end',
    sedentaryIntervalMin: 'sedentary_interval_min',
    birthYear: 'birth_year',
  };

  Object.entries(patch).forEach(([k, v]) => {
    if (k === 'id') return;
    const col = map[k as keyof UserConfig];
    if (!col) return;
    fields.push(`${col} = ?`);
    if (k === 'sedentaryDays') values.push(serializeDaysOfWeek(v as number[]));
    else if (typeof v === 'boolean') values.push(v ? 1 : 0);
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

// --------- Nudges ---------

interface NudgeRow {
  id: number;
  type: string;
  title: string;
  body: string;
  emoji: string | null;
  enabled: number;
  schedule_time: string;
  order_index: number;
}

const rowToNudge = (r: NudgeRow): Nudge => ({
  id: r.id,
  type: r.type as NudgeType,
  title: r.title,
  body: r.body,
  emoji: r.emoji,
  enabled: r.enabled === 1,
  scheduleTime: r.schedule_time,
  orderIndex: r.order_index,
});

export async function listNudges(): Promise<Nudge[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<NudgeRow>(
    'SELECT * FROM nudges ORDER BY order_index ASC, id ASC',
  );
  return rows.map(rowToNudge);
}

export async function updateNudge(
  id: number,
  patch: Partial<Pick<Nudge, 'enabled' | 'scheduleTime' | 'title' | 'body'>>,
): Promise<Nudge | null> {
  const d = await getDb();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (typeof patch.enabled === 'boolean') {
    fields.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (typeof patch.scheduleTime === 'string') {
    fields.push('schedule_time = ?');
    values.push(patch.scheduleTime);
  }
  if (typeof patch.title === 'string') {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (typeof patch.body === 'string') {
    fields.push('body = ?');
    values.push(patch.body);
  }
  if (fields.length === 0) return null;
  fields.push("updated_at = datetime('now')");
  values.push(id);
  await d.runAsync(
    `UPDATE nudges SET ${fields.join(', ')} WHERE id = ?`,
    values,
  );
  const row = await d.getFirstAsync<NudgeRow>(
    'SELECT * FROM nudges WHERE id = ?',
    [id],
  );
  return row ? rowToNudge(row) : null;
}

// --------- Nudge completions (verify-until-confirmed) ---------

/**
 * Marca um comportamento (ex.: 'supplements', 'bluelight') como feito no dia
 * informado. Idempotente: chamar de novo no mesmo dia não duplica.
 */
export async function markNudgeDone(nudgeType: string, date: string): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT OR IGNORE INTO nudge_completions (nudge_type, date) VALUES (?, ?)`,
    [nudgeType, date],
  );
}

/**
 * Desfaz a confirmação de um comportamento no dia (desmarca o TODO). Remove o
 * registro de "feito hoje" para que a corrente de insistências volte a ser
 * agendada na próxima vez que os lembretes forem re-armados.
 */
export async function markNudgeUndone(nudgeType: string, date: string): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `DELETE FROM nudge_completions WHERE nudge_type = ? AND date = ?`,
    [nudgeType, date],
  );
}

/** True se o usuário já confirmou esse comportamento no dia informado. */
export async function isNudgeDone(nudgeType: string, date: string): Promise<boolean> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM nudge_completions WHERE nudge_type = ? AND date = ?`,
    [nudgeType, date],
  );
  return (row?.n ?? 0) > 0;
}

/** Tipos de nudge já confirmados no dia informado. */
export async function getDoneNudgeTypes(date: string): Promise<string[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ nudge_type: string }>(
    `SELECT nudge_type FROM nudge_completions WHERE date = ?`,
    [date],
  );
  return rows.map((r) => r.nudge_type);
}

// --------- Medications / supplements (lembretes do usuário) ---------

interface MedicationRow {
  id: number;
  name: string;
  dosage: string | null;
  time: string;
  emoji: string | null;
  enabled: number;
  days_of_week: string | null;
  order_index: number;
  fasting_hours: number | null;
}

const ALL_DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];

/**
 * Converte a coluna `days_of_week` ("0,1,2,…") numa lista normalizada de
 * inteiros 0–6 (domingo–sábado), sem duplicatas e ordenada. Entrada vazia ou
 * inválida vira "todos os dias" (= diário), o padrão seguro.
 */
function parseDaysOfWeek(raw: string | null | undefined): number[] {
  if (!raw) return [...ALL_DAYS_OF_WEEK];
  const parsed = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const uniq = Array.from(new Set(parsed)).sort((a, b) => a - b);
  return uniq.length > 0 ? uniq : [...ALL_DAYS_OF_WEEK];
}

/** Serializa para o banco; nunca grava string vazia (cairia para diário). */
function serializeDaysOfWeek(days: number[] | undefined): string {
  return parseDaysOfWeek((days ?? ALL_DAYS_OF_WEEK).join(',')).join(',');
}

const rowToMedication = (r: MedicationRow): Medication => ({
  id: r.id,
  name: r.name,
  dosage: r.dosage,
  time: r.time,
  emoji: r.emoji,
  enabled: r.enabled === 1,
  orderIndex: r.order_index,
  daysOfWeek: parseDaysOfWeek(r.days_of_week),
  fastingHours: r.fasting_hours ?? null,
});

export async function listMedications(): Promise<Medication[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<MedicationRow>(
    'SELECT * FROM medications ORDER BY order_index ASC, id ASC',
  );
  return rows.map(rowToMedication);
}

export async function getMedication(id: number): Promise<Medication | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<MedicationRow>(
    'SELECT * FROM medications WHERE id = ?',
    [id],
  );
  return row ? rowToMedication(row) : null;
}

export async function createMedication(input: {
  name: string;
  dosage?: string | null;
  time: string;
  emoji?: string | null;
  enabled?: boolean;
  daysOfWeek?: number[];
  fastingHours?: number | null;
}): Promise<Medication> {
  const d = await getDb();
  // Novo lembrete entra no fim da lista.
  const max = await d.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(order_index) AS m FROM medications',
  );
  const orderIndex = (max?.m ?? -1) + 1;
  const res = await d.runAsync(
    `INSERT INTO medications (name, dosage, time, emoji, enabled, days_of_week, order_index, fasting_hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.dosage?.trim() || null,
      input.time,
      input.emoji?.trim() || '💊',
      input.enabled === false ? 0 : 1,
      serializeDaysOfWeek(input.daysOfWeek),
      orderIndex,
      input.fastingHours ?? null,
    ],
  );
  const created = await getMedication(res.lastInsertRowId as number);
  // getMedication só retorna null se a linha sumiu entre INSERT e SELECT —
  // impossível aqui, mas o tipo precisa ser estreitado.
  if (!created) throw new Error('Falha ao criar o lembrete.');
  return created;
}

export async function updateMedication(
  id: number,
  patch: Partial<
    Pick<
      Medication,
      'name' | 'dosage' | 'time' | 'emoji' | 'enabled' | 'daysOfWeek' | 'fastingHours'
    >
  >,
): Promise<Medication | null> {
  const d = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (typeof patch.name === 'string') {
    fields.push('name = ?');
    values.push(patch.name.trim());
  }
  if (patch.dosage !== undefined) {
    fields.push('dosage = ?');
    values.push(patch.dosage?.trim() || null);
  }
  if (typeof patch.time === 'string') {
    fields.push('time = ?');
    values.push(patch.time);
  }
  if (patch.emoji !== undefined) {
    fields.push('emoji = ?');
    values.push(patch.emoji?.trim() || '💊');
  }
  if (typeof patch.enabled === 'boolean') {
    fields.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.daysOfWeek !== undefined) {
    fields.push('days_of_week = ?');
    values.push(serializeDaysOfWeek(patch.daysOfWeek));
  }
  if (patch.fastingHours !== undefined) {
    fields.push('fasting_hours = ?');
    values.push(patch.fastingHours ?? null);
  }
  if (fields.length === 0) return getMedication(id);
  fields.push("updated_at = datetime('now')");
  values.push(id);
  await d.runAsync(`UPDATE medications SET ${fields.join(', ')} WHERE id = ?`, values);
  return getMedication(id);
}

export async function deleteMedication(id: number): Promise<void> {
  const d = await getDb();
  await d.runAsync('DELETE FROM medications WHERE id = ?', [id]);
  // Limpa os registros de "tomei hoje" deste lembrete.
  await d.runAsync('DELETE FROM nudge_completions WHERE nudge_type = ?', [`med:${id}`]);
}

// --------- Textos salvos da tela "Leia para mim" ---------

interface ReadAloudTextRow {
  id: number;
  title: string;
  content: string;
  audio_uri: string | null;
  audio_voice: string | null;
  updated_at: string;
}

const rowToReadAloudText = (r: ReadAloudTextRow): ReadAloudText => ({
  id: r.id,
  title: r.title,
  content: r.content,
  audioUri: r.audio_uri ?? null,
  audioVoice: r.audio_voice ?? null,
  updatedAt: r.updated_at,
});

/** URIs dos áudios guardados pelos textos salvos — protegidos da limpeza. */
export async function getSavedAudioUris(): Promise<string[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<{ audio_uri: string }>(
    'SELECT audio_uri FROM read_aloud_texts WHERE audio_uri IS NOT NULL',
  );
  return rows.map((r) => r.audio_uri);
}

/** Amarra um arquivo de áudio a um texto salvo; apaga o áudio anterior se sobrar. */
export async function updateReadAloudTextAudio(
  id: number,
  audioUri: string,
  audioVoice: string,
): Promise<void> {
  const d = await getDb();
  const prev = await d.getFirstAsync<{ audio_uri: string | null }>(
    'SELECT audio_uri FROM read_aloud_texts WHERE id = ?',
    [id],
  );
  await d.runAsync(
    "UPDATE read_aloud_texts SET audio_uri = ?, audio_voice = ?, updated_at = datetime('now') WHERE id = ?",
    [audioUri, audioVoice, id],
  );
  const old = prev?.audio_uri;
  if (old && old !== audioUri) {
    const others = await d.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM read_aloud_texts WHERE audio_uri = ?',
      [old],
    );
    if ((others?.n ?? 0) === 0) {
      try {
        new File(old).delete();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function listReadAloudTexts(): Promise<ReadAloudText[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<ReadAloudTextRow>(
    'SELECT * FROM read_aloud_texts ORDER BY updated_at DESC, id DESC',
  );
  return rows.map(rowToReadAloudText);
}

export async function createReadAloudText(input: {
  title: string;
  content: string;
}): Promise<ReadAloudText> {
  const d = await getDb();
  const res = await d.runAsync(
    `INSERT INTO read_aloud_texts (title, content) VALUES (?, ?)`,
    [input.title.trim() || 'Sem título', input.content],
  );
  const row = await d.getFirstAsync<ReadAloudTextRow>(
    'SELECT * FROM read_aloud_texts WHERE id = ?',
    [res.lastInsertRowId as number],
  );
  if (!row) throw new Error('Falha ao salvar o texto.');
  return rowToReadAloudText(row);
}

export async function deleteReadAloudText(id: number): Promise<void> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ audio_uri: string | null }>(
    'SELECT audio_uri FROM read_aloud_texts WHERE id = ?',
    [id],
  );
  await d.runAsync('DELETE FROM read_aloud_texts WHERE id = ?', [id]);
  const uri = row?.audio_uri;
  if (uri) {
    // só apaga o arquivo se nenhum outro texto salvo apontar para ele.
    const others = await d.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM read_aloud_texts WHERE audio_uri = ?',
      [uri],
    );
    if ((others?.n ?? 0) === 0) {
      try {
        new File(uri).delete();
      } catch {
        /* ignore */
      }
    }
  }
}

// --------- Sons de respiração próprios (vários, nomeados) ---------

interface BreathingCustomSoundRow {
  id: number;
  name: string;
  uri: string;
  created_at: string;
}

export async function listBreathingCustomSounds(): Promise<BreathingCustomSound[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<BreathingCustomSoundRow>(
    'SELECT * FROM breathing_custom_sounds ORDER BY id ASC',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, uri: r.uri }));
}

export async function createBreathingCustomSound(input: {
  name: string;
  uri: string;
}): Promise<BreathingCustomSound> {
  const d = await getDb();
  const name = input.name.trim() || 'Meu áudio';
  const res = await d.runAsync(
    'INSERT INTO breathing_custom_sounds (name, uri) VALUES (?, ?)',
    [name, input.uri],
  );
  return { id: res.lastInsertRowId as number, name, uri: input.uri };
}

export async function renameBreathingCustomSound(id: number, name: string): Promise<void> {
  const d = await getDb();
  await d.runAsync('UPDATE breathing_custom_sounds SET name = ? WHERE id = ?', [
    name.trim() || 'Meu áudio',
    id,
  ]);
}

export async function deleteBreathingCustomSound(id: number): Promise<void> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ uri: string }>(
    'SELECT uri FROM breathing_custom_sounds WHERE id = ?',
    [id],
  );
  await d.runAsync('DELETE FROM breathing_custom_sounds WHERE id = ?', [id]);
  const uri = row?.uri;
  if (uri) {
    try {
      new File(uri).delete();
    } catch {
      /* ignore */
    }
  }
}

// --------- App key/value store (estado de UI persistente) ---------

/** Lê um valor do armazenamento chave/valor; null se não existir. */
export async function getKV(key: string): Promise<string | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM app_kv WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

/** Grava (ou substitui) um valor no armazenamento chave/valor. */
export async function setKV(key: string, value: string): Promise<void> {
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value],
  );
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
    DELETE FROM nudge_completions;
    DELETE FROM medications;
    DELETE FROM app_kv;
    DELETE FROM habits;
    DELETE FROM user_config WHERE id = 1;
  `);
  await d.runAsync(
    `INSERT INTO user_config (id, bedtime, reminder_interval_minutes, max_reminders, tone, gemini_model, has_api_key, onboarding_done, system_prompt, prep_reminders_enabled, voice_mode_enabled, ai_backend, local_model_downloaded, allow_mobile_data_download)
     VALUES (1, '23:00', 10, 12, 'firm', 'gemini-3.1-flash-lite', 0, 0, ?, 1, 0, 'remote', 0, 0)`,
    [DEFAULT_SYSTEM_PROMPT],
  );
}
