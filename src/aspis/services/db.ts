// Estado e cache em SQLite — espelha as colunas principais da tabela `videos`
// do store.py do desktop. Idempotência: vídeo já analisado não é reprocessado.
import * as SQLite from 'expo-sqlite';

import type {
  Analysis,
  ClipRecord,
  ContentSource,
  QAItem,
  QAKind,
  Source,
  Transcript,
  TranscriptSource,
  FeedSource,
  ThumbRecord,
  VideoRecord,
} from '../types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    channel TEXT, channel_id TEXT,
    original_title TEXT, neutral_title TEXT,
    url TEXT, published_at TEXT, duration TEXT,
    pillar TEXT, score INTEGER, is_clickbait INTEGER,
    a_real TEXT,
    resumo TEXT, pontos_chave TEXT, fatos TEXT, citacoes TEXT,
    evidencias TEXT,
    transcript_available INTEGER,
    content_source TEXT,
    fetched_at TEXT,
    read INTEGER DEFAULT 0,
    saved_drive INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    transcript_text TEXT,
    channel_thumb TEXT,
    audio_file TEXT,
    transcript_segments TEXT,
    transcript_source TEXT,
    asr_status TEXT,
    asr_error TEXT,
    source TEXT DEFAULT 'youtube'
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS qa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'ask',
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    saved_note INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_video ON qa(video_id, id);
CREATE TABLE IF NOT EXISTS clips (
    block_key TEXT NOT NULL,
    video_id TEXT NOT NULL,
    label TEXT NOT NULL,
    title TEXT NOT NULL,
    drive_file_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (video_id, block_key)
);
CREATE TABLE IF NOT EXISTS channel_prefs (
    channel_id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thumbs (
    video_id TEXT PRIMARY KEY,
    value INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    neutral_title TEXT, original_title TEXT,
    channel TEXT, channel_id TEXT, pillar TEXT,
    resumo TEXT, score INTEGER, is_clickbait INTEGER, duration TEXT
);
`;

// Colunas adicionadas depois do schema original — aplicadas com ALTER TABLE em
// bancos já existentes (ADD COLUMN é idempotente via checagem do PRAGMA).
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: 'videos', column: 'evidencias', ddl: "ALTER TABLE videos ADD COLUMN evidencias TEXT" },
  { table: 'videos', column: 'a_real', ddl: 'ALTER TABLE videos ADD COLUMN a_real TEXT' },
  { table: 'qa', column: 'kind', ddl: "ALTER TABLE qa ADD COLUMN kind TEXT NOT NULL DEFAULT 'ask'" },
  { table: 'qa', column: 'sources', ddl: "ALTER TABLE qa ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'" },
  { table: 'qa', column: 'saved_note', ddl: 'ALTER TABLE qa ADD COLUMN saved_note INTEGER NOT NULL DEFAULT 0' },
  { table: 'videos', column: 'skipped', ddl: 'ALTER TABLE videos ADD COLUMN skipped INTEGER DEFAULT 0' },
  { table: 'videos', column: 'audio_file', ddl: 'ALTER TABLE videos ADD COLUMN audio_file TEXT' },
  { table: 'videos', column: 'transcript_segments', ddl: 'ALTER TABLE videos ADD COLUMN transcript_segments TEXT' },
  { table: 'videos', column: 'transcript_source', ddl: 'ALTER TABLE videos ADD COLUMN transcript_source TEXT' },
  { table: 'videos', column: 'asr_status', ddl: 'ALTER TABLE videos ADD COLUMN asr_status TEXT' },
  { table: 'videos', column: 'asr_error', ddl: 'ALTER TABLE videos ADD COLUMN asr_error TEXT' },
  { table: 'videos', column: 'source', ddl: "ALTER TABLE videos ADD COLUMN source TEXT DEFAULT 'youtube'" },
  // fila de transcrição: quando foi a última tentativa e quantas falharam (nova tentativa mais tarde)
  { table: 'videos', column: 'asr_at', ddl: 'ALTER TABLE videos ADD COLUMN asr_at TEXT' },
  { table: 'videos', column: 'asr_tries', ddl: 'ALTER TABLE videos ADD COLUMN asr_tries INTEGER' },
  // compartilhado com a Noosfera (menu Compartilhar do YouTube): entra no feed de qualquer jeito
  { table: 'videos', column: 'shared_at', ddl: 'ALTER TABLE videos ADD COLUMN shared_at TEXT' },
];

// Transcrições feitas no Mac (aspis-transcricoes.json no Drive) para vídeos que
// ainda não chegaram a este banco: aplicadas quando o vídeo chegar.
const DESKTOP_SCHEMA = `
CREATE TABLE IF NOT EXISTS desktop_transcripts (
    video_id TEXT PRIMARY KEY,
    texto TEXT NOT NULL,
    fonte TEXT NOT NULL,
    idioma TEXT,
    titulo TEXT,
    em INTEGER NOT NULL
);
`;

// Cards ocultados no feed ("não quero isso agora"): por video_id, numa tabela
// própria — vale também para o vídeo que ainda não chegou a este banco (ocultado
// no Mac antes de o pipeline daqui o trazer), que já nasce oculto. hidden_at NULL
// é o "desfeito", guardado para a sincronização levar o null ao Mac.
const HIDDEN_SCHEMA = `
CREATE TABLE IF NOT EXISTS hidden (
    video_id TEXT PRIMARY KEY,
    hidden_at INTEGER,
    changed_at INTEGER NOT NULL
);
`;

const JSON_FIELDS = ['pontos_chave', 'fatos', 'citacoes', 'evidencias'] as const;
const FLAGS = ['read', 'saved_drive', 'skipped'] as const;
export type Flag = (typeof FLAGS)[number];

let db: SQLite.SQLiteDatabase | null = null;

function migrate(d: SQLite.SQLiteDatabase): void {
  for (const m of MIGRATIONS) {
    const cols = d.getAllSync<{ name: string }>(`PRAGMA table_info(${m.table})`);
    if (!cols.some((c) => c.name === m.column)) {
      try {
        d.execSync(m.ddl);
      } catch {
        // coluna pode já existir numa corrida; ignora
      }
    }
  }
}

function conn(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('aspis.db');
    db.execSync(SCHEMA);
    db.execSync(DESKTOP_SCHEMA);
    db.execSync(HIDDEN_SCHEMA);
    migrate(db);
  }
  return db;
}

export function init(): void {
  conn();
}

/** "Apagar todos os meus dados": esvazia todas as tabelas do Aspis. */
export function wipeAll(): void {
  const d = conn();
  const tables = d.getAllSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  for (const t of tables) d.execSync(`DELETE FROM "${t.name}"`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

function rowToRecord(row: Record<string, unknown>): VideoRecord {
  const d = { ...row } as Record<string, unknown>;
  for (const f of JSON_FIELDS) {
    const raw = d[f];
    try {
      d[f] = raw ? JSON.parse(String(raw)) : [];
    } catch {
      d[f] = [];
    }
  }
  return d as unknown as VideoRecord;
}

export function hasVideo(videoId: string): boolean {
  const row = conn().getFirstSync<{ n: number }>(
    'SELECT 1 AS n FROM videos WHERE video_id = ?',
    [videoId],
  );
  return row != null;
}

export function getVideo(videoId: string): VideoRecord | null {
  const row = conn().getFirstSync<Record<string, unknown>>(
    'SELECT * FROM videos WHERE video_id = ?',
    [videoId],
  );
  return row ? rowToRecord(row) : null;
}

export interface UpsertInput extends Analysis {
  video_id: string;
  channel: string;
  channel_id: string;
  original_title: string;
  url: string;
  published_at: string;
  duration: string;
  transcript_available: 0 | 1;
  content_source: ContentSource;
  transcript_text?: string | null;
  channel_thumb?: string;
  source?: FeedSource;
}

export function upsertVideo(v: UpsertInput): void {
  const cols = [
    'video_id', 'channel', 'channel_id', 'original_title', 'neutral_title',
    'url', 'published_at', 'duration', 'pillar', 'score', 'is_clickbait',
    'a_real', 'resumo', 'pontos_chave', 'fatos', 'citacoes', 'evidencias',
    'transcript_available', 'content_source', 'fetched_at', 'transcript_text',
    'channel_thumb', 'source',
  ];
  const record: Record<string, unknown> = {
    ...v,
    pontos_chave: JSON.stringify(v.pontos_chave ?? []),
    fatos: JSON.stringify(v.fatos ?? []),
    citacoes: JSON.stringify(v.citacoes ?? []),
    evidencias: JSON.stringify(v.evidencias ?? []),
    fetched_at: nowIso(),
    transcript_text: v.transcript_text ?? null,
    channel_thumb: v.channel_thumb ?? '',
    source: v.source ?? 'youtube',
  };
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols
    .filter((c) => c !== 'video_id')
    .map((c) => `${c}=excluded.${c}`)
    .join(', ');
  conn().runSync(
    `INSERT INTO videos (${cols.join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT(video_id) DO UPDATE SET ${updates}`,
    cols.map((c) => (record[c] ?? null) as SQLite.SQLiteBindValue),
  );
}

export interface VideoQuery {
  pillar?: string | null;
  minScore?: number;
  sinceIso?: string | null;
  includeRead?: boolean;
  source?: FeedSource;
}

// Nota provisória: triado só por título/descrição (sem legenda nem
// transcrição ainda). Aparece no feed mesmo abaixo do limiar — a nota
// definitiva vem quando a transcrição refaz a análise.
const PROVISIONAL = "content_source = 'metadata'";

// Ocultado no feed (deslizado para o lado): fora da lista e das contagens.
const NOT_HIDDEN = 'video_id NOT IN (SELECT video_id FROM hidden WHERE hidden_at IS NOT NULL)';

export function isProvisional(v: Pick<VideoRecord, 'content_source'>): boolean {
  return v.content_source === 'metadata';
}

export function getVideos(q: VideoQuery = {}): VideoRecord[] {
  let sql =
    `SELECT * FROM videos WHERE (score >= ? OR ${PROVISIONAL}) AND COALESCE(skipped, 0) = 0 ` +
    `AND ${NOT_HIDDEN} ` +
    "AND channel_id NOT IN (SELECT channel_id FROM channel_prefs WHERE state = 'muted')";
  const args: SQLite.SQLiteBindValue[] = [q.minScore ?? 0];
  if (!q.includeRead) sql += ' AND COALESCE(read, 0) = 0';
  if (q.pillar) {
    sql += ' AND pillar = ?';
    args.push(q.pillar);
  }
  if (q.sinceIso) {
    // o vídeo compartilhado no período entra, mesmo publicado há tempo
    sql += " AND (published_at >= ? OR COALESCE(shared_at, '') >= ?)";
    args.push(q.sinceIso, q.sinceIso);
  }
  if (q.source) {
    sql += " AND COALESCE(source, 'youtube') = ?";
    args.push(q.source);
  }
  sql += ' ORDER BY score DESC, published_at DESC';
  return conn()
    .getAllSync<Record<string, unknown>>(sql, args)
    .map(rowToRecord);
}

// Quantos vídeos os filtros atuais escondem por estarem abaixo do limiar —
// mesmos critérios do getVideos (pulados/silenciados/lidos/pilar), só o score
// invertido, para o "N filtrados" bater com o que de fato apareceria. Os de
// nota provisória não contam: esses já aparecem.
export function countBelow(q: VideoQuery = {}): number {
  let sql =
    `SELECT COUNT(*) AS n FROM videos WHERE score < ? AND NOT COALESCE(${PROVISIONAL}, 0) ` +
    `AND COALESCE(skipped, 0) = 0 AND ${NOT_HIDDEN} ` +
    "AND channel_id NOT IN (SELECT channel_id FROM channel_prefs WHERE state = 'muted')";
  const args: SQLite.SQLiteBindValue[] = [q.minScore ?? 0];
  if (!q.includeRead) sql += ' AND COALESCE(read, 0) = 0';
  if (q.pillar) {
    sql += ' AND pillar = ?';
    args.push(q.pillar);
  }
  if (q.sinceIso) {
    sql += ' AND published_at >= ?';
    args.push(q.sinceIso);
  }
  return conn().getFirstSync<{ n: number }>(sql, args)?.n ?? 0;
}

// Vídeos (não pulados/silenciados/lidos) fora do período atual mas dentro de
// `widerIso` — para o estado vazio sugerir "ampliar o período".
export function countOutsidePeriod(sinceIso: string, widerIso: string, minScore: number): number {
  return (
    conn().getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM videos WHERE (score >= ? OR ${PROVISIONAL}) ` +
        `AND COALESCE(skipped, 0) = 0 AND ${NOT_HIDDEN} ` +
        'AND COALESCE(read, 0) = 0 AND published_at < ? AND published_at >= ? ' +
        "AND channel_id NOT IN (SELECT channel_id FROM channel_prefs WHERE state = 'muted')",
      [minScore, sinceIso, widerIso],
    )?.n ?? 0
  );
}

export function setFlag(videoId: string, field: Flag, value: 0 | 1): void {
  if (!FLAGS.includes(field)) throw new Error(`campo não permitido: ${field}`);
  conn().runSync(`UPDATE videos SET ${field} = ? WHERE video_id = ?`, [value, videoId]);
}

export function deleteVideo(videoId: string): void {
  conn().runSync('DELETE FROM videos WHERE video_id = ?', [videoId]);
  conn().runSync('DELETE FROM qa WHERE video_id = ?', [videoId]);
  conn().runSync('DELETE FROM clips WHERE video_id = ?', [videoId]);
}

/**
 * Compartilhado com a Noosfera: o vídeo vai para o feed do Escudo — volta se estava
 * oculto, pulado ou lido — e fica no topo por um dia (FeedScreen).
 */
export function markShared(videoId: string): void {
  conn().runSync('UPDATE videos SET shared_at = ?, read = 0, skipped = 0 WHERE video_id = ?', [
    nowIso(),
    videoId,
  ]);
  const hidden = conn().getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM hidden WHERE video_id = ? AND hidden_at IS NOT NULL',
    [videoId],
  );
  if (hidden?.n) unhideVideo(videoId);
}

// --- Ocultar ("não quero isso agora") ----------------------------------------
// Sai do feed sem sinal nenhum para a rede local (não é 👎, não pula, não marca lido).

export interface HiddenChange {
  video_id: string;
  /** Epoch ms em que foi ocultado, ou null quando desfeito. */
  hidden_at: number | null;
}

export function hideVideo(videoId: string, at = Date.now()): void {
  conn().runSync(
    `INSERT INTO hidden (video_id, hidden_at, changed_at) VALUES (?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET hidden_at = excluded.hidden_at, changed_at = excluded.changed_at`,
    [videoId, at, at],
  );
}

/** Desfaz: fica o "desfeito" (null), para o outro aparelho também mostrar de novo. */
export function unhideVideo(videoId: string, at = Date.now()): void {
  conn().runSync('UPDATE hidden SET hidden_at = NULL, changed_at = ? WHERE video_id = ?', [at, videoId]);
}

/**
 * O que veio do outro aparelho: ocultado no instante `hiddenAt`, ou desfeito (null),
 * mudado em `changedAt`. Grava mesmo sem o vídeo no banco (ele nasce oculto quando
 * chegar). Devolve true se o feed daqui muda (o vídeo existe e trocou de estado).
 */
export function applyHidden(videoId: string, hiddenAt: number | null, changedAt: number): boolean {
  const d = conn();
  const cur = d.getFirstSync<{ hidden_at: number | null }>(
    'SELECT hidden_at FROM hidden WHERE video_id = ?',
    [videoId],
  );
  if (cur && cur.hidden_at === hiddenAt) return false;
  d.runSync(
    `INSERT INTO hidden (video_id, hidden_at, changed_at) VALUES (?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET hidden_at = excluded.hidden_at, changed_at = excluded.changed_at`,
    [videoId, hiddenAt, changedAt],
  );
  const wasHidden = cur?.hidden_at != null;
  return wasHidden !== (hiddenAt != null) && hasVideo(videoId);
}

/** Os ocultados desde `sinceMs` (pelo instante em que foram ocultados) e os desfeitos
 *  desde `sinceMs` (pelo instante em que foram desfeitos). */
export function hiddenChanges(sinceMs: number): HiddenChange[] {
  return conn().getAllSync<HiddenChange>(
    `SELECT video_id, hidden_at FROM hidden
      WHERE (hidden_at IS NOT NULL AND hidden_at >= ?) OR (hidden_at IS NULL AND changed_at >= ?)`,
    [sinceMs, sinceMs],
  );
}

/** Limpeza: desfeitos antigos e ocultados de vídeos que nunca chegaram. */
export function pruneHidden(beforeMs: number): void {
  conn().runSync(
    `DELETE FROM hidden WHERE changed_at < ?
       AND (hidden_at IS NULL OR video_id NOT IN (SELECT video_id FROM videos))`,
    [beforeMs],
  );
}

// --- trechos salvos como nota atômica (Destaques) ---------------------------
export function getClips(videoId: string): Record<string, ClipRecord> {
  const rows = conn().getAllSync<ClipRecord>(
    'SELECT block_key, video_id, label, title, drive_file_id, created_at FROM clips WHERE video_id = ?',
    [videoId],
  );
  const map: Record<string, ClipRecord> = {};
  for (const r of rows) map[r.block_key] = r;
  return map;
}

// Substitui a SELEÇÃO de trechos do vídeo (todos compartilham o id da única
// nota de Destaques). Transacional: limpa e reinsere.
export function replaceClips(
  videoId: string,
  records: { block_key: string; label: string; title: string }[],
  driveFileId: string,
): void {
  const d = conn();
  const now = nowIso();
  d.withTransactionSync(() => {
    d.runSync('DELETE FROM clips WHERE video_id = ?', [videoId]);
    for (const r of records) {
      d.runSync(
        'INSERT INTO clips (video_id, block_key, label, title, drive_file_id, created_at) VALUES (?,?,?,?,?,?)',
        [videoId, r.block_key, r.label, r.title, driveFileId, now],
      );
    }
  });
}

export function clearClips(videoId: string): void {
  conn().runSync('DELETE FROM clips WHERE video_id = ?', [videoId]);
}

// --- 👍/👎: os exemplos de treino da rede neural local (neural.ts) -----------
// Cada marcação guarda o que a rede precisa ver, mesmo que o vídeo saia do banco ou
// tenha sido marcado no outro aparelho.

export function getThumbs(): ThumbRecord[] {
  return conn().getAllSync<ThumbRecord>('SELECT * FROM thumbs ORDER BY updated_at');
}

export function getThumbValue(videoId: string): number {
  return (
    conn().getFirstSync<{ value: number }>('SELECT value FROM thumbs WHERE video_id = ?', [videoId])
      ?.value ?? 0
  );
}

export function setThumb(v: VideoRecord, value: number): void {
  upsertThumb({
    video_id: v.video_id,
    value,
    updated_at: Date.now(),
    neutral_title: v.neutral_title,
    original_title: v.original_title,
    channel: v.channel,
    channel_id: v.channel_id,
    pillar: v.pillar,
    resumo: (v.resumo || '').slice(0, 300),
    score: v.score,
    is_clickbait: v.is_clickbait ? 1 : 0,
    duration: v.duration,
  });
}

export function upsertThumb(t: ThumbRecord): void {
  conn().runSync(
    `INSERT OR REPLACE INTO thumbs
       (video_id, value, updated_at, neutral_title, original_title, channel, channel_id, pillar, resumo, score, is_clickbait, duration)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      t.video_id,
      t.value,
      t.updated_at,
      t.neutral_title ?? '',
      t.original_title ?? '',
      t.channel ?? '',
      t.channel_id ?? '',
      t.pillar ?? '',
      t.resumo ?? '',
      t.score ?? 0,
      t.is_clickbait ? 1 : 0,
      t.duration ?? '',
    ],
  );
}

export function clearThumbs(): void {
  conn().runSync('DELETE FROM thumbs');
}

// --- Pular / 👎 + canais silenciados (L1) + dataset de feedback (L2) ---------

const AUTO_MUTE_SKIPS = 10; // pular N vídeos de um canal (sem salvar nenhum) → silencia

export interface ChannelPref {
  channel_id: string;
  channel: string;
  state: 'muted' | 'allowed';
  updated_at: string;
}

export interface FeedbackVideo {
  neutral_title: string;
  original_title: string;
  channel: string;
  pillar: string;
  resumo: string;
  score: number;
}

// Pula o vídeo (some do feed) e, se o canal acumular skips SEM nenhum
// salvamento, auto-silencia o canal — a menos que o usuário já tenha decidido.
export function skipVideo(videoId: string): void {
  const d = conn();
  d.runSync('UPDATE videos SET skipped = 1 WHERE video_id = ?', [videoId]);
  const v = d.getFirstSync<{ channel_id: string; channel: string }>(
    'SELECT channel_id, channel FROM videos WHERE video_id = ?',
    [videoId],
  );
  if (!v?.channel_id) return;
  const decided = d.getFirstSync<{ n: number }>(
    'SELECT 1 AS n FROM channel_prefs WHERE channel_id = ?',
    [v.channel_id],
  );
  if (decided) return; // já está 'muted' ou 'allowed' → não auto-altera
  const stats = d.getFirstSync<{ skips: number; saves: number }>(
    `SELECT SUM(CASE WHEN COALESCE(skipped,0)=1 THEN 1 ELSE 0 END) AS skips,
            SUM(CASE WHEN COALESCE(saved_drive,0)=1 THEN 1 ELSE 0 END) AS saves
       FROM videos WHERE channel_id = ?`,
    [v.channel_id],
  );
  if ((stats?.skips ?? 0) >= AUTO_MUTE_SKIPS && (stats?.saves ?? 0) === 0) {
    d.runSync(
      'INSERT OR REPLACE INTO channel_prefs (channel_id, channel, state, updated_at) VALUES (?,?,?,?)',
      [v.channel_id, v.channel || '', 'muted', nowIso()],
    );
  }
}

export function unskipVideo(videoId: string): void {
  conn().runSync('UPDATE videos SET skipped = 0 WHERE video_id = ?', [videoId]);
}

export function getMutedChannels(): ChannelPref[] {
  return conn().getAllSync<ChannelPref>(
    "SELECT channel_id, channel, state, updated_at FROM channel_prefs WHERE state = 'muted' ORDER BY updated_at DESC",
  );
}

export function setChannelState(
  channelId: string,
  channel: string,
  state: 'muted' | 'allowed',
): void {
  conn().runSync(
    'INSERT OR REPLACE INTO channel_prefs (channel_id, channel, state, updated_at) VALUES (?,?,?,?)',
    [channelId, channel, state, nowIso()],
  );
}

export function mutedChannelIds(): string[] {
  return conn()
    .getAllSync<{ channel_id: string }>(
      "SELECT channel_id FROM channel_prefs WHERE state = 'muted'",
    )
    .map((r) => r.channel_id);
}

export function countSkips(): number {
  return (
    conn().getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM videos WHERE COALESCE(skipped,0)=1',
    )?.n ?? 0
  );
}

// Exemplos rotulados para a destilação L2: negativos = pulados; positivos =
// salvos no Drive OU com algum Destaque.
export function getFeedbackExamples(limit = 40): {
  negatives: FeedbackVideo[];
  positives: FeedbackVideo[];
} {
  const sel = 'neutral_title, original_title, channel, pillar, resumo, score';
  const negatives = conn().getAllSync<FeedbackVideo>(
    `SELECT ${sel} FROM videos WHERE COALESCE(skipped,0)=1 ORDER BY fetched_at DESC LIMIT ?`,
    [limit],
  );
  const positives = conn().getAllSync<FeedbackVideo>(
    `SELECT ${sel} FROM videos
       WHERE COALESCE(saved_drive,0)=1
          OR video_id IN (SELECT DISTINCT video_id FROM clips)
       ORDER BY fetched_at DESC LIMIT ?`,
    [limit],
  );
  return { negatives, positives };
}

export function setAudioFile(videoId: string, filename: string | null): void {
  conn().runSync('UPDATE videos SET audio_file = ? WHERE video_id = ?', [filename, videoId]);
}

// --- transcrição (legendas do YouTube, Parakeet no celular ou o Mac) --------
export function setTranscript(
  videoId: string,
  transcript: Transcript,
  source: TranscriptSource,
): void {
  conn().runSync(
    `UPDATE videos SET transcript_text = ?, transcript_segments = ?, transcript_source = ?,
       transcript_available = 1 WHERE video_id = ?`,
    [transcript.text, JSON.stringify(transcript.segments ?? []), source, videoId],
  );
}

export function getTranscriptSegments(video: VideoRecord): { ts: string; text: string }[] {
  try {
    const segs = video.transcript_segments ? JSON.parse(video.transcript_segments) : [];
    return Array.isArray(segs) ? segs : [];
  } catch {
    return [];
  }
}

// Reescreve SÓ os campos da análise (mantém lido/salvo/destaques/transcrição).
export function updateAnalysis(videoId: string, a: Analysis, source: ContentSource): void {
  conn().runSync(
    `UPDATE videos SET pillar = ?, score = ?, is_clickbait = ?, neutral_title = ?, a_real = ?,
       resumo = ?, pontos_chave = ?, fatos = ?, citacoes = ?, evidencias = ?, content_source = ?
     WHERE video_id = ?`,
    [
      a.pillar, a.score, a.is_clickbait, a.neutral_title, a.a_real, a.resumo,
      JSON.stringify(a.pontos_chave ?? []), JSON.stringify(a.fatos ?? []),
      JSON.stringify(a.citacoes ?? []), JSON.stringify(a.evidencias ?? []),
      source, videoId,
    ],
  );
}

export type AsrStatus = 'done' | 'failed' | 'skipped';

// Uma falha da transcrição automática (rede, yt-dlp desatualizado…) não tira o
// vídeo da fila para sempre: ele volta depois de ASR_RETRY_MS, até ASR_MAX_TRIES.
export const ASR_MAX_TRIES = 3;
export const ASR_RETRY_MS = 6 * 3600 * 1000;

export function setAsrStatus(
  videoId: string,
  status: AsrStatus | null,
  error: string | null = null,
): void {
  conn().runSync(
    `UPDATE videos SET asr_status = ?, asr_error = ?, asr_at = ?,
       asr_tries = CASE WHEN ? = 'failed' THEN COALESCE(asr_tries, 0) + 1 ELSE asr_tries END
     WHERE video_id = ?`,
    [status, error, nowIso(), status, videoId],
  );
}

// Fila da transcrição automática: vídeos triados só por metadados (sem
// legenda) nos últimos 14 dias, ainda não lidos/pulados, de canais não
// silenciados — mais novos primeiro (quem ordena pela nota e aplica o limiar
// é o useTranscribeStore, com a nota ajustada pela rede local, como o feed).
// O próprio banco é a fila (sobrevive a fechar o app).
export function autoTranscribeCandidates(limit = 200): VideoRecord[] {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const retryBefore = new Date(Date.now() - ASR_RETRY_MS).toISOString();
  return conn()
    .getAllSync<Record<string, unknown>>(
      `SELECT * FROM videos
        WHERE content_source = 'metadata' AND COALESCE(transcript_text, '') = ''
          AND (asr_status IS NULL OR (asr_status = 'failed'
               AND COALESCE(asr_tries, 1) < ? AND COALESCE(asr_at, '') < ?))
          AND COALESCE(skipped, 0) = 0 AND COALESCE(read, 0) = 0 AND ${NOT_HIDDEN}
          AND COALESCE(source, 'youtube') = 'youtube'
          AND fetched_at >= ?
          AND COALESCE(channel_id, '') NOT IN
              (SELECT channel_id FROM channel_prefs WHERE state = 'muted')
        ORDER BY published_at DESC LIMIT ?`,
      [ASR_MAX_TRIES, retryBefore, since, limit],
    )
    .map(rowToRecord);
}

/** A falha mais recente da transcrição automática (para os Ajustes mostrarem o motivo). */
export function lastAsrFailure(): {
  video_id: string;
  title: string;
  error: string;
  at: string;
  tries: number;
} | null {
  return conn().getFirstSync<{ video_id: string; title: string; error: string; at: string; tries: number }>(
    `SELECT video_id, COALESCE(NULLIF(neutral_title, ''), original_title, '') AS title,
            COALESCE(asr_error, '') AS error, COALESCE(asr_at, '') AS at, COALESCE(asr_tries, 1) AS tries
       FROM videos WHERE asr_status = 'failed' AND asr_at IS NOT NULL
      ORDER BY asr_at DESC LIMIT 1`,
  );
}

// Têm transcrição mas a triagem ainda é a provisória (a nova análise falhou —
// sem rede, cota da IA — ou não havia chave): refazer quando der.
export function retriageCandidates(limit = 5): VideoRecord[] {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  return conn()
    .getAllSync<Record<string, unknown>>(
      `SELECT * FROM videos
        WHERE content_source = 'metadata' AND COALESCE(transcript_text, '') <> ''
          AND COALESCE(skipped, 0) = 0 AND ${NOT_HIDDEN} AND COALESCE(source, 'youtube') = 'youtube'
          AND fetched_at >= ?
        ORDER BY score DESC, published_at DESC LIMIT ?`,
      [since, limit],
    )
    .map(rowToRecord);
}

// --- transcrições do Mac à espera do vídeo (desktopTranscripts.ts) -----------
export interface DesktopTranscriptRow {
  video_id: string;
  texto: string;
  fonte: 'youtube' | 'whisper';
  idioma: string | null;
  titulo: string | null;
  em: number; // epoch ms (quando o Mac transcreveu)
}

/** O vídeo está no banco? Com transcrição? */
export function transcriptState(videoId: string): 'missing' | 'empty' | 'has' {
  const row = conn().getFirstSync<{ t: string | null }>(
    'SELECT transcript_text AS t FROM videos WHERE video_id = ?',
    [videoId],
  );
  if (!row) return 'missing';
  return (row.t || '').trim() ? 'has' : 'empty';
}

export function putDesktopTranscript(r: DesktopTranscriptRow): void {
  conn().runSync(
    `INSERT INTO desktop_transcripts (video_id, texto, fonte, idioma, titulo, em) VALUES (?,?,?,?,?,?)
     ON CONFLICT(video_id) DO UPDATE SET texto = excluded.texto, fonte = excluded.fonte,
       idioma = excluded.idioma, titulo = excluded.titulo, em = excluded.em
     WHERE excluded.em >= desktop_transcripts.em`,
    [r.video_id, r.texto, r.fonte, r.idioma, r.titulo, r.em],
  );
}

export function getDesktopTranscript(videoId: string): DesktopTranscriptRow | null {
  return conn().getFirstSync<DesktopTranscriptRow>(
    'SELECT * FROM desktop_transcripts WHERE video_id = ?',
    [videoId],
  );
}

/** As que esperavam e cujo vídeo já chegou ao banco. */
export function desktopTranscriptsArrived(): DesktopTranscriptRow[] {
  return conn().getAllSync<DesktopTranscriptRow>(
    `SELECT d.* FROM desktop_transcripts d JOIN videos v ON v.video_id = d.video_id ORDER BY d.em DESC`,
  );
}

export function deleteDesktopTranscript(videoId: string): void {
  conn().runSync('DELETE FROM desktop_transcripts WHERE video_id = ?', [videoId]);
}

export function pruneDesktopTranscripts(olderThanMs: number): void {
  conn().runSync('DELETE FROM desktop_transcripts WHERE em < ?', [olderThanMs]);
}

export function countDesktopTranscriptsWaiting(): number {
  return conn().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM desktop_transcripts')?.n ?? 0;
}

export function setTranscriptText(videoId: string, text: string): void {
  conn().runSync('UPDATE videos SET transcript_text = ? WHERE video_id = ?', [text, videoId]);
}

// Substitui os fatos (flashcards) do vídeo — usado ao gerar cartões a partir
// de uma resposta de Q&A/checagem.
export function setFatos(videoId: string, fatos: unknown[]): void {
  conn().runSync('UPDATE videos SET fatos = ? WHERE video_id = ?', [
    JSON.stringify(fatos ?? []),
    videoId,
  ]);
}

// --- Q&A e checagem externa por vídeo (estilo NotebookLM) -------------------
export function addQa(
  videoId: string,
  question: string,
  answer: string,
  kind: QAKind = 'ask',
  sources: Source[] = [],
): number {
  const res = conn().runSync(
    'INSERT INTO qa (video_id, kind, question, answer, sources, created_at) VALUES (?,?,?,?,?,?)',
    [videoId, kind, question, answer, JSON.stringify(sources ?? []), nowIso()],
  );
  return res.lastInsertRowId;
}

function qaRowToItem(row: Record<string, unknown>): QAItem {
  let sources: Source[] = [];
  try {
    sources = row.sources ? (JSON.parse(String(row.sources)) as Source[]) : [];
  } catch {
    sources = [];
  }
  return {
    id: Number(row.id),
    kind: (row.kind as QAKind) || 'ask',
    question: String(row.question ?? ''),
    answer: String(row.answer ?? ''),
    sources,
    saved_note: row.saved_note ? 1 : 0,
    created_at: String(row.created_at ?? ''),
  };
}

export function getQa(videoId: string): QAItem[] {
  return conn()
    .getAllSync<Record<string, unknown>>(
      'SELECT id, kind, question, answer, sources, saved_note, created_at FROM qa WHERE video_id = ? ORDER BY id',
      [videoId],
    )
    .map(qaRowToItem);
}

export function markQaSaved(id: number, value: 0 | 1 = 1): void {
  conn().runSync('UPDATE qa SET saved_note = ? WHERE id = ?', [value, id]);
}

// --- meta (chave/valor) ------------------------------------------------------
export function getMeta(key: string): string | null {
  const row = conn().getFirstSync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  conn().runSync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
