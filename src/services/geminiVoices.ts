// CATÁLOGO DE VOZES do Gemini 3.8 TTS.
//
// Duas fontes:
//  - as 30 vozes PADRÃO (GEMINI_VOICES, em geminiTTS.ts): falam qualquer idioma;
//  - a BIBLIOTECA ESTENDIDA (2.000+ vozes, 100+ idiomas e sotaques), lida do
//    endpoint GET /v1beta/voices, que filtra por idioma, gênero, sotaque e busca.
//    Só funciona com os modelos 3.8.
//
// O formato exato da resposta do endpoint não está formalizado na documentação, então
// a leitura é tolerante: aceita snake_case e camelCase e vários nomes de campo.

import { getApiKey } from './secureStore';
import { getKV, setKV } from './database';

export type VoiceGender = 'female' | 'male' | 'neutral';

export interface CatalogVoice {
  /** O id usado em speech_config (nome da voz padrão ou id da biblioteca). */
  id: string;
  label: string;
  gender: VoiceGender | null;
  /** Códigos BCP-47 em que a voz foi criada (vazio = multilíngue). */
  languages: string[];
  accent: string | null;
  description: string | null;
  source: 'prebuilt' | 'library';
}

export interface LanguageGroup {
  key: string;
  label: string;
  /** Códigos BCP-47 enviados no filtro `language_code`. */
  codes: string[];
}

/** Idiomas oferecidos no filtro (a biblioteca cobre mais; "Todos" não filtra). */
export const LANGUAGE_GROUPS: LanguageGroup[] = [
  { key: 'pt', label: 'Português', codes: ['pt-BR', 'pt-PT'] },
  { key: 'en', label: 'Inglês', codes: ['en-US', 'en-GB', 'en-AU', 'en-IN'] },
  { key: 'es', label: 'Espanhol', codes: ['es-ES', 'es-MX', 'es-US', 'es-AR'] },
  { key: 'fr', label: 'Francês', codes: ['fr-FR', 'fr-CA'] },
  { key: 'de', label: 'Alemão', codes: ['de-DE'] },
  { key: 'it', label: 'Italiano', codes: ['it-IT'] },
  { key: 'ja', label: 'Japonês', codes: ['ja-JP'] },
  { key: 'ko', label: 'Coreano', codes: ['ko-KR'] },
  { key: 'zh', label: 'Chinês', codes: ['zh-CN', 'zh-TW'] },
  { key: 'hi', label: 'Hindi', codes: ['hi-IN'] },
  { key: 'ar', label: 'Árabe', codes: ['ar-EG', 'ar-XA'] },
  { key: 'ru', label: 'Russo', codes: ['ru-RU'] },
  { key: 'tr', label: 'Turco', codes: ['tr-TR'] },
  { key: 'nl', label: 'Holandês', codes: ['nl-NL'] },
  { key: 'pl', label: 'Polonês', codes: ['pl-PL'] },
  { key: 'id', label: 'Indonésio', codes: ['id-ID'] },
];

export interface VoiceFilters {
  /** Chave de LANGUAGE_GROUPS; null = todos os idiomas. */
  language: string | null;
  /** null = todos. */
  gender: VoiceGender | null;
  search: string;
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/voices';
const PAGE_SIZE = 50;

type Json = Record<string, unknown>;

function pickStr(o: Json, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function toGender(v: string | null): VoiceGender | null {
  const g = v?.toLowerCase();
  return g === 'female' || g === 'male' || g === 'neutral' ? g : null;
}

function normalizeVoice(raw: unknown): CatalogVoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Json;
  // "voices/abc" (nome de recurso) → "abc"
  const rawId = pickStr(o, ['id', 'voice_id', 'voiceId', 'name']);
  if (!rawId) return null;
  const id = rawId.replace(/^voices\//, '');
  const languagesRaw = o['language_codes'] ?? o['languageCodes'] ?? o['language_code'] ?? o['languageCode'];
  const languages = (Array.isArray(languagesRaw) ? languagesRaw : [languagesRaw]).filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return {
    id,
    label: pickStr(o, ['display_name', 'displayName', 'title']) ?? id,
    gender: toGender(pickStr(o, ['gender'])),
    languages,
    accent: pickStr(o, ['accent']),
    description: pickStr(o, ['description', 'persona']),
    source: 'library',
  };
}

function findVoiceArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const o = json as Json;
    for (const k of ['voices', 'items', 'results']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    for (const v of Object.values(o)) if (Array.isArray(v)) return v;
  }
  return [];
}

const pageCache = new Map<string, { voices: CatalogVoice[]; next: string | null }>();

/**
 * Uma página de vozes da biblioteca estendida, já filtrada pelo servidor (idioma,
 * gênero, busca). Lança Error com mensagem legível em falha.
 */
export async function listLibraryVoices(
  filters: VoiceFilters,
  pageToken?: string | null,
): Promise<{ voices: CatalogVoice[]; next: string | null }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Sem chave do Gemini — configure em "Como você quer usar?".');

  const parts: string[] = [`page_size=${PAGE_SIZE}`];
  const group = LANGUAGE_GROUPS.find((g) => g.key === filters.language);
  for (const c of group?.codes ?? []) parts.push(`language_code=${encodeURIComponent(c)}`);
  if (filters.gender) parts.push(`gender=${filters.gender}`);
  if (filters.search.trim()) parts.push(`search=${encodeURIComponent(filters.search.trim())}`);
  if (pageToken) parts.push(`page_token=${encodeURIComponent(pageToken)}`);
  const url = `${BASE}?${parts.join('&')}`;

  const hit = pageCache.get(url);
  if (hit) return hit;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'x-goog-api-key': apiKey }, signal: controller.signal });
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'A biblioteca demorou demais para responder.' : 'Sem conexão com a biblioteca de vozes.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(j.error?.message ?? `A biblioteca de vozes respondeu HTTP ${res.status}.`);
  }
  const json = (await res.json()) as unknown;
  const voices = findVoiceArray(json)
    .map(normalizeVoice)
    .filter((v): v is CatalogVoice => !!v);
  const o = (json && typeof json === 'object' ? json : {}) as Json;
  const next = pickStr(o, ['next_page_token', 'nextPageToken']);
  const out = { voices, next };
  pageCache.set(url, out);
  return out;
}

// ——— Nome legível da voz escolhida ———
// Vozes da biblioteca têm ids opacos; guardamos o rótulo quando a pessoa escolhe,
// para a leitura e a tela de voz mostrarem "Camila (pt-BR)" e não o id.

const META_KEY = 'gemini_voice_meta';
let meta: Record<string, string> = {};

export async function loadVoiceMeta(): Promise<void> {
  try {
    const raw = await getKV(META_KEY);
    if (raw) meta = JSON.parse(raw) as Record<string, string>;
  } catch {
    meta = {};
  }
}

export function voiceLabel(id: string): string {
  return meta[id] ?? id;
}

export async function rememberVoice(v: CatalogVoice): Promise<void> {
  const label = v.languages[0] ? `${v.label} (${v.languages[0]})` : v.label;
  meta[v.id] = label;
  try {
    await setKV(META_KEY, JSON.stringify(meta));
  } catch {
    /* só o rótulo se perde */
  }
}
