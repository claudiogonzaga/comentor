// Transcrições feitas no Mac, recebidas pelo Google Drive.
//
// O Mac (mais memória, sempre ligado) transcreve os vídeos bem ranqueados e grava
// em Drive:/Askesis/aspis-transcricoes.json — a mesma pasta do askesis-sync.json.
// Com o escopo drive.file o celular só enxerga o que ele mesmo criou; por isso é
// o CELULAR que cria o arquivo (vazio) e o Mac só escreve dentro, pelo Google
// Drive para Desktop. Depois de criado, o celular nunca mais o regrava: só lê.
//
// Formato (fixo; o Mac segue o mesmo):
//   {"versao":1,"itens":{"<video_id>":{"texto":"…","fonte":"youtube"|"whisper",
//     "idioma":"pt"|null,"titulo":"…","em":<epoch ms>}}}
//
// A cada ~15 min com o app aberto (e na tarefa de segundo plano do YouTube):
// pergunta só o modifiedTime (barato) e baixa o conteúdo apenas quando mudou.
//  - vídeo já no banco e sem transcrição → salva, tira da fila do celular e
//    refaz a triagem provisória (retriage.ts);
//  - vídeo que ainda não chegou → espera na tabela desktop_transcripts e entra
//    quando o feed o trouxer (o refreshFeed já o analisa pela transcrição).
// Sem login ou sem rede: silencioso — tenta de novo no próximo tique.
import { useAppStore } from '../store/useAppStore';
import type { Transcript, TranscriptSource } from '../types';
import { getAccessToken, NotSignedInError } from './auth';
import * as db from './db';
import {
  createJsonFile,
  DriveError,
  ensureFolder,
  fileInfo,
  findFilesNewestFirst,
  readJsonFile,
  type DriveFileInfo,
} from './drive';
import { applyTranscript, retriagePending } from './retriage';

const FOLDER_NAME = 'Askesis';
const FILE_NAME = 'aspis-transcricoes.json';
const EMPTY_DOC = JSON.stringify({ versao: 1, itens: {} });

const CHECK_EVERY_MS = 10 * 60 * 1000; // o tique é de 15 min; a folga evita pular um
const KEEP_MS = 30 * 24 * 3600 * 1000; // à espera de um vídeo que nunca chega: some depois disso
const MAC_ALIVE_MS = 3 * 24 * 3600 * 1000; // o Mac gravou algo há menos disso → está trabalhando
const RETRIAGE_PER_PASS = 8; // chamadas de IA por passada (o resto fica para a próxima)

const K = {
  fileId: 'desktop_tx:file_id',
  modified: 'desktop_tx:modified', // modifiedTime do arquivo na última leitura
  checkedAt: 'desktop_tx:checked_at', // última tentativa de consultar o Drive (epoch ms)
  okAt: 'desktop_tx:ok_at', // última consulta que deu certo (epoch ms)
  newest: 'desktop_tx:newest_em', // o item mais novo que o Mac já gravou (epoch ms)
  received: 'desktop_tx:received', // quantas transcrições do Mac já entraram neste aparelho
  error: 'desktop_tx:error', // a última recusa do Drive (sem rede/sem login não contam)
};

interface DesktopItem {
  texto?: unknown;
  fonte?: unknown;
  idioma?: unknown;
  titulo?: unknown;
  em?: unknown;
}

interface DesktopDoc {
  versao?: unknown;
  itens?: Record<string, DesktopItem> | null;
}

const VIDEO_ID = /^[\w-]{6,20}$/;

/** A transcrição do Mac no formato do banco; a legenda que o Mac trouxe conta como 'youtube'. */
function transcriptOf(row: db.DesktopTranscriptRow): { transcript: Transcript; source: TranscriptSource } {
  return {
    transcript: { available: true, text: row.texto.trim(), segments: [] },
    source: row.fonte === 'youtube' ? 'youtube' : 'desktop',
  };
}

/** Para o refreshFeed: a transcrição do Mac que já espera por este vídeo, se houver. */
export function pendingDesktopTranscript(
  videoId: string,
): { transcript: Transcript; source: TranscriptSource } | null {
  const row = db.getDesktopTranscript(videoId);
  return row ? transcriptOf(row) : null;
}

/** O refreshFeed usou a transcrição que esperava: sai da tabela de espera. */
export function consumeDesktopTranscript(videoId: string): void {
  db.deleteDesktopTranscript(videoId);
  countReceived(1);
}

function countReceived(n: number): void {
  if (n > 0) db.setMeta(K.received, String(Number(db.getMeta(K.received) || 0) + n));
}

/** O Mac está transcrevendo (gravou algo nos últimos dias)? Se está, a fila do celular dá a vez a ele. */
export function macActive(now = Date.now()): boolean {
  const newest = Number(db.getMeta(K.newest) || 0);
  return newest > 0 && now - newest < MAC_ALIVE_MS;
}

export interface DesktopStatus {
  lastCheck: number; // última consulta ao Drive que deu certo (epoch ms); 0 = nunca
  newest: number; // epoch ms do item mais novo do Mac; 0 = nenhum
  received: number;
  waiting: number; // transcrições do Mac à espera do vídeo chegar ao feed
  error: string | null;
}

export function desktopStatus(): DesktopStatus {
  return {
    lastCheck: Number(db.getMeta(K.okAt) || 0),
    newest: Number(db.getMeta(K.newest) || 0),
    received: Number(db.getMeta(K.received) || 0),
    waiting: db.countDesktopTranscriptsWaiting(),
    error: db.getMeta(K.error) || null,
  };
}

type Listener = (appliedIds: string[]) => void;
const listeners = new Set<Listener>();

/** Avisa a cada passada (com os vídeos que ganharam transcrição, talvez nenhum). */
export function onDesktopSync(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Acha o arquivo (o id fica em cache) ou o cria vazio — a única escrita do celular nele.
async function locate(token: string): Promise<DriveFileInfo> {
  const cached = db.getMeta(K.fileId);
  if (cached) {
    const info = await fileInfo(token, cached);
    if (info) return info;
  }
  const folderId = await ensureFolder(token, FOLDER_NAME);
  let info: DriveFileInfo | undefined = (await findFilesNewestFirst(token, folderId, FILE_NAME))[0];
  if (!info) {
    const id = await createJsonFile(token, folderId, FILE_NAME, EMPTY_DOC);
    info = (await fileInfo(token, id)) ?? { id, modifiedTime: '' };
  }
  db.setMeta(K.fileId, info.id);
  return info;
}

// O conteúdo novo do arquivo → tabela de espera (o que ainda não tem transcrição aqui).
function ingest(doc: DesktopDoc): void {
  const itens = doc?.itens && typeof doc.itens === 'object' ? doc.itens : {};
  const cutoff = Date.now() - KEEP_MS;
  let newest = Number(db.getMeta(K.newest) || 0);
  for (const [videoId, it] of Object.entries(itens)) {
    if (!it || typeof it !== 'object' || !VIDEO_ID.test(videoId)) continue;
    const em = typeof it.em === 'number' && Number.isFinite(it.em) ? it.em : 0;
    if (em > newest) newest = em;
    const texto = typeof it.texto === 'string' ? it.texto.trim() : '';
    if (!texto) continue;
    const state = db.transcriptState(videoId);
    if (state === 'has') {
      db.deleteDesktopTranscript(videoId);
      continue;
    }
    if (state === 'missing' && em > 0 && em < cutoff) continue;
    const prev = db.getDesktopTranscript(videoId);
    if (prev && prev.em >= em) continue;
    db.putDesktopTranscript({
      video_id: videoId,
      texto,
      fonte: it.fonte === 'youtube' ? 'youtube' : 'whisper',
      idioma: typeof it.idioma === 'string' ? it.idioma : null,
      titulo: typeof it.titulo === 'string' ? it.titulo : null,
      em: em || Date.now(),
    });
  }
  if (newest > 0) db.setMeta(K.newest, String(newest));
  db.pruneDesktopTranscripts(cutoff);
}

// As que esperavam e cujo vídeo já está no banco: aplica (as que ainda servem) e tira da espera.
async function applyArrived(): Promise<string[]> {
  const applied: string[] = [];
  let analyses = 0;
  for (const row of db.desktopTranscriptsArrived()) {
    if (db.transcriptState(row.video_id) === 'empty') {
      const { transcript, source } = transcriptOf(row);
      await applyTranscript(row.video_id, transcript, source, {
        retriage: analyses < RETRIAGE_PER_PASS,
        onAnalyzing: () => {
          analyses++;
        },
      });
      applied.push(row.video_id);
    }
    db.deleteDesktopTranscript(row.video_id);
  }
  countReceived(applied.length);
  return applied;
}

async function runOnce(force: boolean): Promise<string[]> {
  // vídeos que chegaram ao banco desde a última passada (não precisa de rede)
  const applied = await applyArrived();

  const last = Number(db.getMeta(K.checkedAt) || 0);
  if (force || Date.now() - last >= CHECK_EVERY_MS) {
    db.setMeta(K.checkedAt, String(Date.now()));
    try {
      const token = await getAccessToken();
      const info = await locate(token);
      if (!info.modifiedTime || info.modifiedTime !== db.getMeta(K.modified)) {
        // JSON pela metade (o Mac gravando agora) lança aqui → lê de novo no próximo tique
        const doc = await readJsonFile<DesktopDoc>(token, info.id);
        if (doc) ingest(doc);
        if (info.modifiedTime) db.setMeta(K.modified, info.modifiedTime);
        applied.push(...(await applyArrived()));
      }
      db.setMeta(K.error, '');
      db.setMeta(K.okAt, String(Date.now()));
    } catch (e) {
      // sem login / sem rede: silencioso; recusa do Drive fica registrada para os Ajustes
      if (e instanceof DriveError) db.setMeta(K.error, e.message);
      if (!(e instanceof NotSignedInError)) console.warn('[aspis] transcrições do Mac:', e);
    }
  }

  // transcrições que ficaram com a nota provisória (a IA falhou antes): mais uma tentativa
  await retriagePending().catch(() => 0);
  return applied;
}

let running: Promise<number> | null = null;

/**
 * Uma passada: aplica o que o Mac transcreveu. Nunca lança. Devolve quantos vídeos
 * ganharam transcrição. `force` consulta o Drive mesmo antes dos ~15 min.
 */
export function syncDesktopTranscripts(force = false): Promise<number> {
  if (running) return running;
  running = (async () => {
    let ids: string[] = [];
    try {
      ids = await runOnce(force);
      if (ids.length) useAppStore.getState().bumpFeed();
    } catch (e) {
      console.warn('[aspis] transcrições do Mac:', e);
    } finally {
      running = null;
    }
    for (const cb of listeners) {
      try {
        cb(ids);
      } catch (e) {
        console.warn('[aspis] transcrições do Mac (aviso):', e);
      }
    }
    return ids.length;
  })();
  return running;
}
