// Utilitários do leitor de notas ("mini-Obsidian"): frontmatter, título e
// pré-processamento do Markdown para o react-native-markdown-display —
// transforma [[wikilinks]] em links navegáveis e simplifica callouts.

export interface ParsedNote {
  meta: Record<string, string>;
  body: string;
}

// Esquema interno para os [[wikilinks]]: o renderizador trata como link normal
// e o onLinkPress intercepta este prefixo para navegar entre notas.
export const NOTE_LINK_SCHEME = 'aspisnote:';

export function parseFrontmatter(text: string): ParsedNote {
  const t = (text || '').replace(/\r\n/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: t };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) meta[key] = val;
  }
  return { meta, body: t.slice(m[0].length) };
}

// Tira o ".md" e o sufixo " (videoId)" para um nome amigável de fallback.
function cleanName(filename: string): string {
  return filename
    .replace(/\.md$/i, '')
    .replace(/\s*\([A-Za-z0-9_-]{6,}\)\s*$/, '')
    .trim();
}

// Título de exibição: o primeiro "# heading" do corpo, senão o nome do arquivo.
export function noteTitle(filename: string, body: string): string {
  const h = body.match(/^#\s+(.+)$/m);
  return (h ? h[1].trim() : '') || cleanName(filename) || filename;
}

// Pré-processa o Markdown para o renderizador:
//  - [[Alvo|Apelido]] / [[Alvo]] → link com esquema aspisnote: (navegável);
//  - callouts "> [!tipo] Título" → "> **Título**" (o renderizador não conhece
//    a sintaxe de callout do Obsidian).
export function preprocessMarkdown(body: string): string {
  let out = body;
  // callouts do Obsidian
  out = out.replace(/^>\s*\[!\w+\]\s*(.*)$/gm, (_m, title) =>
    title ? `> **${title}**` : '> ');
  // wikilinks com apelido
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target, alias) => {
    return `[${alias.trim()}](${NOTE_LINK_SCHEME}${encodeURIComponent(target.trim())})`;
  });
  // wikilinks simples
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => {
    const t = String(target).trim();
    return `[${t}](${NOTE_LINK_SCHEME}${encodeURIComponent(t)})`;
  });
  return out;
}

// Resolve o alvo de um wikilink (nome sem extensão) para um nome de arquivo do
// vault. Aceita correspondência exata do "stem" e ignora o sufixo (videoId).
export function resolveNoteLink(target: string, fileNames: string[]): string | null {
  const want = decodeURIComponent(target).trim().toLowerCase();
  // 1) stem exato (nome sem .md)
  let hit = fileNames.find((n) => n.replace(/\.md$/i, '').trim().toLowerCase() === want);
  if (hit) return hit;
  // 2) nome "limpo" (sem o sufixo (videoId))
  hit = fileNames.find((n) => cleanName(n).toLowerCase() === want);
  return hit ?? null;
}
