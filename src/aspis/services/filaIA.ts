// Links compartilhados → fila da IA do Mac (Noosfera 1.8 do Mac).
//
// No Mac, uma IA agêntica (Claude, pelo MCP do app) escreve os cards do Escudo três
// vezes por dia (06h, 13h e 21h). Compartilhar um vídeo do YouTube com a Noosfera
// aqui no celular põe o link em Drive:/Askesis/aspis-fila.json — a mesma pasta do
// askesis-sync.json —, e a IA escreve o card na próxima execução, mesmo abaixo do
// limiar (foi você que mandou). O card daqui (a análise na hora) continua igual.
//
// Com o escopo drive.file o celular só enxerga o que ele mesmo criou; por isso é o
// CELULAR que cria e mantém o arquivo, e o Mac só lê (fila_celular.py).
//
// Formato (fixo; o Mac segue o mesmo):
//   {"versao":1,"atualizado":<ms>,"itens":[{"id":"<video_id>","source":"youtube",
//     "url":"…","titulo":"…","em":<ms do compartilhamento>}]}
//
// Sem rede ou sem login, o link espera aqui (app_meta) e vai na próxima vez.
import { getAccessToken } from './auth';
import * as db from './db';
import { createJsonFile, ensureFolder, findFilesNewestFirst, readJsonFile, updateJsonFile } from './drive';

const FOLDER_NAME = 'Askesis';
const FILE_NAME = 'aspis-fila.json';
const KEEP_MS = 30 * 24 * 3600 * 1000; // o Mac importa em minutos; depois disso o item sai do arquivo
const MAX_ITENS = 200;

const K = {
  fileId: 'fila_ia:file_id',
  pendentes: 'fila_ia:pendentes', // JSON: itens que ainda não chegaram ao arquivo
};

export interface FilaItem {
  id: string;
  source: 'youtube' | 'x';
  url: string;
  titulo?: string;
  em: number;
}

interface FilaDoc {
  versao?: number;
  atualizado?: number;
  itens?: FilaItem[];
}

function lerPendentes(): FilaItem[] {
  try {
    const v = JSON.parse(db.getMeta(K.pendentes) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function gravarPendentes(itens: FilaItem[]): void {
  db.setMeta(K.pendentes, JSON.stringify(itens.slice(-50)));
}

/** O id do arquivo da fila (cria vazio na primeira vez). */
async function arquivo(token: string): Promise<string> {
  const cached = db.getMeta(K.fileId);
  if (cached) return cached;
  const folderId = await ensureFolder(token, FOLDER_NAME);
  const found = (await findFilesNewestFirst(token, folderId, FILE_NAME))[0];
  const id = found?.id ?? (await createJsonFile(token, folderId, FILE_NAME, JSON.stringify({ versao: 1, itens: [] })));
  db.setMeta(K.fileId, id);
  return id;
}

/** Leva ao Drive o que estiver esperando. Silencioso: sem login/rede, tenta depois. */
export async function enviarFilaIA(): Promise<number> {
  const pendentes = lerPendentes();
  if (!pendentes.length) return 0;
  try {
    const token = await getAccessToken();
    let id = await arquivo(token);
    let doc = await readJsonFile<FilaDoc>(token, id);
    if (!doc) {
      // apagado no Drive: cria de novo
      db.setMeta(K.fileId, '');
      id = await arquivo(token);
      doc = { versao: 1, itens: [] };
    }
    const agora = Date.now();
    const vistos = new Set<string>();
    const itens = [...(Array.isArray(doc.itens) ? doc.itens : []), ...pendentes]
      .filter((it) => it && typeof it.id === 'string' && agora - (Number(it.em) || 0) < KEEP_MS)
      .filter((it) => {
        const k = `${it.id}|${it.em}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .slice(-MAX_ITENS);
    await updateJsonFile(token, id, JSON.stringify({ versao: 1, atualizado: agora, itens }));
    gravarPendentes([]);
    return pendentes.length;
  } catch (err) {
    console.warn('[filaIA] fica para depois:', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Compartilhou com a Noosfera: o link entra na fila da IA do Mac. */
export function compartilharComIA(item: Omit<FilaItem, 'em'>): void {
  const pendentes = lerPendentes().filter((it) => it.id !== item.id);
  pendentes.push({ ...item, titulo: item.titulo?.slice(0, 300), em: Date.now() });
  gravarPendentes(pendentes);
  void enviarFilaIA();
}
