// Notas no Google Drive (escopo mínimo drive.file): grava o .md na pasta
// Aspis do My Drive — mesma pasta que o desktop espelha via Google Drive for
// Desktop. Salvar é idempotente: arquivo com o mesmo nome é ATUALIZADO.

import * as db from './db';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_NAME = 'Aspis';
const META_KEY = 'drive_folder_id';

export class DriveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

async function driveFetch(url: string, token: string, init: RequestInit = {}): Promise<any> {
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!resp.ok) {
    let message = `Google Drive HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      if (err?.error?.message) message = err.error.message;
    } catch {
      // mantém genérica
    }
    throw new DriveError(message, resp.status);
  }
  return resp.json();
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Garante a pasta Aspis (cria se não existir) e devolve o id. O id fica em
// cache no meta do SQLite; se a pasta for apagada no Drive, recriamos.
export async function ensureAspisFolder(token: string): Promise<string> {
  const cached = db.getMeta(META_KEY);
  if (cached) {
    try {
      const f = await driveFetch(`${FILES}/${cached}?fields=id,trashed`, token);
      if (f?.id && !f.trashed) return cached;
    } catch {
      // caiu no lixo / sumiu → procura ou recria
    }
  }
  const q = `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`;
  const found = await driveFetch(
    `${FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    token,
  );
  let id: string | undefined = found?.files?.[0]?.id;
  if (!id) {
    const created = await driveFetch(`${FILES}?fields=id`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] }),
    });
    id = created.id as string;
  }
  db.setMeta(META_KEY, id!);
  return id!;
}

async function findFileByName(token: string, folderId: string, name: string): Promise<string | null> {
  const q = `name = '${escapeQuery(name)}' and '${folderId}' in parents and trashed = false`;
  const found = await driveFetch(
    `${FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    token,
  );
  return found?.files?.[0]?.id ?? null;
}

// ---- Sincronização de configurações (ver services/configSync.ts) ----

/** Acha ou cria uma pasta na raiz do Drive. */
export async function ensureFolder(token: string, name: string): Promise<string> {
  const q = `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`;
  const found = await driveFetch(
    `${FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    token,
  );
  const id: string | undefined = found?.files?.[0]?.id;
  if (id) return id;
  const created = await driveFetch(`${FILES}?fields=id`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: ['root'] }),
  });
  return created.id as string;
}

export function findFile(token: string, folderId: string, name: string): Promise<string | null> {
  return findFileByName(token, folderId, name);
}

/** O conteúdo JSON de um arquivo; null se ele sumiu (apagado, na lixeira). */
export async function readJsonFile<T>(token: string, id: string): Promise<T | null> {
  try {
    const meta = await driveFetch(`${FILES}/${id}?fields=id,trashed`, token);
    if (meta?.trashed) return null;
    return (await driveFetch(`${FILES}/${id}?alt=media`, token)) as T;
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return null;
    throw err;
  }
}

export async function createJsonFile(
  token: string,
  folderId: string,
  name: string,
  content: string,
): Promise<string> {
  const created = await driveFetch(`${FILES}?fields=id`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [folderId], mimeType: 'application/json' }),
  });
  await updateJsonFile(token, created.id as string, content);
  return created.id as string;
}

export async function updateJsonFile(token: string, id: string, content: string): Promise<void> {
  await driveFetch(`${UPLOAD}/${id}?uploadType=media`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  });
}

// Cria ou ATUALIZA (idempotente) um arquivo Markdown na pasta Aspis.
export async function saveMarkdown(
  token: string,
  filename: string,
  content: string,
): Promise<{ id: string; updated: boolean }> {
  const folderId = await ensureAspisFolder(token);
  const existing = await findFileByName(token, folderId, filename);

  if (existing) {
    await driveFetch(`${UPLOAD}/${existing}?uploadType=media`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
      body: content,
    });
    return { id: existing, updated: true };
  }

  const boundary = `aspis_${Date.now().toString(36)}`;
  const metadata = { name: filename, parents: [folderId], mimeType: 'text/markdown' };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/markdown; charset=UTF-8\r\n\r\n' +
    `${content}\r\n` +
    `--${boundary}--`;
  const created = await driveFetch(`${UPLOAD}?uploadType=multipart&fields=id`, token, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return { id: created.id, updated: false };
}

// Cria ou ATUALIZA um arquivo BINÁRIO (ex.: áudio .wav) na pasta Aspis. Duas
// etapas: metadados (JSON) + mídia (bytes crus), evitando montar multipart
// binário à mão.
export async function uploadBinary(
  token: string,
  filename: string,
  mimeType: string,
  data: Uint8Array,
): Promise<{ id: string; updated: boolean }> {
  const folderId = await ensureAspisFolder(token);
  const existing = await findFileByName(token, folderId, filename);
  const updated = !!existing;
  let id = existing;
  if (!id) {
    const created = await driveFetch(`${FILES}?fields=id`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filename, parents: [folderId], mimeType }),
    });
    id = created.id as string;
  }
  const resp = await fetch(`${UPLOAD}/${id}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
    body: data as unknown as BodyInit,
  });
  if (!resp.ok) throw new DriveError(`Google Drive HTTP ${resp.status}`, resp.status);
  return { id: id!, updated };
}

// --- Leitor de notas (vault inteiro) — precisa do escopo drive.readonly -------

export interface VaultNote {
  id: string;
  name: string; // nome do arquivo, ex.: "Título (videoId).md"
  modifiedTime: string;
  webViewLink: string; // abrir no Drive (navegador)
}

// Lista TODOS os .md da pasta Aspis (inclui os criados no desktop). Requer
// drive.readonly — com drive.file só apareceriam os que o app criou.
export async function listVaultNotes(token: string): Promise<VaultNote[]> {
  const folderId = await ensureAspisFolder(token);
  const q =
    `'${folderId}' in parents and trashed = false and ` +
    `(mimeType = 'text/markdown' or name contains '.md')`;
  const out: VaultNote[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken, files(id,name,modifiedTime,webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await driveFetch(`${FILES}?${params.toString()}`, token);
    for (const f of page?.files ?? []) {
      if (typeof f.name === 'string' && f.name.toLowerCase().endsWith('.md')) {
        out.push({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime ?? '',
          webViewLink: f.webViewLink ?? '',
        });
      }
    }
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return out;
}

// Baixa o conteúdo Markdown de uma nota (alt=media devolve o texto cru).
export async function readNoteText(token: string, fileId: string): Promise<string> {
  const resp = await fetch(`${FILES}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new DriveError(`Google Drive HTTP ${resp.status}`, resp.status);
  }
  return resp.text();
}

// Exclui um arquivo criado pelo app (escopo drive.file). Usado ao desfazer um
// Destaque. 404 = já sumiu → trata como sucesso.
export async function deleteFile(token: string, fileId: string): Promise<void> {
  const resp = await fetch(`${FILES}/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) {
    throw new DriveError(`Google Drive HTTP ${resp.status}`, resp.status);
  }
}

// --- Leitura barata de arquivos que outro aparelho atualiza (desktopTranscripts.ts) ---

export interface DriveFileInfo {
  id: string;
  modifiedTime: string; // RFC 3339
}

/** Só os metadados (sem baixar o conteúdo); null se o arquivo sumiu ou foi para a lixeira. */
export async function fileInfo(token: string, id: string): Promise<DriveFileInfo | null> {
  try {
    const f = await driveFetch(`${FILES}/${id}?fields=id,modifiedTime,trashed`, token);
    if (!f?.id || f.trashed) return null;
    return { id: f.id as string, modifiedTime: (f.modifiedTime as string) ?? '' };
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return null;
    throw err;
  }
}

/** Os arquivos com esse nome na pasta, o modificado por último primeiro. */
export async function findFilesNewestFirst(
  token: string,
  folderId: string,
  name: string,
): Promise<DriveFileInfo[]> {
  const q = `name = '${escapeQuery(name)}' and '${folderId}' in parents and trashed = false`;
  const found = await driveFetch(
    `${FILES}?q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)` +
      `&orderBy=${encodeURIComponent('modifiedTime desc')}&pageSize=10`,
    token,
  );
  return ((found?.files ?? []) as { id: string; modifiedTime?: string }[]).map((f) => ({
    id: f.id,
    modifiedTime: f.modifiedTime ?? '',
  }));
}
