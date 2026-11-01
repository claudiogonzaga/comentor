// Renderização da nota Markdown — baseada no obsidian.py:_render_note do
// desktop. O cabeçalho/frontmatter e as seções Resumo/Pontos-chave/Citações
// permanecem fiéis (mesma pasta Drive:/Aspis). O Android ACRESCENTA seções —
// Evidências, Flashcards e Perguntas & Checagens — pedidas pelo usuário; o
// desktop simplesmente não as escreve.

import { MOC_NAME_NENHUM } from '../constants/defaults';
import type {
  ClipBlock,
  Evidencia,
  Fato,
  Pillar,
  Veredito,
  VideoRecord,
  QAItem,
} from '../types';
import { noteBasename, sanitizeFilename } from '../utils/sanitize';

const VEREDITO_LABEL: Record<Veredito, string> = {
  apoiada: 'apoiada por evidência',
  mista: 'evidência mista',
  contestada: 'contestada pela evidência',
  sem_evidencia: 'sem evidência',
};

function evidenciaMd(e: Evidencia): string {
  const lines = [`**${e.afirmacao}** — _${VEREDITO_LABEL[e.veredito]}_`];
  if (e.evidencia) lines.push('', e.evidencia);
  if (e.fontes?.length) lines.push('', `Fontes: ${e.fontes.join('; ')}`);
  return lines.join('\n');
}

function fatoLine(f: Fato): string {
  return f.tipo === 'cloze' ? `- ${f.texto}` : `- ${f.frente} :: ${f.verso}`;
}

export function mocNameFor(pillarId: string, pillars: Pillar[]): string {
  if (pillarId === 'nenhum') return MOC_NAME_NENHUM;
  const p = pillars.find((x) => x.id === pillarId);
  return p?.mocName || p?.nome || MOC_NAME_NENHUM;
}

export function noteFilename(v: VideoRecord): string {
  return `${noteBasename(v.neutral_title, v.video_id)}.md`;
}

// Nome do arquivo de áudio (nota de áudio) — mesmo "basename" da nota do vídeo.
export function audioFilename(v: VideoRecord): string {
  return `${noteBasename(v.neutral_title, v.video_id)}.wav`;
}

// Texto falado da ANÁLISE (para o TTS ler e para a nota de áudio): o veredito,
// o resumo e os pontos-chave, numa narração natural.
export function analysisNarration(v: VideoRecord): string {
  const parts: string[] = [];
  if (v.a_real) parts.push(`A real: ${v.a_real}`);
  if (v.resumo) parts.push(`Resumo: ${v.resumo}`);
  if (v.pontos_chave?.length) {
    parts.push('Pontos-chave: ' + v.pontos_chave.map((p) => p.replace(/\.*$/, '')).join('. '));
  }
  return parts.join('. ').trim() || v.resumo || v.neutral_title;
}

export function renderNote(
  v: VideoRecord,
  pillars: Pillar[],
  savedQa: QAItem[] = [],
): string {
  const pillarName = mocNameFor(v.pillar, pillars);
  const data =
    (v.published_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const autor = (v.channel || '').replace(/"/g, "'");

  const lines: string[] = [
    '---',
    'fonte: youtube',
    `autor: "${autor}"`,
    `pilar: ${v.pillar}`,
    `data: ${data}`,
    `url: ${v.url || ''}`,
    `score: ${v.score ?? 0}`,
    `tags: [${v.pillar}, aspis]`,
    '---',
    '',
    `# ${v.neutral_title}`,
    '',
  ];
  if (v.a_real) {
    lines.push(`> [!tip] A real`, `> ${v.a_real}`, '');
  }
  // nota de áudio: embed do .wav (o Obsidian toca inline)
  if (v.audio_file) {
    lines.push('## Áudio', `![[${v.audio_file}]]`, '');
  }
  lines.push('## Resumo', v.resumo || '_(sem resumo)_', '');
  const pontos = v.pontos_chave || [];
  if (pontos.length) {
    lines.push('## Pontos-chave');
    for (const p of pontos) lines.push(`- ${p}`);
    lines.push('');
  }
  const evidencias = v.evidencias || [];
  if (evidencias.length) {
    lines.push('## Evidências');
    for (const e of evidencias) {
      lines.push(`- **${e.afirmacao}** — _${VEREDITO_LABEL[e.veredito]}_`);
      if (e.evidencia) lines.push(`    ${e.evidencia}`);
      if (e.fontes?.length) lines.push(`    Fontes: ${e.fontes.join('; ')}`);
    }
    lines.push('');
  }
  const citacoes = v.citacoes || [];
  if (citacoes.length) {
    lines.push('## Citações');
    for (const c of citacoes) {
      const ts = c.timestamp || '';
      lines.push(`> ${c.texto || ''}` + (ts ? ` — ${ts}` : ''));
    }
    lines.push('');
  }
  const fatos = v.fatos || [];
  if (fatos.length) {
    lines.push('## Flashcards');
    for (const f of fatos) lines.push(fatoLine(f));
    lines.push('');
  }
  const saved = savedQa.filter((q) => q.saved_note === 1);
  if (saved.length) {
    lines.push('## Perguntas & Checagens');
    for (const q of saved) {
      const head = q.kind === 'factcheck' ? `Checagem externa — ${q.question}` : q.question;
      lines.push(`### ${head}`);
      lines.push(q.answer);
      if (q.sources?.length) {
        lines.push('');
        lines.push('Fontes:');
        for (const s of q.sources) lines.push(`- [${s.title}](${s.uri})`);
      }
      lines.push('');
    }
  }
  lines.push(`[[${pillarName} - MOC]]`);
  lines.push('');
  return lines.join('\n');
}

// Texto completo da síntese para a ação "Copiar" da tela de análise.
export function synthesisAsText(v: VideoRecord): string {
  const parts: string[] = [v.neutral_title, ''];
  parts.push(`${v.channel} · ${v.duration} · score ${v.score}`);
  parts.push('');
  if (v.a_real) {
    parts.push(`A real: ${v.a_real}`);
    parts.push('');
  }
  if (v.resumo) {
    parts.push(v.resumo);
    parts.push('');
  }
  if (v.pontos_chave?.length) {
    parts.push('Pontos-chave:');
    for (const p of v.pontos_chave) parts.push(`- ${p}`);
    parts.push('');
  }
  if (v.evidencias?.length) {
    parts.push('Evidências:');
    for (const e of v.evidencias) {
      parts.push(`- ${e.afirmacao} [${VEREDITO_LABEL[e.veredito]}]`);
      if (e.evidencia) parts.push(`  ${e.evidencia}`);
      if (e.fontes?.length) parts.push(`  Fontes: ${e.fontes.join('; ')}`);
    }
    parts.push('');
  }
  if (v.fatos?.length) {
    parts.push('Fatos para memorizar:');
    for (const f of v.fatos) {
      if (f.tipo === 'basic') parts.push(`- ${f.frente} → ${f.verso}`);
      else parts.push(`- ${f.texto}`);
    }
    parts.push('');
  }
  if (v.citacoes?.length) {
    parts.push('Citações:');
    for (const c of v.citacoes)
      parts.push(`> ${c.texto}${c.timestamp ? ` — ${c.timestamp}` : ''}`);
    parts.push('');
  }
  parts.push(v.url);
  return parts.join('\n');
}

// --- Destaques: blocos clipáveis → notas atômicas ----------------------------

// Quebra a análise nos blocos que o usuário pode salvar individualmente.
export function analysisBlocks(v: VideoRecord): ClipBlock[] {
  const blocks: ClipBlock[] = [];
  if (v.a_real) blocks.push({ key: 'areal', label: 'A real', titleHint: v.a_real, bodyMd: v.a_real });
  if (v.resumo) blocks.push({ key: 'resumo', label: 'Resumo', titleHint: v.neutral_title, bodyMd: v.resumo });
  (v.pontos_chave || []).forEach((p, i) => {
    if (p?.trim()) blocks.push({ key: `ponto:${i}`, label: 'Ponto-chave', titleHint: p, bodyMd: `- ${p}` });
  });
  (v.evidencias || []).forEach((e, i) => {
    if (e?.afirmacao?.trim() || e?.evidencia?.trim())
      blocks.push({ key: `evid:${i}`, label: 'Evidência', titleHint: e.afirmacao || e.evidencia, bodyMd: evidenciaMd(e) });
  });
  (v.citacoes || []).forEach((c, i) => {
    if (c?.texto?.trim())
      blocks.push({
        key: `cit:${i}`,
        label: 'Citação',
        titleHint: c.texto,
        bodyMd: `> ${c.texto}${c.timestamp ? ` — ${c.timestamp}` : ''}`,
      });
  });
  return blocks;
}

// UMA nota de Destaques por vídeo — reúne os trechos que o usuário marcou.
export function clipsFilename(v: VideoRecord): string {
  const stem = sanitizeFilename(v.neutral_title, 60);
  return `Destaques — ${stem} (${v.video_id}).md`;
}

// Renderiza a nota de Destaques com TODOS os trechos selecionados (na ordem da
// análise), com link de volta para a nota do vídeo.
export function renderClipsNote(v: VideoRecord, blocks: ClipBlock[], pillars: Pillar[]): string {
  const pillarName = mocNameFor(v.pillar, pillars);
  const data =
    (v.published_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const autor = (v.channel || '').replace(/"/g, "'");
  const back = noteBasename(v.neutral_title, v.video_id);
  const lines: string[] = [
    '---',
    'fonte: youtube',
    'tipo: destaques',
    `autor: "${autor}"`,
    `pilar: ${v.pillar}`,
    `data: ${data}`,
    `url: ${v.url || ''}`,
    `tags: [destaque, ${v.pillar}, aspis]`,
    '---',
    '',
    `# Destaques — ${v.neutral_title}`,
    '',
  ];
  for (const b of blocks) {
    lines.push(`**${b.label}**`, '', b.bodyMd, '');
  }
  lines.push(`— de [[${back}]] · [▶ assistir](${v.url || ''}) · [[${pillarName} - MOC]]`, '');
  return lines.join('\n');
}
