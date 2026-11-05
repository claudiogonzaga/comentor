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
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8, strToU8 } from 'fflate';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import {
  AUDIO_CLIP_MAX_MS,
  addAudioClipPlays,
  addAudioClips,
  createAudioDeck,
  deleteAudioDeckRows,
  getAudioDeckSeqEnd,
  listAudioClips,
  listAudioDecks,
  setAudioClipDuration,
  type NewAudioClip,
} from './database';
import { parseCsv } from './inspirationLibrary';
import { assinarTexto, compartilharAudio, nomeAssinado } from './assinatura';
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

/** O começo do texto de um trecho, para reconhecê-lo numa versão nova do baralho. */
function clipStartKey(text: string | null): string {
  return normKey(text ?? '').slice(0, 40);
}

/** Mesmo trecho? Um texto recortado curto casa pelo começo do outro; texto curtíssimo, só igual. */
function sameClipStart(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 12 && (a.startsWith(b) || b.startsWith(a));
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

/**
 * Tamanho de cada entrada segundo o diretório central (no fim do zip). Um zip gerado
 * em fluxo (com data descriptor, ex.: o do Finder) não traz o tamanho no cabeçalho
 * local, e o Unzip em fluxo acha o fim da entrada varrendo o conteúdo atrás de
 * "PK…": se o áudio tiver esses bytes por acaso, a entrada sai cortada. Conferindo
 * com o diretório central, o trecho cortado vai para os ignorados em vez de ser
 * gravado pela metade em silêncio. null se não deu para ler (aí não confere).
 */
function centralSizes(zipFile: File, total: number): Map<string, number> | null {
  try {
    const h = zipFile.open();
    try {
      const tailLen = Math.min(total, 22 + 65535); // EOCD + comentário máximo
      h.offset = total - tailLen;
      const tail = h.readBytes(tailLen);
      let e = -1;
      for (let i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
          e = i;
          break;
        }
      }
      if (e < 0) return null;
      const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
      const cdSize = tv.getUint32(e + 12, true);
      const cdOff = tv.getUint32(e + 16, true);
      if (cdOff === 0xffffffff || cdOff + cdSize > total) return null; // zip64: não confere
      h.offset = cdOff;
      const cd = h.readBytes(cdSize);
      const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
      const out = new Map<string, number>();
      let p = 0;
      while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50) {
        const flag = v.getUint16(p + 8, true);
        const usize = v.getUint32(p + 24, true);
        const fnl = v.getUint16(p + 28, true);
        const exl = v.getUint16(p + 30, true);
        const cml = v.getUint16(p + 32, true);
        // mesmo decodificador do Unzip do fflate, para o nome bater com f.name
        const name = strFromU8(cd.subarray(p + 46, p + 46 + fnl), !(flag & 0x800));
        if (usize !== 0xffffffff) out.set(name, usize);
        p += 46 + fnl + exl + cml;
      }
      return out;
    } finally {
      h.close();
    }
  } catch {
    return null;
  }
}

export interface ImportAudioDeckResult {
  deckId: number | null;
  name: string;
  imported: number;
  /** Trechos acima do limite de duração: ficam no baralho, mas não tocam nos alertas. */
  tooLong: number;
  skipped: { name: string; reason: string }[];
  restoredStats: boolean;
  /**
   * Versão nova de um baralho: o nome pedido em "replaces" e quantos trechos herdaram
   * o histórico. `found` falso: não há baralho com esse nome; `inherited` 0: nenhum
   * trecho casou, e o antigo segue ligado. `keptPosition`: a leitura em sequência segue do mesmo ponto.
   */
  replaced?: { name: string; found: boolean; inherited: number; keptPosition: boolean };
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

  const cdSizes = centralSizes(zipFile, total);
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
  let deckJson: { name?: string; playMode?: string; seqEndOrd?: unknown; replaces?: unknown } | null = null;
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
      // Entrada que saiu menor (ou maior) que o diretório central diz: cortada.
      const expected = cdSizes?.get(path);
      if (expected != null && expected !== size) {
        skipped.push({ name: baseName(path), reason: 'arquivo truncado no zip' });
        parts.length = 0;
        return;
      }
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

    // Versão nova de um baralho que já existe (deck.json com "replaces": o nome do
    // antigo). Cada trecho herda o histórico do trecho antigo de mesmo começo de
    // texto: um trecho recortado continua começando igual.
    const dj = deckJson as { name?: string; playMode?: string; seqEndOrd?: unknown; replaces?: unknown } | null;
    const replaces = typeof dj?.replaces === 'string' ? dj.replaces : null;
    // Com nomes repetidos, vale a versão em uso: a ligada e, entre elas, a mais nova.
    const oldDeck =
      (replaces
        ? (await listAudioDecks())
            .filter((k) => k.name === replaces && k.id !== deckId)
            .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.id - a.id)[0]
        : null) ?? null;
    const oldPool = (oldDeck ? await listAudioClips(oldDeck.id) : [])
      .map((clip) => ({ clip, key: clipStartKey(clip.text) }))
      .filter((x) => x.key);
    const takeOld = (text: string | null): AudioClip | undefined => {
      const key = clipStartKey(text);
      const at = key ? oldPool.findIndex((x) => sameClipStart(x.key, key)) : -1;
      return at < 0 ? undefined : oldPool.splice(at, 1)[0].clip;
    };
    const inherited: { oldOrd: number; newOrd: number }[] = [];

    let restoredStats = false;
    const clips: NewAudioClip[] = saved.map((s, i) => {
      const m = manifest.get(fileKey(s.path));
      if (m && (m.likes != null || m.dislikes != null || m.plays != null || m.rating != null)) restoredStats = true;
      const old = takeOld(m?.text ?? null);
      if (old) inherited.push({ oldOrd: old.ord, newOrd: i });
      return {
        ord: i,
        fileName: s.savedName,
        title: m?.title || titleFromFile(baseName(s.path)),
        text: m?.text ?? null,
        author: m?.author ?? null,
        reference: m?.reference ?? null,
        durationMs: null,
        // zero na planilha não apaga o histórico herdado
        rating: m?.rating || old?.rating,
        likes: m?.likes || old?.likes,
        dislikes: m?.dislikes || old?.dislikes,
        plays: m?.plays || old?.plays,
        lastPlayedAt: m?.lastPlayedAt || old?.lastPlayedAt || null,
      };
    });
    await addAudioClips(deckId, clips);

    // Nome/modo vindos de um backup (deck.json).
    const { renameAudioDeck, setAudioDeckEnabled, setAudioDeckMode, setAudioDeckSeqEnd } = await import('./database');
    if (dj?.name && typeof dj.name === 'string') await renameAudioDeck(deckId, dj.name.slice(0, 80));
    if (dj?.playMode === 'sequence') {
      await setAudioDeckMode(deckId, 'sequence');
      // O marcador de leitura do audiolivro: o baralho continua de onde estava.
      const end = dj.seqEndOrd;
      if (typeof end === 'number' && Number.isInteger(end) && end >= -1 && end < clips.length) {
        await setAudioDeckSeqEnd(deckId, end);
      }
    }
    // A leitura segue do mesmo ponto, se o antigo era lido em sequência.
    const keptPosition = !!oldDeck && inherited.length > 0 && oldDeck.playMode === 'sequence';
    if (oldDeck && keptPosition) {
      if (!dj?.playMode) await setAudioDeckMode(deckId, 'sequence');
      if (typeof dj?.seqEndOrd !== 'number') {
        const oldEnd = await getAudioDeckSeqEnd(oldDeck.id);
        const newEnd = inherited.filter((x) => x.oldOrd <= oldEnd).reduce((max, x) => Math.max(max, x.newOrd), -1);
        await setAudioDeckSeqEnd(deckId, newEnd);
      }
    }

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

    // Só com o novo pronto. Desliga, não apaga: apagar é decisão da pessoa.
    if (oldDeck && inherited.length) await setAudioDeckEnabled(oldDeck.id, false);

    const finalName = (dj?.name && typeof dj.name === 'string' ? dj.name : deckName).slice(0, 80);
    return {
      deckId,
      name: finalName,
      imported: saved.length,
      tooLong,
      skipped,
      restoredStats,
      ...(replaces ? { replaced: { name: replaces, found: !!oldDeck, inherited: inherited.length, keptPosition } } : {}),
    };
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

let CRC_TABLE: Uint32Array | null = null;

/** CRC-32 (o do formato zip) dos bytes. */
function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  const t = CRC_TABLE;
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * ZIP sem compressão ("stored") escrito em fluxo, com CRC e TAMANHO no cabeçalho
 * local. O Zip do fflate em fluxo grava o cabeçalho sem tamanho (data descriptor), e
 * o Unzip em fluxo da importação então acha o fim da entrada varrendo os bytes do
 * áudio atrás de "PK…": um áudio que tivesse esses bytes por acaso voltava cortado,
 * em silêncio — justamente o backup. Cada arquivo já está inteiro na memória, então
 * dá para calcular CRC e tamanho antes, e o Unzip lê exatamente N bytes.
 */
class StoredZipWriter {
  private offset = 0;
  private count = 0;
  private central: Uint8Array[] = [];
  private readonly write: (chunk: Uint8Array) => void;

  constructor(write: (chunk: Uint8Array) => void) {
    this.write = write;
  }

  add(name: string, data: Uint8Array): void {
    const fn = strToU8(name);
    const flag = fn.length !== name.length ? 0x0800 : 0; // nome com acento: UTF-8
    const crc = crc32(data);
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const local = new Uint8Array(30 + fn.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // versão necessária
    lv.setUint16(6, flag, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // comprimido
    lv.setUint32(22, data.length, true); // original
    lv.setUint16(26, fn.length, true);
    lv.setUint16(28, 0, true); // sem extra
    local.set(fn, 30);

    const cd = new Uint8Array(46 + fn.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // feito por
    cv.setUint16(6, 20, true); // versão necessária
    cv.setUint16(8, flag, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, fn.length, true);
    // 30 extra, 32 comentário, 34 disco, 36/38 atributos: zero
    cv.setUint32(42, this.offset, true); // onde está o cabeçalho local
    cd.set(fn, 46);

    this.write(local);
    this.write(data);
    this.central.push(cd);
    this.offset += local.length + data.length;
    this.count++;
  }

  /** Diretório central + fim de diretório. */
  end(): void {
    let size = 0;
    for (const c of this.central) {
      this.write(c);
      size += c.length;
    }
    const eocd = new Uint8Array(22);
    const v = new DataView(eocd.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.count, true);
    v.setUint16(10, this.count, true);
    v.setUint32(12, size, true);
    v.setUint32(16, this.offset, true);
    this.write(eocd);
  }
}

/**
 * Pasta (no cache) do arquivo entregue à folha de compartilhamento. shareAsync volta
 * quando o seletor fecha, não quando o destino terminou de ler (o Drive envia em
 * segundo plano; um rascunho de e-mail lê o anexo ao enviar): apagar logo depois
 * deixava o destino sem o arquivo. Ele fica até o PRÓXIMO compartilhamento do mesmo
 * tipo, que limpa a pasta antes.
 */
function freshShareDir(kind: 'baralho' | 'trecho'): Directory {
  const dir = new Directory(Paths.cache, 'compartilhar', kind);
  try {
    if (dir.exists) dir.delete();
  } catch {
    /* sobra do anterior: sem prejuízo */
  }
  dir.create({ intermediates: true, idempotent: true });
  return dir;
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
    const out = new File(freshShareDir('baralho'), `askesis-baralho-${safeName(deck.name)}_${stamp}.zip`);
    out.create({ overwrite: true });
    let handle: ReturnType<File['open']> | null = out.open();
    try {
      const h = handle;
      // Sem compressão (áudio já é comprimido; texto é pequeno) e com tamanho no
      // cabeçalho: ver StoredZipWriter. Falha de gravação lança e cai no catch.
      const zip = new StoredZipWriter((chunk) => h.writeBytes(chunk));
      const add = (name: string, data: Uint8Array) => zip.add(name, data);

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
      // seqEndOrd: o marcador de leitura (último trecho que tocou), na numeração do
      // zip — só os trechos com arquivo entram, então conta quantos vêm até ele.
      const seqEnd = await getAudioDeckSeqEnd(deckId).catch(() => -1);
      const seqEndOrd = clips.filter((c) => c.ord <= seqEnd).length - 1;
      add(
        'deck.json',
        strToU8(JSON.stringify({ name: deck.name, playMode: deck.playMode, seqEndOrd, exportedAt: new Date().toISOString() })),
      );
      for (let i = 0; i < clips.length; i++) {
        const bytes = await new File(Paths.document, 'audiodecks', String(deckId), clips[i].fileName).bytes();
        add(names[i], bytes);
        if (i % 10 === 9) await sleep(0);
      }
      zip.end();
      handle.close();
      handle = null;
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
    // Não apaga depois: ver freshShareDir (o próximo export limpa).
    await Sharing.shareAsync(out.uri, { mimeType: 'application/zip', dialogTitle: 'Exportar baralho de áudio' });
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
  // O último compartilhado (zip do baralho com deck.csv de notas e execuções,
  // trecho) fica no cache até o próximo (ver freshShareDir): o reset leva junto.
  try {
    const share = new Directory(Paths.cache, 'compartilhar');
    if (share.exists) share.delete();
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

/** Há um trecho tocando agora? (O lembrete falado não fala por cima nem abre o
 *  microfone com o alto-falante tocando um trecho.) */
export function isClipPlaying(): boolean {
  return playingId !== null;
}

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

/** Copia o texto do trecho para a área de transferência, com a assinatura da Noosfera. */
export async function copyClipText(c: AudioClip, deckName?: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(assinarTexto(clipShareText(c, deckName)));
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
    const out = new File(freshShareDir('trecho'), nomeAssinado(`${String(c.ord + 1).padStart(3, '0')}-${safeName(c.title)}`, ext));
    src.copy(out);
    const mime =
      ext === 'm4a' || ext === 'aac' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : ext === 'ogg' || ext === 'opus' ? 'audio/ogg' : ext === 'flac' ? 'audio/flac' : 'audio/mpeg';
    // Não apaga depois: ver freshShareDir (o próximo compartilhamento limpa).
    await compartilharAudio(out.uri, mime, 'Compartilhar trecho de áudio', assinarTexto(clipShareText(c)));
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
