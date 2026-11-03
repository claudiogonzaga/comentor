// As regras do Kairós: a lista de tarefas por área da vida que nasceu como planilha
// + Apps Script (projeto kairos-todo) e agora mora no Áskesis. As mesmas regras estão
// em kairos_store.py, no Áskesis do Mac: urgentes, ordem, teto e piso da nota.

export type Status = 'A fazer' | 'Feito';
export type Prioridade = 'Alta' | 'Média' | 'Baixa';

/** Conversa ou sessão de IA ligada à tarefa: o card abre exatamente ela. */
export interface Conversa {
  url: string;
  ia: string;
  titulo?: string;
  em: string;
  /** Tirada do card. Fica marcada, não apagada, para não voltar pela sincronização. */
  oculta?: boolean;
}

/** Um avanço da execução, quase sempre registrado pela IA (pelo MCP do Mac). */
export interface Andamento {
  em: string;
  por: string;
  texto: string;
}

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
  conversas?: Conversa[];
  andamento?: Andamento[];
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

// ---- IA na tarefa ------------------------------------------------------------
// Muitas tarefas são executadas por uma IA agêntica. O card guarda os links das
// conversas, para abrir exatamente a conversa, e o andamento que a IA registra.

const IAS: [string, string][] = [
  ['claude://code', 'Claude Code'],
  ['claude://claude.ai/epitaxy', 'Claude Code'],
  ['claude.ai/code', 'Claude Code'],
  ['claude://', 'Claude'],
  ['claude.ai', 'Claude'],
  ['gemini.google.com', 'Gemini'],
  ['g.co/gemini', 'Gemini'],
  ['grok.com', 'Grok'],
  ['x.com/i/grok', 'Grok'],
  ['chatgpt.com', 'ChatGPT'],
  ['chat.openai.com', 'ChatGPT'],
];

export const IA_COR: Record<string, string> = {
  'Claude Code': '#D97757',
  Claude: '#D97757',
  Gemini: '#4285F4',
  Grok: '#1D1D1F',
  ChatGPT: '#10A37F',
};

/** De que IA é a conversa, pelo endereço (a mesma regra de kairos_store.ia_do_link). */
export function iaDoLink(url: string): string {
  const u = url.toLowerCase();
  for (const [trecho, nome] of IAS) if (u.includes(trecho)) return nome;
  const host = u.split('://').pop()?.split('/')[0] ?? '';
  return host.replace(/^www\./, '') || 'IA';
}

/** O link copiado, se for de conversa: https://, http:// ou claude://, sem aspas (a mesma regra do Mac). */
export function linkDeConversa(texto: string): string | null {
  const url = texto.trim().split(/\s+/)[0] ?? '';
  return /^(https?|claude):\/\/[^\s"'<>`\\]+$/i.test(url) ? url : null;
}

/** O pedido que abre a conversa com a IA: a tarefa e como ela acompanha o card. */
export function promptDelegacao(t: Tarefa): string {
  const meta = [`Área: ${t.area}`, `Prioridade: ${t.prioridade}`];
  if (t.prazo) {
    const [y, m, d] = t.prazo.split('-');
    meta.push(`Prazo: ${d}/${m}/${y}${t.hora ? ` ${t.hora}` : ''}`);
  }
  const linhas = [`Tarefa do Kairós (Noosfera), id ${t.id}:`, `"${t.titulo}"`, meta.join(' · ')];
  if (t.notas) linhas.push(`Notas: ${t.notas}`);
  linhas.push(
    '',
    'Quero que você me ajude a executar esta tarefa.',
    `- Com o MCP "noosfera": leia o card com ver_tarefa("${t.id}"), vincule esta conversa com ` +
      'vincular_conversa (no Claude Code do app do Claude, o link da sessão vem de ' +
      'get_session("self")), registre cada avanço com registrar_andamento e me pergunte antes de concluir.',
    '- Sem o MCP, trabalhe com o que está aqui e me diga o que fazer a cada passo.',
  );
  return linhas.join('\n');
}

/** JSON com as chaves em ordem: o desempate igual nos dois aparelhos (json.dumps sort_keys). */
export function ordemJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(ordemJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${ordemJson(obj[k])}`).join(',')}}`;
}

function porUrl(lista: Conversa[]): Conversa[] {
  const out = new Map<string, Conversa>();
  for (const c of lista) {
    if (!c?.url) continue;
    const cur = out.get(c.url);
    const novo = [c.em || '', ordemJson(c)] as const;
    if (!cur || novo[0] > (cur.em || '') || (novo[0] === (cur.em || '') && novo[1] > ordemJson(cur))) out.set(c.url, c);
  }
  // Por (em, url), como a tupla do Python.
  return [...out.values()].sort((a, b) =>
    (a.em || '') !== (b.em || '') ? ((a.em || '') < (b.em || '') ? -1 : 1) : a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
  );
}

/**
 * Duas versões da mesma tarefa, mudadas cada uma de um lado desde a última que os dois
 * viram (base). Cada campo fica com o lado que o mudou; se os dois mudaram o mesmo
 * campo, com o mais recente. O andamento e as conversas se somam. É a mesma regra de
 * kairos_store.mesclar, no Mac: os dois lados chegam ao mesmo resultado.
 */
export function mergeTarefa(
  base: Tarefa | null | undefined,
  local: Tarefa,
  remote: Tarefa,
  localMaisNovo: boolean,
): Tarefa {
  const L = local as unknown as Record<string, unknown>;
  const R = remote as unknown as Record<string, unknown>;
  const B = (base ?? null) as unknown as Record<string, unknown> | null;
  const vencedora = localMaisNovo ? L : R;
  const out: Record<string, unknown> = {};
  for (const k of [...new Set([...Object.keys(L), ...Object.keys(R)])].sort()) {
    if (k === 'andamento' || k === 'conversas') continue;
    const temL = k in L;
    const temR = k in R;
    if (temL && temR && ordemJson(L[k]) === ordemJson(R[k])) {
      out[k] = L[k];
      continue;
    }
    if (B) {
      const temB = k in B;
      const localIgual = temL === temB && ordemJson(L[k]) === ordemJson(B[k]);
      const remotoIgual = temR === temB && ordemJson(R[k]) === ordemJson(B[k]);
      if (localIgual !== remotoIgual) {
        const [lado, tem] = localIgual ? [R, temR] : [L, temL];
        if (tem) out[k] = lado[k];
        continue;
      }
    }
    if (k in vencedora) out[k] = vencedora[k];
  }
  const andamento = new Map<string, Andamento>();
  for (const e of [...(local.andamento ?? []), ...(remote.andamento ?? [])]) {
    const chave = JSON.stringify([e.em || '', e.texto || '']);
    const cur = andamento.get(chave);
    if (!cur || ordemJson(e) > ordemJson(cur)) andamento.set(chave, e);
  }
  if (andamento.size || 'andamento' in L || 'andamento' in R) {
    // Por (em, texto), como a tupla do Python.
    const em = (e: Andamento) => e.em || '';
    const tx = (e: Andamento) => e.texto || '';
    out.andamento = [...andamento.values()].sort((a, b) =>
      em(a) !== em(b) ? (em(a) < em(b) ? -1 : 1) : tx(a) < tx(b) ? -1 : tx(a) > tx(b) ? 1 : 0,
    );
  }
  const conversas = porUrl([...(local.conversas ?? []), ...(remote.conversas ?? [])]);
  if (conversas.length || 'conversas' in L || 'conversas' in R) out.conversas = conversas;
  return out as unknown as Tarefa;
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
