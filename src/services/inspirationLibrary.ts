import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  createImportedInspirationPack,
  listActiveInspirationCards,
} from './database';
import type { InspirationCard, InspirationPack } from '../types';

/**
 * Importação/exportação da biblioteca de inspiração em PLANILHA (CSV — formato
 * universal que Excel e Google Sheets abrem e salvam nativamente). Colunas, na
 * mesma ordem do anexo original:
 *   Texto do Card | Autor / Personalidade | Data de Referência | Tipo de Card
 * "Tipo": contém "fato" → fato histórico; senão → citação.
 */

const HEADER = ['Texto do Card', 'Autor / Personalidade', 'Data de Referência', 'Tipo de Card'];

/** Escapa um campo CSV (aspas duplas, vírgula, quebra de linha). */
function csvField(v: string | null): string {
  const s = (v ?? '').toString();
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Parser de CSV tolerante a campos com aspas e quebras de linha internas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // remove BOM
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

export interface ImportResult {
  pack: InspirationPack | null;
  imported: number;
  error?: string;
}

/**
 * Abre o seletor de arquivos, lê um CSV e cria um novo pack com as linhas. O
 * nome do pack vem do nome do arquivo. Pula o cabeçalho se reconhecer "Texto".
 */
export async function importInspirationPackFromFile(): Promise<ImportResult> {
  let res;
  try {
    res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    return { pack: null, imported: 0, error: 'Não consegui abrir o seletor de arquivos.' };
  }
  if (res.canceled || !res.assets?.[0]) return { pack: null, imported: 0 };

  const asset = res.assets[0];
  let content: string;
  try {
    content = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    return { pack: null, imported: 0, error: 'Não consegui ler o arquivo.' };
  }

  const rows = parseCsv(content);
  if (!rows.length) {
    return { pack: null, imported: 0, error: 'A planilha está vazia.' };
  }
  // pula cabeçalho se a 1ª linha parecer cabeçalho
  let start = 0;
  if (/texto|card|cita/i.test(rows[0][0] ?? '')) start = 1;

  const cards = rows
    .slice(start)
    .map((r) => {
      const text = (r[0] ?? '').trim();
      const author = (r[1] ?? '').trim() || null;
      const refDate = (r[2] ?? '').trim() || null;
      const typeRaw = (r[3] ?? '').trim();
      const type: 'quote' | 'fact' = /fato|fact|hist/i.test(typeRaw) ? 'fact' : 'quote';
      return { type, text, author, refDate };
    })
    .filter((c) => c.text.length > 0);

  if (!cards.length) {
    return {
      pack: null,
      imported: 0,
      error:
        'Nenhuma linha válida. Use uma planilha com a coluna de TEXTO na 1ª coluna (salve como CSV).',
    };
  }

  const baseName =
    (asset.name ?? 'Meu pacote').replace(/\.(csv|txt|xlsx|xls)$/i, '').trim() || 'Meu pacote';
  try {
    const pack = await createImportedInspirationPack(baseName, cards);
    return { pack, imported: cards.length };
  } catch {
    return { pack: null, imported: 0, error: 'Não consegui salvar o pacote.' };
  }
}

function cardsToCsv(cards: InspirationCard[]): string {
  const lines = [HEADER.map(csvField).join(',')];
  for (const c of cards) {
    lines.push(
      [
        csvField(c.text),
        csvField(c.author),
        csvField(c.refDate),
        csvField(c.type === 'fact' ? 'Fato Histórico' : 'Citação'),
      ].join(','),
    );
  }
  // BOM para o Excel abrir acentos corretamente
  return '﻿' + lines.join('\r\n');
}

/**
 * Exporta o BARALHO atual (todos os cards ativos dos packs habilitados) como
 * planilha CSV e abre o share sheet para salvar/enviar.
 */
export async function exportInspirationDeck(): Promise<{ ok: boolean; error?: string }> {
  try {
    const cards = await listActiveInspirationCards();
    if (!cards.length) return { ok: false, error: 'Não há cards para exportar.' };
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'Compartilhamento não disponível neste aparelho.' };
    }
    const csv = cardsToCsv(cards);
    const dest = `${FileSystem.cacheDirectory}baralho_inspiracao.csv`;
    await FileSystem.writeAsStringAsync(dest, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(dest, {
      mimeType: 'text/csv',
      dialogTitle: 'Exportar baralho de inspiração',
      UTI: 'public.comma-separated-values-text',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}
