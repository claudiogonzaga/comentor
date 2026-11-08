// As falas da Comentora em quatro tempos, com MUITA variação.
//
// A insistência cresce aos poucos (pedido do usuário):
//   1. antes  — uns minutos antes do horário, um aviso gentil: "está chegando a hora";
//   2. hora   — no horário, só lembra: é agora (sem perguntar nada);
//   3. pergunta — meia hora depois, pede a informação: já fez, precisa de mais
//      tempo ou hoje não? E diz que precisa dessa resposta;
//   4. insiste — as cobranças seguintes, cada vez mais espaçadas.
//
// A mesma frase todo dia vira ladainha e o cérebro aprende a ignorar. Então cada
// banco é grande e a escolha GIRA: muda todo dia, não repete em dias seguidos e
// passa por todas as frases antes de voltar a uma. É determinística por (dia,
// hábito, tempo): reagendar no mesmo dia não troca o texto.
//
// Marcadores: {t} = o nome da tarefa, {n} = o nome da pessoa, {m} = minutos de
// antecedência, {p}/{P} = a PISTA do hábito ("depois do café"; {P} com inicial
// maiúscula), {d} = número de dias (marcos). Frase com {n} só entra quando há nome.
//
// Tempos do APP DE HÁBITOS (v1.130): 'hora_pista' (o aviso na hora cita a pista —
// lembrete amarrado ao contexto forma hábito, lembrete solto só garante a
// repetição), 'volta' (o dia seguinte a uma falta: "nunca duas vezes"), 'parar'
// (a conferência da noite de um hábito de parar), 'marco', 'graduado' e 'srbai'.

import type { Tone } from '../types';

export type PhraseStage =
  | 'antes'
  | 'hora'
  | 'pergunta'
  | 'insiste'
  | 'hora_pista'
  | 'volta'
  | 'parar'
  | 'marco'
  | 'graduado'
  | 'srbai';

const ANTES = [
  'Daqui a {m} minutos: “{t}”. Só avisando, sem pressa.',
  'Psiu… em {m} minutinhos é a vez de “{t}”.',
  'A coruja aqui, piscando um olho: “{t}” vem aí, logo, logo.',
  '{n}, guarda um espacinho: “{t}” chega em {m} minutos.',
  'Contagem regressiva gentil: faltam {m} minutos para “{t}”.',
  'Vai terminando o que está fazendo — “{t}” está batendo à porta.',
  'Aviso de corujinha: “{t}” daqui a pouco.',
  'Daqui a pouco o relógio chama para “{t}”. Pode ir se ajeitando.',
  'Pequeno spoiler do seu dia: “{t}” em {m} minutos.',
  'Prepara o terreno: “{t}” começa já, já.',
  '{n}, um lembrete de veludo: “{t}” está quase na hora.',
  'O futuro próximo tem “{t}”. Faltam uns {m} minutos.',
  'Quase lá: {m} minutos para “{t}”. Respira e segue.',
  'Ventinho de aviso: “{t}” já está no horizonte.',
  'Só para não te pegar de surpresa: “{t}” daqui a pouco.',
  'Fecha a aba mental que der: “{t}” chega em instantes.',
  '{m} minutos e aí é com “{t}”. Você já sabe o caminho.',
  'Tic-tac suave: “{t}” logo ali.',
  'A agenda sussurra: “{t}” em {m} minutos.',
  '{n}, vai preparando o corpo e a cabeça: “{t}” já vem.',
  'Daqui a pouco, “{t}”. Deixa o que precisar à mão.',
  'Um passarinho me contou que “{t}” é daqui a {m} minutos.',
  'Lembrete antecipado, do tipo educado: “{t}” vem aí.',
  'Mais {m} minutos do que você estiver fazendo, depois “{t}”.',
  'Pré-aviso de coruja pontual: “{t}” em breve.',
  '{n}, o próximo capítulo do dia se chama “{t}”. Começa em {m} minutos.',
  'Afinando os instrumentos: “{t}” entra em cena daqui a pouco.',
  'Ainda não é agora — mas “{t}” já está pertinho.',
  'Separa um copo d’água e um minuto de coragem: “{t}” vem aí.',
];

const HORA = [
  'Chegou a hora de “{t}”.',
  'É agora: “{t}”.',
  '{n}, o relógio bateu: “{t}”.',
  'Hora marcada: “{t}”.',
  'A coruja pousou no seu ombro: “{t}”, agora.',
  'Toca o gongo: “{t}”.',
  'Este é o momento de “{t}”. Um passo e pronto.',
  'Agora é com você e “{t}”.',
  'Pontualmente: “{t}”.',
  '{n}, “{t}” te espera neste minuto.',
  'O dia abriu espaço para “{t}”. É agora.',
  'Hora de “{t}”. Começar é a parte que mais vale.',
  'Hora H de “{t}”. Vai lá.',
  'O você de mais cedo marcou “{t}” para agora. Honra o combinado.',
  'Agora, “{t}”. O resto pode esperar um pouquinho.',
  'Sinal verde para “{t}”.',
  '“{t}”: o horário é este.',
  '{n}, chegou a vez de “{t}”. Só o primeiro gesto já conta.',
  'Relógio no ponto: “{t}”.',
  'Coruja de plantão avisando: “{t}”, já.',
  'Momento “{t}”. Bora.',
  'É a sua hora com “{t}”.',
  'Hora de “{t}”, sem drama e sem pressa.',
  'Aqui está ele, pontual como você: “{t}”.',
  'Cortina aberta: entra “{t}”.',
  '{n}, “{t}” agora — e depois você me conta como foi.',
  'O ponteiro chegou lá: “{t}”.',
  'Agora é a hora boa de “{t}”. A outra hora boa é nunca.',
];

const PERGUNTA_GENTIL = [
  '{n}, me conta: “{t}” já foi? Se precisar de mais tempo, é só pedir. Preciso saber para me organizar.',
  'Passou um tempinho: “{t}” está feito ou quer mais tempo? Me avisa — sem essa informação eu fico no escuro.',
  'Pergunta honesta da coruja: “{t}”, feito? Se não deu ainda, peça mais tempo, sem culpa.',
  'Para eu não te cobrar à toa: “{t}” já está feito? Ou prefere mais tempo?',
  '{n}, preciso de um sinal: “{t}” — feito, mais tempo ou hoje não?',
  'Atualiza a coruja? “{t}”: já foi, falta um pouco ou ficou para outro dia?',
  'Só uma informação, prometo: “{t}” aconteceu? Se não, escolha mais tempo.',
  'Me ajuda a te ajudar: “{t}” já está riscado da lista? Preciso saber.',
  'Um toque responde: “{t}” feito? Ou o dia pediu mais tempo?',
  '{n}, sem julgamento: “{t}” deu certo? Preciso saber para não insistir à toa.',
  'Um toquinho só: “{t}” — fez, quer mais tempo, ou hoje não?',
  'A coruja está fazendo as contas do dia: “{t}” entra como feito ou ganha mais tempo?',
  '{n}, como ficou “{t}”? Sua resposta decide se eu volto a lembrar ou fico quieta.',
  'Para o seu registro (e para a minha paz): “{t}” — já foi?',
];

const PERGUNTA_FIRME = [
  '{n}, preciso de uma resposta: “{t}” foi feito? Se não, peça mais tempo agora.',
  'Já passou da hora: “{t}”. Feito ou não? Me diga, que eu ajusto o resto.',
  'Sem enrolar: “{t}” — feito, mais tempo ou não vai rolar?',
  'Registro, por favor: “{t}”. Um toque e eu paro de perguntar.',
  '“{t}” ainda está em aberto. Resolve comigo: feito ou mais tempo?',
  '{n}, a coruja quer um fato: “{t}” aconteceu?',
  'Não é cobrança, é dado: “{t}” — sim, não ou daqui a pouco?',
  'Preciso saber agora: “{t}” está feito? Responda com um toque.',
  '{n}, sem essa resposta eu não sei se insisto ou se te deixo em paz: “{t}”?',
];

const INSISTE = [
  'Um passo minúsculo já vale: comece “{t}” por um minuto.',
  'O {n} de amanhã vai agradecer o de hoje por “{t}”.',
  'Seu futuro está assistindo. “{t}” é a cena de agora.',
  'Fazer “{t}” leva menos tempo do que adiar pensando nele.',
  'Imagina a sensação de riscar “{t}” daqui a pouco. Ela está a um gesto.',
  'Você é do tipo que cumpre o combinado. “{t}” prova isso.',
  'Dois minutos. Só dois. “{t}” começa pequeno.',
  'Não precisa estar perfeito: “{t}” feito de qualquer jeito já conta.',
  'A sequência de dias depende de hoje. “{t}” mantém ela viva.',
  'Coruja teimosa aqui. “{t}” continua esperando por você.',
  'Se fosse fácil, eu nem lembraria. É por isso que “{t}” importa.',
  'Pausa no que está fazendo: “{t}” agora, o resto depois.',
  'Que tal fazer “{t}” antes que a preguiça ensaie um discurso?',
  'Cada vez que você faz “{t}”, fica mais fácil fazer de novo.',
  'Vencer a si mesmo é a maior das vitórias. “{t}” é a batalha do momento.',
  '“{t}”: o investimento mais barato do seu dia.',
  'Não negocie com a vontade de adiar. Só levanta e faz “{t}”.',
  '{n}, um sim agora vale mais que três “depois”. “{t}”.',
  'Até a coruja mais paciente pisca de impaciência: “{t}”.',
  'Faz por você, não por mim: “{t}”.',
  'O momento ideal não vem. O momento possível é este: “{t}”.',
  'Respira fundo, conta até três, e vai: “{t}”.',
  'Três, dois, um… “{t}”.',
  'Ainda dá tempo de hoje ter “{t}”. Aproveita.',
  'Plot twist do dia: você faz “{t}” agora e surpreende até a coruja.',
  '{n}, lembra por que você escolheu “{t}”? O motivo ainda está aí.',
  'Pequeno, hoje, agora: “{t}”. Não precisa ser heroico.',
  'O cansaço fala alto, mas “{t}” fala por você.',
];

const INSISTE_BRUTAL = [
  'Adiar “{t}” é escolher a pior versão de você. Escolhe a outra.',
  'Desculpa nenhuma resiste a dois minutos de “{t}”.',
  'O sofá não vai fazer “{t}” por você.',
  '“{t}” não se faz sozinho. Bora.',
  '{n}, chega de “daqui a pouco”. “{t}”, agora.',
];

const HORA_PISTA = [
  '{P}: é a deixa para “{t}”.',
  'O plano é seu: {p}, “{t}”. Chegou a hora.',
  '{P} — a pista apareceu. Agora, “{t}”.',
  'Lembra do combinado? {P}, “{t}”.',
  '{P}, sem pensar muito: “{t}”.',
  'A deixa de sempre ({p}) pede “{t}”.',
  '{n}, {p}: é a vez de “{t}”.',
  '{P}. O resto do dia espera: “{t}” primeiro.',
  'Pista à vista ({p}): “{t}”.',
  '{P}: o gatilho tocou. “{t}”, agora.',
  'É aquele momento: {p}. Então, “{t}”.',
  'Mesma pista, mesmo gesto: {p}, “{t}”.',
  '{P} — repetir no mesmo contexto é o que transforma isto em hábito. “{t}”.',
  'O roteiro: {p}, “{t}”. Cena de agora.',
  '{n}, a deixa é {p}. Vai de “{t}”.',
  '{P}: um gesto só, “{t}”.',
  'Contexto certo, hora certa: {p}, “{t}”.',
  '{P}? O seu cérebro já está aprendendo o caminho: “{t}”.',
];

const VOLTA = [
  'Ontem escapou — normal. Hoje é o dia que conta: “{t}”.',
  'Uma falta não desfaz nada. Duas seguidas, sim. “{t}” hoje.',
  '{n}, ontem não deu. Hoje a regra é simples: nunca duas vezes. “{t}”.',
  'Voltar logo é o que forma hábito. “{t}”, hoje.',
  'O que importa não é ontem, é a volta. “{t}”.',
  'Ontem ficou para trás. “{t}” hoje e a linha segue firme.',
  'Hábito não se mede por um dia, e sim pela volta. “{t}”.',
  'Nunca falhe duas vezes: “{t}” hoje fecha a lacuna de ontem.',
  'Recomeço de bolso: “{t}”, hoje mesmo.',
  '{n}, sem culpa por ontem — só “{t}” hoje.',
  'Ontem a vida ganhou. Hoje, “{t}” — nem que seja a versão mínima.',
  'A pesquisa é clara: uma falta não atrapalha; o que conta é voltar. “{t}”.',
  'Dia de retorno: “{t}”. Pequeno já vale.',
  'Ontem foi um tropeço, não um caminho. “{t}” hoje.',
  'Volta curtinha, volta que conta: “{t}”.',
  '{n}, hoje é o dia mais importante da semana para “{t}”: o da volta.',
];

const PARAR = [
  'Como foi hoje com “{t}”? Dia limpo?',
  '{n}, balanço rápido: hoje sem “{t}”?',
  'Fechando o dia: “{t}” ficou de fora?',
  'Um toque: hoje foi dia limpo de “{t}”?',
  'Pergunta da noite: “{t}” — conseguiu passar sem?',
  'Hoje você venceu “{t}”? Me conta, sem julgamento.',
  'Registro do dia: limpo de “{t}”, ou escorregou? As duas respostas ensinam.',
  '{n}, como a vontade de “{t}” se comportou hoje?',
  'Mais um dia contra “{t}”. Como terminou?',
  'Diário de bordo: “{t}” hoje — limpo ou deslize?',
  'Sem culpa, só o dado: hoje teve “{t}”?',
  'A coruja quer saber: “{t}” ficou longe hoje?',
  'Antes de dormir: dia limpo de “{t}”?',
  'Um deslize é informação, não sentença. Hoje teve “{t}”?',
];

const MARCO = [
  '{d} dias de “{t}”. Isso já está mudando o caminho no seu cérebro.',
  '{n}, {d} dias feitos de “{t}”! Comemora — foi você que construiu.',
  'Marco: {d} dias de “{t}”. Repetição a repetição, vira você.',
  '{d} vezes “{t}”. Cada uma deixou a próxima mais leve.',
  'Olha só: {d} dias de “{t}”. A coruja tirou o chapéu.',
  '{d} dias de “{t}”. Não foi sorte, foi repetição.',
  '{d}! “{t}” está criando raiz.',
  '{n}, {d} dias de “{t}”. Que tal contar para alguém?',
  'Mais um degrau: {d} dias de “{t}”.',
  '{d} dias de “{t}”. O que parecia esforço vai virando paisagem.',
];

const GRADUADO = [
  '“{t}” ficou automático. Vou parar de lembrar — de vez em quando, pergunto como está.',
  '{n}, “{t}” já é seu: acontece sem a coruja. A partir de hoje, silêncio.',
  'Formado: “{t}”. Você não precisa mais de mim para isso.',
  '“{t}” passou na prova da automaticidade. Graduado! Eu me recolho.',
  'Missão cumprida com “{t}”: virou hábito. Volto só para conferir.',
  'A coruja sai de cena: “{t}” agora anda sozinho.',
];

const SRBAI = [
  'Como está “{t}”? Quatro perguntas rápidas, 20 segundos.',
  '{n}, conferência de hábito: “{t}” já sai no automático? Quatro toques.',
  'Hora de medir “{t}”: quanto ele já acontece sem pensar?',
  'Checagem rápida de “{t}”: quatro perguntas, e eu ajusto os lembretes.',
  '“{t}” está ficando automático? Me ajuda a medir — 20 segundos.',
  'Termômetro do hábito: “{t}”. Quatro perguntas.',
];

const BANKS: Record<PhraseStage, (tone: Tone) => string[]> = {
  antes: () => ANTES,
  hora: () => HORA,
  pergunta: (tone) => (tone === 'gentle' ? PERGUNTA_GENTIL : [...PERGUNTA_FIRME, ...PERGUNTA_GENTIL.slice(0, 5)]),
  insiste: (tone) => (tone === 'brutal' ? [...INSISTE, ...INSISTE_BRUTAL] : INSISTE),
  hora_pista: () => HORA_PISTA,
  volta: () => VOLTA,
  parar: () => PARAR,
  marco: () => MARCO,
  graduado: () => GRADUADO,
  srbai: () => SRBAI,
};

/** FNV-1a: hash pequeno e estável. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Dia corrido local (para o rodízio andar uma casa por dia). */
function dayIndex(dayISO: string): number {
  const [y, m, d] = dayISO.split('-').map((x) => parseInt(x, 10));
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
}

export interface PhraseContext {
  /** Nome da tarefa (título do hábito ou do lembrete). */
  task: string;
  /** Nome da pessoa (pode faltar). */
  name?: string | null;
  tone?: Tone;
  /** Dia (yyyy-MM-dd) e chave do hábito: semente do rodízio. */
  day: string;
  key: string;
  /** k-ésima insistência (só para 'insiste'), para variar dentro do dia. */
  k?: number;
  /** Minutos de antecedência (só para 'antes'). */
  minutes?: number;
  /** A pista do hábito ("depois do café"). Sem pista, 'hora_pista' vira 'hora'. */
  cue?: string | null;
  /** Número de dias (só para 'marco'). */
  count?: number;
}

/** Inicial maiúscula (a pista começa a frase). */
function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s;
}

/**
 * Uma fala do tempo pedido. Gira um passo por dia (passo coprimo com o tamanho
 * do banco: passa por todas antes de repetir) e, nas insistências, outro passo
 * por batida — duas batidas do mesmo dia nunca repetem a mesma frase.
 */
export function nudgePhrase(stage: PhraseStage, ctx: PhraseContext): string {
  const cue = (ctx.cue ?? '').trim().replace(/[.!?…]+$/, '');
  if (stage === 'hora_pista' && !cue) stage = 'hora';
  const name = ctx.name?.trim() || '';
  const bank = BANKS[stage](ctx.tone ?? 'gentle').filter((p) => name || !p.includes('{n}'));
  const n = bank.length;
  let step = 7;
  while (gcd(step, n) !== 1) step += 2;
  const base = hash32(`${stage}|${ctx.key}`);
  const idx = (base + dayIndex(ctx.day) * step + (ctx.k ?? 0) * (step + 4)) % n;
  return bank[idx]
    .replace(/\{t\}/g, ctx.task.trim())
    .replace(/\{n\}/g, name)
    .replace(/\{m\}/g, String(ctx.minutes ?? 10))
    .replace(/\{P\}/g, capitalize(cue))
    .replace(/\{p\}/g, cue.charAt(0).toLocaleLowerCase('pt-BR') + cue.slice(1))
    .replace(/\{d\}/g, String(ctx.count ?? 0));
}

/** Antecedência do aviso gentil, em minutos. */
export const PRE_REMINDER_MIN = 10;
