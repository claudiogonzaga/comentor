// BARALHOS DE ÁUDIO.
//
// Em vez de gerar a voz de cada frase pela API (texto → TTS), a pessoa importa um
// ZIP com trechos de áudio prontos — por exemplo, passagens de um audiolivro — e o
// app os toca nos alertas de inspiração. Zero chamada de API.
//
// Cada baralho é independente (pode haver vários), toca ALEATÓRIO ou NA SEQUÊNCIA, e
// cada trecho acumula quantos 👍/👎 recebeu e quantas vezes tocou. O baralho pode ser
// exportado de volta para um ZIP COM essas estatísticas e reimportado depois.
//
// O ZIP é lido em fluxo (pedaços de 512 KB) e escrito em fluxo: nunca fica inteiro
// na memória, então aguenta arquivos de centenas de MB.

import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Platform, ToastAndroid } from 'react-native';
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import {
  AUDIO_CLIP_MAX_MS,
  addAudioClipPlays,
  addAudioClips,
  createAudioDeck,
  deleteAudioDeckRows,
  listAudioClips,
  listAudioDecks,
  setAudioClipDuration,
  type NewAudioClip,
} from './database';
import { parseCsv } from './inspirationLibrary';
import { claimPlayback, registerPlayer } from './playerBus';
import type { AudioClip } from '../types';

/** O formato que o importador aceita — também mostrado na tela. */
export const AUDIO_DECK_SPEC = {
  extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac'] as const,
  /** Tamanho máximo de UM trecho. */
  maxClipBytes: 12 * 1024 * 1024,
  maxClips: 500,
  maxZipBytes: 300 * 1024 * 1024,
  maxClipSeconds: AUDIO_CLIP_MAX_MS / 1000,
};

const CHUNK = 512 * 1024;

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function isJunk(path: string): boolean {
  const b = baseName(path);
  return path.startsWith('__MACOSX/') || b.startsWith('._') || b === '.DS_Store' || b === 'Thumbs.db';
}

/** Ordenação "natural": 2 vem antes de 10. */
function naturalCompare(a: string, b: string): number {
  const ra = a.toLowerCase().split(/(\d+)/);
  const rb = b.toLowerCase().split(/(\d+)/);
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    if (ra[i] === rb[i]) continue;
    const na = parseInt(ra[i], 10);
    const nb = parseInt(rb[i], 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === ra[i] && String(nb) === rb[i]) return na - nb;
    return ra[i] < rb[i] ? -1 : 1;
  }
  return ra.length - rb.length;
}

/** "012_o-poder-do-habito.mp3" → "o poder do habito". */
function titleFromFile(fileName: string): string {
  return (
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/^[\d\s._-]+/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || fileName.replace(/\.[^.]+$/, '')
  );
}

function deckDir(deckId: number): Directory {
  return new Directory(Paths.document, 'audiodecks', String(deckId));
}

export function clipUri(deckId: number, fileName: string): string {
  return new File(Paths.document, 'audiodecks', String(deckId), fileName).uri;
}

function clipFileExists(deckId: number, fileName: string): boolean {
  try {
    return new File(Paths.document, 'audiodecks', String(deckId), fileName).exists;
  } catch {
    return false;
  }
}

/** O arquivo do trecho ainda existe? (um backup restaurado não traz os áudios.) */
export function clipAvailable(c: Pick<AudioClip, 'deckId' | 'fileName'>): boolean {
  return clipFileExists(c.deckId, c.fileName);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mede a duração (ms) abrindo o arquivo no player. null se não conseguiu em ~2 s. */
async function probeDuration(uri: string): Promise<number | null> {
  let p: AudioPlayer | null = null;
  try {
    p = createAudioPlayer({ uri });
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const d = p.duration;
      if (typeof d === 'number' && Number.isFinite(d) && d > 0) return Math.round(d * 1000);
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      p?.remove();
    } catch {
      /* já liberado */
    }
  }
}

// ——— Manifesto (CSV opcional) ———

interface ManifestRow {
  title?: string;
  text?: string;
  author?: string;
  /** Ordem de leitura (número): manda na ordem dos trechos, acima do nome do arquivo. */
  order?: number;
  /** Onde o trecho está na obra, já montado ("Cap. 2 · p. 14"). */
  reference?: string;
  page?: string;
  chapter?: string;
  rating?: -1 | 0 | 1;
  likes?: number;
  dislikes?: number;
  plays?: number;
  lastPlayedAt?: string;
}

function normKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const COLS: Record<string, keyof ManifestRow | 'file'> = {
  arquivo: 'file', file: 'file', filename: 'file',
  ordem: 'order', order: 'order', posicao: 'order', sequencia: 'order', ordemdeleitura: 'order',
  referencia: 'reference', ref: 'reference', localizacao: 'reference',
  pagina: 'page', paginas: 'page', pag: 'page', page: 'page',
  capitulo: 'chapter', cap: 'chapter', chapter: 'chapter', parte: 'chapter',
  titulo: 'title', title: 'title',
  texto: 'text', text: 'text', transcricao: 'text',
  autor: 'author', author: 'author', fonte: 'author',
  nota: 'rating', rating: 'rating',
  curtidas: 'likes', likes: 'likes',
  descurtidas: 'dislikes', dislikes: 'dislikes',
  execucoes: 'plays', plays: 'plays', reproducoes: 'plays',
  ultimaexecucao: 'lastPlayedAt', lastplayed: 'lastPlayedAt',
};

/** Separador pela 1ª linha lógica (fora de aspas): o que mais aparece entre , ; e tab. */
function manifestDelimiter(csv: string): string {
  const text = csv.replace(/^﻿/, '');
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of text) {
    if (ch === '"') q = !q;
    else if (!q && (ch === '\n' || ch === '\r')) {
      if (Object.values(counts).some((n) => n > 0)) break;
    } else if (!q && ch in counts) counts[ch]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',');
}

/** Chave estável de nome de arquivo: acentos compostos iguais, minúsculas. */
function fileKey(name: string): string {
  return baseName(name).normalize('NFC').toLowerCase();
}

/** Lê o manifesto → mapa (nome do arquivo em minúsculas → dados). */
function parseManifest(csv: string): Map<string, ManifestRow> {
  const rows = parseCsv(csv, manifestDelimiter(csv));
  const out = new Map<string, ManifestRow>();
  if (!rows.length) return out;
  const header = rows[0].map((h) => COLS[normKey(h)] ?? null);
  const hasHeader = header.includes('file');
  const cols: (keyof ManifestRow | 'file' | null)[] = hasHeader ? header : ['file', 'text', 'author'];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const row: ManifestRow = {};
    let file = '';
    cols.forEach((c, i) => {
      const v = (r[i] ?? '').trim();
      if (!c || !v) return;
      if (c === 'file') file = fileKey(v);
      else if (c === 'rating') {
        const n = parseInt(v, 10);
        row.rating = n > 0 ? 1 : n < 0 ? -1 : 0;
      } else if (c === 'likes' || c === 'dislikes' || c === 'plays') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) row[c] = n;
      } else if (c === 'order') {
        const n = parseFloat(v.replace(',', '.'));
        if (Number.isFinite(n)) row.order = n;
      } else (row as Record<string, unknown>)[c] = v;
    });
    // Referência = o que vier escrito + capítulo + página ("Cap. 2 · p. 14").
    const refParts = [
      row.reference,
      row.chapter ? (/^\d+$/.test(row.chapter) ? `Cap. ${row.chapter}` : row.chapter) : undefined,
      row.page ? (/^[\d\s\-–,]+$/.test(row.page) ? `p. ${row.page}` : row.page) : undefined,
    ].filter(Boolean);
    row.reference = refParts.length ? refParts.join(' · ') : undefined;
    if (file) out.set(file, row);
  }
  return out;
}

// ——— Importação ———

export interface ImportAudioDeckResult {
  deckId: number | null;
  name: string;
  imported: number;
  /** Trechos acima do limite de duração: ficam no baralho, mas não tocam nos alertas. */
  tooLong: number;
  skipped: { name: string; reason: string }[];
  restoredStats: boolean;
  error?: string;
}

function fail(error: string): ImportAudioDeckResult {
  return { deckId: null, name: '', imported: 0, tooLong: 0, skipped: [], restoredStats: false, error };
}

export async function importAudioDeckFromZip(
  onProgress?: (msg: string) => void,
): Promise<ImportAudioDeckResult> {
  let res;
  try {
    res = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    return fail('Não consegui abrir o seletor de arquivos.');
  }
  if (res.canceled || !res.assets?.[0]) return { ...fail(''), error: undefined };
  const asset = res.assets[0];
  if (!/\.zip$/i.test(asset.name ?? '')) return fail('Escolha um arquivo .zip com os trechos de áudio.');

  const zipFile = new File(asset.uri);
  const total = zipFile.size || asset.size || 0;
  if (total > AUDIO_DECK_SPEC.maxZipBytes) {
    return fail(`O zip tem ${Math.round(total / 1048576)} MB; o limite é ${AUDIO_DECK_SPEC.maxZipBytes / 1048576} MB. Divida em dois baralhos.`);
  }

  const deckName = (asset.name ?? 'Baralho de áudio').replace(/\.zip$/i, '').trim() || 'Baralho de áudio';
  onProgress?.('Criando o baralho…');
  let deckId: number;
  try {
    deckId = await createAudioDeck(deckName, 'random');
  } catch {
    return fail('Não consegui criar o baralho no banco de dados.');
  }
  const dir = deckDir(deckId);
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    await deleteAudioDeckRows(deckId).catch(() => {});
    return fail('Não consegui criar a pasta do baralho no aparelho.');
  }

  const skipped: { name: string; reason: string }[] = [];
  const saved: { path: string; savedName: string }[] = [];
  let manifestCsv = '';
  let deckJson: { name?: string; playMode?: string } | null = null;
  let aborted: string | null = null;

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (f) => {
    const path = f.name;
    // Entrada que não usamos: INICIA com um ouvinte vazio. Sem start(), o fflate
    // guarda os bytes dela na memória até o fim — um .jpg ou .pdf grande no zip
    // acumularia centenas de MB.
    const discard = () => {
      f.ondata = () => {};
      try {
        f.start();
      } catch {
        /* sem decodificador: já foi ignorada */
      }
    };
    if (path.endsWith('/') || isJunk(path)) return discard();
    const ext = extOf(path);
    const base = baseName(path).toLowerCase();
    const isAudio = (AUDIO_DECK_SPEC.extensions as readonly string[]).includes(ext);
    const isManifest = ext === 'csv' && !manifestCsv;
    const isJson = base === 'deck.json';
    if (!isAudio && !isManifest && !isJson) return discard();
    if (isAudio && saved.length >= AUDIO_DECK_SPEC.maxClips) {
      skipped.push({ name: baseName(path), reason: `passou de ${AUDIO_DECK_SPEC.maxClips} trechos` });
      return discard();
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    let tooBig = false;
    f.ondata = (err, chunk, final) => {
      if (err) {
        skipped.push({ name: baseName(path), reason: 'arquivo corrompido no zip' });
        return;
      }
      if (!tooBig) {
        size += chunk.length;
        if (isAudio && size > AUDIO_DECK_SPEC.maxClipBytes) {
          tooBig = true;
          parts.length = 0;
          skipped.push({ name: baseName(path), reason: `maior que ${AUDIO_DECK_SPEC.maxClipBytes / 1048576} MB` });
        } else {
          parts.push(chunk);
        }
      }
      if (!final || tooBig) return;
      const all = new Uint8Array(size);
      let o = 0;
      for (const p of parts) {
        all.set(p, o);
        o += p.length;
      }
      if (isAudio) {
        const savedName = `${String(saved.length + 1).padStart(4, '0')}.${ext}`;
        try {
          const out = new File(dir, savedName);
          out.create({ overwrite: true });
          out.write(all);
          saved.push({ path, savedName });
        } catch {
          skipped.push({ name: baseName(path), reason: 'não consegui gravar no aparelho' });
        }
      } else if (isManifest) {
        manifestCsv = strFromU8(all);
      } else if (isJson) {
        try {
          deckJson = JSON.parse(strFromU8(all));
        } catch {
          /* deck.json ilegível: ignora */
        }
      }
    };
    try {
      f.start();
    } catch {
      skipped.push({ name: baseName(path), reason: 'compressão não suportada' });
    }
  };

  onProgress?.('Extraindo os trechos…');
  try {
    const handle = zipFile.open();
    try {
      let read = 0;
      while (read < total && !aborted) {
        const len = Math.min(CHUNK, total - read);
        const bytes = handle.readBytes(len);
        if (!bytes.length) break;
        read += bytes.length;
        unzip.push(bytes, read >= total);
        if (read % (CHUNK * 8) === 0) await sleep(0); // respira: deixa a UI atualizar
      }
    } finally {
      handle.close();
    }
  } catch (e) {
    aborted = e instanceof Error ? e.message : 'zip ilegível';
  }
  try {
    zipFile.delete(); // a cópia no cache já cumpriu o papel
  } catch {
    /* ignore */
  }

  if (aborted || saved.length === 0) {
    try {
      dir.delete();
    } catch {
      /* ignore */
    }
    await deleteAudioDeckRows(deckId).catch(() => {});
    const why = skipped.length
      ? ` Ignorados: ${skipped.slice(0, 4).map((s) => `${s.name} (${s.reason})`).join('; ')}${skipped.length > 4 ? '…' : ''}.`
      : '';
    return {
      ...fail(
        aborted
          ? `Não consegui ler o zip: ${aborted}`
          : `Nenhum áudio válido no zip. Use ${AUDIO_DECK_SPEC.extensions.join(', ')}, até ${AUDIO_DECK_SPEC.maxClipBytes / 1048576} MB cada.${why}`,
      ),
      skipped,
    };
  }

  try {
    // Ordem: a coluna "Ordem" do deck.csv manda (é a ordem de leitura da obra); sem
    // ela, o nome do arquivo em ordem natural (001, 002 … 010).
    const manifest = manifestCsv ? parseManifest(manifestCsv) : new Map<string, ManifestRow>();
    saved.sort((a, b) => {
      const oa = manifest.get(fileKey(a.path))?.order;
      const ob = manifest.get(fileKey(b.path))?.order;
      if (oa != null && ob != null && oa !== ob) return oa - ob;
      if (oa != null && ob == null) return -1;
      if (oa == null && ob != null) return 1;
      return naturalCompare(a.path, b.path);
    });
    let restoredStats = false;
    const clips: NewAudioClip[] = saved.map((s, i) => {
      const m = manifest.get(fileKey(s.path));
      if (m && (m.likes != null || m.dislikes != null || m.plays != null || m.rating != null)) restoredStats = true;
      return {
        ord: i,
        fileName: s.savedName,
        title: m?.title || titleFromFile(baseName(s.path)),
        text: m?.text ?? null,
        author: m?.author ?? null,
        reference: m?.reference ?? null,
        durationMs: null,
        rating: m?.rating,
        likes: m?.likes,
        dislikes: m?.dislikes,
        plays: m?.plays,
        lastPlayedAt: m?.lastPlayedAt ?? null,
      };
    });
    await addAudioClips(deckId, clips);

    // Nome/modo vindos de um backup (deck.json).
    const dj = deckJson as { name?: string; playMode?: string } | null;
    const { renameAudioDeck, setAudioDeckMode } = await import('./database');
    if (dj?.name && typeof dj.name === 'string') await renameAudioDeck(deckId, dj.name.slice(0, 80));
    if (dj?.playMode === 'sequence') await setAudioDeckMode(deckId, 'sequence');

    // Mede a duração (4 por vez): trecho acima do limite não toca nos alertas.
    onProgress?.('Medindo a duração dos trechos…');
    const stored = await listAudioClips(deckId);
    let tooLong = 0;
    let next = 0;
    const worker = async () => {
      while (next < stored.length) {
        const c = stored[next++];
        const ms = await probeDuration(clipUri(deckId, c.fileName));
        if (ms != null) {
          await setAudioClipDuration(c.id, ms);
          if (ms > AUDIO_CLIP_MAX_MS) tooLong++;
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    const finalName = (dj?.name && typeof dj.name === 'string' ? dj.name : deckName).slice(0, 80);
    return { deckId, name: finalName, imported: saved.length, tooLong, skipped, restoredStats };
  } catch (e) {
    try {
      dir.delete();
    } catch {
      /* ignore */
    }
    await deleteAudioDeckRows(deckId).catch(() => {});
    return { ...fail(`Falha ao salvar o baralho: ${e instanceof Error ? e.message : 'erro desconhecido'}`), skipped };
  }
}

// ——— Exportação (backup do baralho com as estatísticas) ———

function csvField(v: string | number | null | undefined): string {
  const s = (v ?? '').toString();
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'trecho';
}

/**
 * Gera um ZIP do baralho — os áudios, um `deck.csv` com texto, autor, nota, curtidas,
 * descurtidas, execuções e última execução de cada trecho, e um `deck.json` com o nome
 * e o modo — e abre a folha de compartilhamento. Reimportar esse zip restaura tudo.
 */
export async function exportAudioDeck(deckId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'Compartilhamento não disponível neste aparelho.' };
    }
    const deck = (await listAudioDecks()).find((d) => d.id === deckId);
    if (!deck) return { ok: false, error: 'Baralho não encontrado.' };
    const clips = (await listAudioClips(deckId)).filter((c) => clipFileExists(deckId, c.fileName));
    if (!clips.length) return { ok: false, error: 'Os arquivos de áudio deste baralho não estão no aparelho.' };

    const stamp = new Date().toISOString().slice(0, 10);
    const out = new File(Paths.cache, `askeo-baralho-${safeName(deck.name)}_${stamp}.zip`);
    out.create({ overwrite: true });
    let handle: ReturnType<File['open']> | null = out.open();
    let zipError: Error | null = null;
    try {
      const zip = new Zip((err, chunk) => {
        if (err) {
          zipError = err;
          return;
        }
        try {
          handle?.writeBytes(chunk);
        } catch (e) {
          zipError = e instanceof Error ? e : new Error('falha ao gravar o zip');
        }
      });
      const add = (name: string, data: Uint8Array) => {
        const f = new ZipPassThrough(name); // áudio já é comprimido; texto é pequeno
        zip.add(f);
        f.push(data, true);
      };

      const names: string[] = [];
      const lines = ['Ordem,Arquivo,Título,Texto,Autor,Referência,Nota,Curtidas,Descurtidas,Execuções,Última execução'];
      for (const c of clips) {
        const ext = extOf(c.fileName) || 'mp3';
        const name = `${String(c.ord + 1).padStart(3, '0')}-${safeName(c.title)}.${ext}`;
        names.push(name);
        lines.push(
          [c.ord + 1, name, c.title, c.text, c.author, c.reference, c.rating, c.likes, c.dislikes, c.plays, c.lastPlayedAt]
            .map(csvField)
            .join(','),
        );
      }
      add('deck.csv', strToU8('﻿' + lines.join('\r\n')));
      add('deck.json', strToU8(JSON.stringify({ name: deck.name, playMode: deck.playMode, exportedAt: new Date().toISOString() })));
      for (let i = 0; i < clips.length; i++) {
        const bytes = await new File(Paths.document, 'audiodecks', String(deckId), clips[i].fileName).bytes();
        add(names[i], bytes);
        if (zipError) break;
        if (i % 10 === 9) await sleep(0);
      }
      zip.end();
      handle.close();
      handle = null;
      if (zipError) throw zipError;
    } catch (e) {
      try {
        handle?.close();
      } catch {
        /* ignore */
      }
      try {
        out.delete();
      } catch {
        /* ignore */
      }
      return { ok: false, error: e instanceof Error ? e.message : 'erro ao gerar o zip' };
    }
    try {
      await Sharing.shareAsync(out.uri, { mimeType: 'application/zip', dialogTitle: 'Exportar baralho de áudio' });
    } finally {
      try {
        out.delete(); // o zip no cache já foi entregue
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}

/** Apaga TODOS os arquivos de baralhos de áudio (usado por "Apagar todos os meus dados"). */
export function deleteAllAudioDeckFiles(): void {
  stopClip();
  try {
    const root = new Directory(Paths.document, 'audiodecks');
    if (root.exists) root.delete();
  } catch {
    /* ignore */
  }
}

export async function deleteAudioDeck(deckId: number): Promise<void> {
  stopClip();
  try {
    const dir = deckDir(deckId);
    if (dir.exists) dir.delete();
  } catch {
    /* os arquivos ficam órfãos, sem prejuízo */
  }
  await deleteAudioDeckRows(deckId);
}

// ——— Tocar um trecho DENTRO do app ———

let player: AudioPlayer | null = null;
let playingId: number | null = null;
const listeners = new Set<(id: number | null) => void>();

function emit() {
  for (const l of listeners) l(playingId);
}

/** Avisa quem mostra o botão ▶/⏹ de qual trecho está tocando. */
export function subscribeClipPlayback(cb: (id: number | null) => void): () => void {
  listeners.add(cb);
  cb(playingId);
  return () => {
    listeners.delete(cb);
  };
}

export function stopClip(): void {
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {
      /* já liberado */
    }
    player = null;
  }
  if (playingId !== null) {
    playingId = null;
    emit();
  }
}

registerPlayer('audiodeck', stopClip);

/** Aviso curto ("Copiado") — Toast no Android; no resto, silencioso. */
export function notifyShort(msg: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
}

/** Texto de um trecho para copiar: a fala + quem disse + onde está na obra. */
export function clipShareText(c: Pick<AudioClip, 'text' | 'title' | 'author' | 'reference' | 'ord'>, deckName?: string): string {
  const body = (c.text ?? '').trim() || c.title;
  const who = [c.author, c.reference].filter(Boolean).join(' · ');
  const where = deckName ? `${deckName} · trecho ${c.ord + 1}` : '';
  return `${body}${who ? `\n— ${who}` : ''}${where ? `\n(${where})` : ''}`;
}

/** Copia o texto do trecho para a área de transferência. */
export async function copyClipText(c: AudioClip, deckName?: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(clipShareText(c, deckName));
    notifyShort('Texto copiado');
    return true;
  } catch {
    return false;
  }
}

/**
 * Compartilha o ÁUDIO do trecho (WhatsApp, Telegram, e-mail…). Copia para o cache
 * com um nome legível — o arquivo do baralho se chama 0007.mp3 — e abre a folha
 * de compartilhamento do sistema.
 */
export async function shareClipAudio(c: AudioClip): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'Compartilhamento não disponível neste aparelho.' };
    }
    const src = new File(Paths.document, 'audiodecks', String(c.deckId), c.fileName);
    if (!src.exists) return { ok: false, error: 'O arquivo de áudio deste trecho não está no aparelho.' };
    const ext = extOf(c.fileName) || 'mp3';
    const out = new File(Paths.cache, `${String(c.ord + 1).padStart(3, '0')}-${safeName(c.title)}.${ext}`);
    try {
      if (out.exists) out.delete();
    } catch {
      /* ignore */
    }
    src.copy(out);
    const mime =
      ext === 'm4a' || ext === 'aac' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : ext === 'ogg' || ext === 'opus' ? 'audio/ogg' : ext === 'flac' ? 'audio/flac' : 'audio/mpeg';
    try {
      await Sharing.shareAsync(out.uri, { mimeType: mime, dialogTitle: 'Compartilhar trecho de áudio' });
    } finally {
      try {
        out.delete();
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}

/** Toca (ou para, se já estiver tocando) o trecho e conta uma execução. */
export function toggleClip(clip: AudioClip): void {
  if (playingId === clip.id) {
    stopClip();
    return;
  }
  // Sem o arquivo (ex.: depois de restaurar só o banco), não toca nem conta execução.
  if (!clipFileExists(clip.deckId, clip.fileName)) return;
  claimPlayback('audiodeck');
  stopClip();
  try {
    const p = createAudioPlayer({ uri: clipUri(clip.deckId, clip.fileName) });
    player = p;
    playingId = clip.id;
    emit();
    p.addListener('playbackStatusUpdate', (st) => {
      if ((st as { didJustFinish?: boolean })?.didJustFinish && player === p) stopClip();
    });
    p.play();
    void addAudioClipPlays(clip.id, 1).catch(() => {});
  } catch (err) {
    console.warn('toggleClip falhou:', err);
    stopClip();
  }
}
