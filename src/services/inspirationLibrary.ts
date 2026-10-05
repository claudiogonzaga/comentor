import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
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

/** A 1ª linha é o cabeçalho (e não uma frase)? Compara o início da célula, sem acento. */
const HEADER_RE = /^\s*"?\s*(texto( do card)?|frase|cita[cç][aã]o|card)\s*"?\s*([;,\t]|$)/i;

const HEADER = ['Texto do Card', 'Autor / Personalidade', 'Data de Referência', 'Tipo de Card'];

/** Escapa um campo CSV (aspas duplas, vírgula, quebra de linha). */
function csvField(v: string | null): string {
  const s = (v ?? '').toString();
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Detecta o separador. O Excel/Sheets em português salva CSV com PONTO E VÍRGULA
 * (a vírgula é o separador decimal); outros salvam com vírgula ou tabulação. Vale o
 * primeiro que aparece o MESMO número de vezes (fora de aspas) nas primeiras
 * linhas. Sem separador consistente (arquivo de texto, uma frase por linha),
 * devolve null — a linha inteira é o texto, vírgulas e tudo.
 */
function detectDelimiter(text: string): string | null {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 6);
  if (lines.length === 0) return null;
  const count = (l: string, d: string) => {
    let q = false;
    let n = 0;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return n;
  };
  // Com cabeçalho conhecido, o separador dele manda (linhas só com texto, ou com
  // menos colunas, continuam valendo — "só o texto é obrigatório").
  if (HEADER_RE.test(lines[0])) {
    for (const d of [';', '\t', ',']) {
      const n = count(lines[0], d);
      if (n > 0 && lines.slice(1).every((l) => count(l, d) <= n)) return d;
    }
    return null;
  }
  // Sem cabeçalho: só vale se TODAS as linhas tiverem o mesmo nº de separadores
  // (planilha de verdade); um TXT com uma vírgula em cada frase não passa.
  for (const d of [';', '\t', ',']) {
    const counts = lines.map((l) => count(l, d));
    if (counts[0] >= 2 && counts.every((n) => n === counts[0])) return d;
  }
  return null;
}

/** Parser de CSV tolerante a campos com aspas e quebras de linha internas. */
function parseCsv(text: string, delimiter: string | null = ','): string[][] {
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
    } else if (delimiter !== null && c === delimiter) {
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

  const rows = parseCsv(content, detectDelimiter(content));
  if (!rows.length) {
    return { pack: null, imported: 0, error: 'A planilha está vazia.' };
  }
  // pula cabeçalho se a 1ª linha parecer cabeçalho
  let start = 0;
  if (/^\s*(texto( do card)?|frase|cita[cç][aã]o|card)\s*$/i.test(rows[0][0] ?? '')) start = 1;

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
        'Nenhuma linha válida. Veja o formato no cartão "Importar baralho": o TEXTO vai na 1ª coluna e o arquivo é CSV em UTF-8.',
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

// ——— Ajuda para quem vai montar um baralho ———

/** Linhas de exemplo: servem de modelo (arquivo) e de amostra no prompt para a IA. */
const SAMPLE_ROWS: { text: string; author: string; date: string; type: 'quote' | 'fact' }[] = [
  { text: 'O que importa não é a velocidade, mas não parar.', author: 'Confúcio', date: '', type: 'quote' },
  { text: 'Neil Armstrong pisou na Lua e disse: "Um pequeno passo para o homem, um salto gigante para a humanidade."', author: 'Neil Armstrong', date: '20/07/1969', type: 'fact' },
];

/** Compartilha um CSV-modelo (cabeçalho + 2 linhas) para a pessoa preencher. */
export async function shareDeckTemplate(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'Compartilhamento não disponível neste aparelho.' };
    }
    const lines = [HEADER.map(csvField).join(',')];
    for (const r of SAMPLE_ROWS) {
      lines.push(
        [csvField(r.text), csvField(r.author), csvField(r.date), csvField(r.type === 'fact' ? 'Fato Histórico' : 'Citação')].join(','),
      );
    }
    const dest = `${FileSystem.cacheDirectory}modelo_baralho_inspiracao.csv`;
    await FileSystem.writeAsStringAsync(dest, '\ufeff' + lines.join('\r\n'), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    await Sharing.shareAsync(dest, {
      mimeType: 'text/csv',
      dialogTitle: 'Modelo de baralho',
      UTI: 'public.comma-separated-values-text',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}

/** Texto pronto para colar numa IA (ChatGPT, Claude, Gemini…) e receber o CSV do baralho. */
export const DECK_PROMPT = `Crie um baralho de frases de inspiração como arquivo CSV (UTF-8), pronto para importar no app Askeo.

Tema do baralho: [DESCREVA AQUI — ex.: estoicismo, perseverança, ciência, humor leve]
Quantidade: [ex.: 100] frases, em português.

Formato — a PRIMEIRA linha é o cabeçalho, exatamente assim:
Texto do Card,Autor / Personalidade,Data de Referência,Tipo de Card

Regras de cada linha:
- Texto do Card: a frase (até ~250 caracteres, para caber bem quando for lida em voz alta). Sem aspas decorativas no começo e no fim.
- Autor / Personalidade: quem disse ou protagonizou; vazio se não houver.
- Data de Referência: opcional (ex.: 20/07/1969); pode ficar vazia.
- Tipo de Card: "Citação" ou "Fato Histórico".
- Se o texto tiver vírgula ou aspas, coloque o campo entre aspas duplas e duplique as aspas internas.
- Só frases reais e atribuídas ao autor certo; na dúvida, deixe o autor vazio. Nada de texto fora do CSV.

Exemplo:
${HEADER.join(',')}
"${SAMPLE_ROWS[0].text}",${SAMPLE_ROWS[0].author},,Citação`;

/** Copia o prompt para a área de transferência. */
export async function copyDeckPrompt(): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(DECK_PROMPT);
    return true;
  } catch {
    return false;
  }
}
