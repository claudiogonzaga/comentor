// As regras do Kairós: a lista de tarefas por área da vida que nasceu como planilha
// + Apps Script (projeto kairos-todo) e agora mora no Áskesis. As mesmas regras estão
// em kairos_store.py, no Áskesis do Mac: urgentes, ordem, teto e piso da nota.

export type Status = 'A fazer' | 'Feito';
export type Prioridade = 'Alta' | 'Média' | 'Baixa';

export interface Tarefa {
  id: string;
  area: string;
  titulo: string;
  notas: string;
  prioridade: Prioridade;
  status: Status;
  /** 'AAAA-MM-DD' ou ''. */
  prazo: string;
  /** 'HH:MM' quando o prazo tem hora marcada, ou ''. */
  hora: string;
  tipo: string;
  urgente: boolean;
  estrelas: number;
  badges: string[];
  comentario: string;
  criadoEm: string;
  concluidoEm: string;
  atualizadoEm: string;
}

export interface Badge {
  e: string;
  nome: string;
  tipo: 'pos' | 'neg';
  /** Teto de estrelas que a badge impõe. */
  cap: number;
  /** Nota mínima que ela trava. */
  piso?: number;
  /** Nota sugerida ao marcar. */
  auto?: number;
  txt: string;
  coach: string;
}

export const AREAS = ['Acadêmico', 'Trabalho', 'Institucional', 'Saúde', 'Pessoal'];
export const PRIORIDADES: Prioridade[] = ['Alta', 'Média', 'Baixa'];
export const TIPOS_SAUDE = ['', 'Consulta', 'Exame', 'Retorno', 'Vacina', 'Medicação'];
export const ROTULO_ESTRELA = ['', 'Muito insatisfatória', 'Insatisfatória', 'Boa', 'Muito boa', 'Excelente'];

// As badges do Graphé registram COMO a tarefa foi feita (e viram dossiê de coaching).
export const BADGES: Badge[] = [
  { e: '⚡', nome: 'Na hora', tipo: 'pos', cap: 5, piso: 3, auto: 5,
    txt: 'Fiz sem enrolar, na hora certa. Continue assim! ⚡',
    coach: 'pontualidade / baixa procrastinação — reforçar o gatilho que funcionou' },
  { e: '✨', nome: 'Caprichei', tipo: 'pos', cap: 5, auto: 5,
    txt: 'Fiz com capricho, bem acabado. Orgulho do resultado! ✨',
    coach: 'alta qualidade / capricho' },
  { e: '🎯', nome: 'Foco total', tipo: 'pos', cap: 5,
    txt: 'Foco total: sentei e fiz sem me dispersar. 🎯',
    coach: 'boa concentração — mapear condições (horário/ambiente) que geraram foco' },
  { e: '🧠', nome: 'Sacada', tipo: 'pos', cap: 5,
    txt: 'Resolvi de um jeito esperto — pensei fora da caixa. 💡',
    coach: 'criatividade / eficiência na solução' },
  { e: '💪', nome: 'Suei a camisa', tipo: 'pos', cap: 5,
    txt: 'Custou, mas fiz. Esforço e dedicação reconhecidos. 💪',
    coach: 'esforço alto — vigiar risco de esgotamento se recorrente' },
  { e: '🏔️', nome: 'Missão épica', tipo: 'pos', cap: 5,
    txt: 'Missão épica vencida: tarefa grande e pesada. Vale por várias! 🏔️',
    coach: 'tarefa de alta carga — avaliar se deveria ter sido fatiada' },
  { e: '🌱', nome: 'Aprendi', tipo: 'pos', cap: 5,
    txt: 'Aprendi algo no caminho. Evolução! 🌱',
    coach: 'aprendizado / crescimento' },
  { e: '🐌', nome: 'Enrolei', tipo: 'neg', cap: 2,
    txt: 'Procrastinei demais. Da próxima, começar antes — o difícil é só o começo. 🐌',
    coach: 'PROCRASTINAÇÃO — investigar causa (medo, tédio, tarefa mal definida)' },
  { e: '🔁', nome: 'Vou refazer', tipo: 'neg', cap: 2,
    txt: 'Não ficou como eu queria; vou precisar rever. Sem drama, ajusto e sigo. 🔁',
    coach: 'retrabalho — checar clareza do escopo antes de começar' },
  { e: '⏰', nome: 'Atrasei', tipo: 'neg', cap: 3,
    txt: 'Saiu fora do prazo. Vale ajustar o planejamento pra não repetir. ⏰',
    coach: 'estimativa de prazo otimista — revisar planejamento' },
  { e: '🩹', nome: 'Nas coxas', tipo: 'neg', cap: 3,
    txt: 'Fiz meia-boca, no mínimo pra passar. Dava pra caprichar mais. 🩹',
    coach: 'qualidade baixa por pressa/desânimo' },
  { e: '😵', nome: 'Me atrapalhei', tipo: 'neg', cap: 3,
    txt: 'Faltou organização e me perdi no meio. Da próxima, planejar antes de agir. 😵',
    coach: 'desorganização — faltou planejar/decompor a tarefa' },
];

export function badgeDe(e: string): Badge | undefined {
  return BADGES.find((b) => b.e === e);
}

/** 'AAAA-MM-DD' de hoje (+ dias), na hora local. */
export function isoDia(mais = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + mais);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Marcada como urgente, ou com prazo até amanhã (inclui as atrasadas). */
export function ehUrgente(t: Tarefa): boolean {
  if (t.status === 'Feito') return false;
  if (t.urgente) return true;
  return !!t.prazo && t.prazo <= isoDia(1);
}

export function ehAtrasada(t: Tarefa): boolean {
  return t.status !== 'Feito' && !!t.prazo && t.prazo < isoDia(0);
}

const PESO_PRIO: Record<string, number> = { Alta: 0, Média: 1, Baixa: 2 };

/** Abertas antes; prazo mais próximo antes (sem prazo depois); depois a prioridade. */
export function ordenar(lista: Tarefa[]): Tarefa[] {
  return [...lista].sort((a, b) => {
    const fa = a.status === 'Feito' ? 1 : 0;
    const fb = b.status === 'Feito' ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (!!a.prazo !== !!b.prazo) return a.prazo ? -1 : 1;
    if (a.prazo !== b.prazo) return a.prazo < b.prazo ? -1 : 1;
    if ((a.hora || '') !== (b.hora || '')) return (a.hora || '') < (b.hora || '') ? -1 : 1;
    return (PESO_PRIO[a.prioridade] ?? 1) - (PESO_PRIO[b.prioridade] ?? 1);
  });
}

/** O teto das badges negativas e o piso das positivas. */
export function limitesDaNota(sel: string[]): { cap: number; piso: number } {
  let cap = 5;
  let piso = 1;
  for (const e of sel) {
    const b = badgeDe(e);
    if (!b) continue;
    if (b.tipo === 'neg' && b.cap < cap) cap = b.cap;
    if (b.piso && b.piso > piso) piso = b.piso;
  }
  return { cap, piso: Math.min(piso, cap) };
}

export function areasDe(tarefas: Tarefa[]): string[] {
  const out = [...AREAS];
  for (const t of tarefas) if (t.area && !out.includes(t.area)) out.push(t.area);
  return out;
}

/** 'AAAA-MM-DD' → 'DD/MM/AA'. */
export function fmtData(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

/**
 * O dossiê do Kairós: estrelas, badges, atrasos, comentários e carga por área, com a
 * pergunta pronta no fim, para colar numa IA. O mesmo texto do Mac (kairos_store.coaching).
 */
export function dossieCoaching(tarefas: Tarefa[], dias = 90): string {
  const corte = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 19);
  const feitas = tarefas.filter((t) => t.status === 'Feito' && (t.concluidoEm || '') >= corte);
  const abertas = ordenar(tarefas.filter((t) => t.status !== 'Feito'));
  const porArea: Record<string, { n: number; estrelas: number; com: number; badges: Record<string, number> }> = {};
  const porBadge: Record<string, number> = {};
  let soma = 0;
  let nNota = 0;
  let atrasadas = 0;
  for (const t of feitas) {
    const a = (porArea[t.area] ??= { n: 0, estrelas: 0, com: 0, badges: {} });
    a.n += 1;
    if (t.estrelas) {
      a.estrelas += t.estrelas;
      a.com += 1;
      soma += t.estrelas;
      nNota += 1;
    }
    for (const e of t.badges ?? []) {
      porBadge[e] = (porBadge[e] ?? 0) + 1;
      a.badges[e] = (a.badges[e] ?? 0) + 1;
    }
    if (t.prazo && (t.concluidoEm || '').slice(0, 10) > t.prazo) atrasadas += 1;
  }
  const hoje = new Date();
  const L: string[] = [
    `DOSSIÊ DE PRODUTIVIDADE PESSOAL — últimos ${dias} dias`,
    `Gerado em ${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`,
    '',
    '## PANORAMA',
    `- Tarefas concluídas: ${feitas.length}`,
    `- Tarefas ainda abertas: ${abertas.length}`,
    `- Nota média de auto-avaliação: ${nNota ? `${(soma / nNota).toFixed(2)} ⭐ (n=${nNota})` : 'sem avaliações'}`,
    `- Concluídas após o prazo: ${atrasadas}`,
    '',
    '## POR ÁREA DA VIDA',
  ];
  for (const [nome, a] of Object.entries(porArea)) {
    const media = a.com ? `${(a.estrelas / a.com).toFixed(2)}⭐` : 's/ nota';
    const sinais = Object.entries(a.badges)
      .map(([e, n]) => `${e} ${badgeDe(e)?.nome ?? ''}×${n}`)
      .join(', ');
    L.push(`- ${nome}: ${a.n} concluída(s), média ${media}${sinais ? ` | sinais: ${sinais}` : ''}`);
  }
  L.push('', '## SINAIS REGISTRADOS (badges) — o que cada um indica');
  for (const [e, n] of Object.entries(porBadge).sort((x, y) => y[1] - x[1])) {
    const b = badgeDe(e);
    L.push(`- ${e} ${b?.nome ?? ''} ×${n}${b ? `  → ${b.coach}` : ''}`);
  }
  L.push('', '## TAREFAS CONCLUÍDAS (detalhe)');
  for (const t of feitas) {
    L.push(
      `- [${t.area}] "${t.titulo}" — ${t.estrelas || '?'}⭐ ${(t.badges ?? []).join('')}` +
        (t.prazo ? ` | prazo ${t.prazo}` : '') +
        ` | concluída ${(t.concluidoEm || '').slice(0, 10)}` +
        (t.comentario ? ` | eu anotei: "${t.comentario}"` : '') +
        (t.notas ? ` | obs: "${t.notas}"` : ''),
    );
  }
  L.push('', '## AINDA ABERTAS');
  for (const t of abertas) {
    L.push(
      `- [${t.area}] "${t.titulo}"` +
        (t.prazo ? ` | prazo ${t.prazo}` : ' | sem prazo') +
        (t.urgente ? ' | URGENTE' : '') +
        ` | prioridade ${t.prioridade}`,
    );
  }
  L.push(
    '',
    '---',
    'PERGUNTA PARA A IA: com base nestes dados, atue como meu coach de',
    'produtividade. Identifique padrões (procrastinação, atrasos, retrabalho,',
    'desequilíbrio entre áreas da vida, excesso de carga), diga o que estou',
    'fazendo bem e me dê de 3 a 5 conselhos práticos e específicos para as',
    'próximas semanas. Seja direto e honesto.',
  );
  return L.join('\n');
}
