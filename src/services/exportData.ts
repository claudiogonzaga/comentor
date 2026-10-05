// EXPORTAÇÃO PARA A IA.
//
// Um toque → um Markdown com tudo o que a coruja coletou no período, com um
// cabeçalho de análise pronto para colar num chat (Claude, ChatGPT…). É o que
// fecha o loop: pessoa + IA externa discutem os dados e propõem intervenções,
// que voltam ao app como experimentos.
//
// Também gera CSV (tabela diária) e JSON (tudo, estruturado). Nada sai do
// aparelho sem a pessoa mandar: clipboard ou folha de compartilhamento.

import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import {
  getChatSince,
  getCompletionsBetween,
  getHabitByType,
  getHabitEventsBetween,
  getHealthDailyBetween,
  getKV,
  getLatestCompletedInterview,
  getLogsBetween,
  getSnoozeFeedbackSince,
  getTechniqueStats,
  getUserConfig,
  listExperiments,
  listMedications,
  listNudges,
  getAllHabitStates,
  getMindfulSessionsBetween,
  getDecisionPointsBetween,
  getAutomaticityBetween,
  type CompletionRow,
  type DecisionPoint,
  type MindfulSession,
  type Experiment,
  type HabitEvent,
  type HealthDaily,
} from './database';
import { minutesLateOf } from './habitFormation';
import type { DailyLog, Medication, Nudge } from '../types';

export type ExportFormat = 'md' | 'csv' | 'json';

export interface ExportOptions {
  days: 14 | 30 | 90;
  includeChat: boolean;
  includeInterview: boolean;
}

type ItemStatus = 'feito' | 'não fez' | 'sem resposta' | '—';

interface DayHabit {
  key: string;
  title: string;
  status: ItemStatus;
  via: string | null;
  k: number | null;
  latencyMin: number | null;
  technique: string | null;
  reason: string | null;
  /** Confirmação automática: a evidência (relógio, prática no app). */
  evidence: string | null;
  /** Houve uma confirmação automática DESFEITA pela pessoa neste dia (falso positivo). */
  autoUndone: boolean;
}

interface DayRecord {
  date: string;
  weekday: string;
  experiments: string[];
  sleep: {
    target: string;
    actual: string | null;
    lateMin: number | null;
    morningFeeling: number | null;
    notes: string | null;
    remindersSent: number;
  } | null;
  health: HealthDaily | null;
  habits: DayHabit[];
  /** Práticas feitas no app (respiração, Ioga Nidra). */
  practices: { kind: string; minutes: number; completed: boolean; at: string }[];
  feedback: string[];
}

interface Summary {
  nights: number;
  nightsOnTime: number;
  avgLateMin: number | null;
  avgMorningFeeling: number | null;
  avgSteps: number | null;
  avgSleepMinutes: number | null;
  completeDays: number;
  totalDays: number;
  habitRates: { title: string; done: number; notDone: number; noAnswer: number }[];
}

function iso(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function fmtLate(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function fmtMinutes(min: number): string {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

function hhmmOf(isoDateTime: string | null): string | null {
  if (!isoDateTime) return null;
  const d = new Date(isoDateTime);
  return Number.isNaN(d.getTime()) ? null : format(d, 'HH:mm');
}

function avg(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

function activeExperimentsOn(experiments: Experiment[], date: string): string[] {
  return experiments
    .filter((e) => e.startDate <= date && (!e.endDate || e.endDate >= date))
    .map((e) => {
      const day = Math.round((parseISO(date).getTime() - parseISO(e.startDate).getTime()) / 86_400_000) + 1;
      return `${e.name} (dia ${day})`;
    });
}

/** Monta o retrato do período, dia a dia. */
async function collect(opts: ExportOptions) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (opts.days - 1));
  const fromISO = iso(from);
  const toISO = iso(to);

  const config = await getUserConfig();
  const sleepHabit = await getHabitByType('sleep').catch(() => null);
  const [logs, health, completions, events, nudges, meds, experiments, techniques, states] = await Promise.all([
    sleepHabit ? getLogsBetween(sleepHabit.id, fromISO, toISO).catch(() => [] as DailyLog[]) : [],
    getHealthDailyBetween(fromISO, toISO).catch(() => [] as HealthDaily[]),
    getCompletionsBetween(fromISO, toISO).catch(() => [] as CompletionRow[]),
    getHabitEventsBetween(fromISO, toISO).catch(() => [] as HabitEvent[]),
    listNudges().catch(() => [] as Nudge[]),
    listMedications().catch(() => [] as Medication[]),
    listExperiments().catch(() => [] as Experiment[]),
    getTechniqueStats().catch(() => []),
    getAllHabitStates().catch(() => []),
  ]);
  const [mindful, decisionsAll, automaticity] = await Promise.all([
    getMindfulSessionsBetween(fromISO, toISO).catch(() => [] as MindfulSession[]),
    getDecisionPointsBetween(fromISO, toISO).catch(() => [] as DecisionPoint[]),
    getAutomaticityBetween(fromISO, toISO).catch(() => [] as { key: string; date: string; score: number }[]),
  ]);
  const feedback = sleepHabit ? await getSnoozeFeedbackSince(sleepHabit.id, fromISO).catch(() => []) : [];
  const chat = opts.includeChat && sleepHabit ? await getChatSince(sleepHabit.id, fromISO).catch(() => []) : [];
  const interview = opts.includeInterview ? await getLatestCompletedInterview().catch(() => null) : null;
  let followups: { date: string; text: string }[] = [];
  if (opts.includeInterview) {
    try {
      const raw = await getKV('interview_followups');
      followups = raw ? (JSON.parse(raw) as { date: string; text: string }[]) : [];
    } catch {
      followups = [];
    }
  }

  const titles = new Map<string, string>();
  for (const n of nudges) titles.set(n.type, n.title);
  for (const m of meds) titles.set(`med:${m.id}`, m.name);
  const itemKeys = [
    ...nudges.filter((n) => n.enabled).map((n) => n.type),
    ...meds.filter((m) => m.enabled).map((m) => `med:${m.id}`),
  ];

  const logByDate = new Map(logs.map((l) => [l.date, l]));
  const healthByDate = new Map(health.map((h) => [h.date, h]));
  const compByDate = new Map<string, Set<string>>();
  for (const c of completions) {
    if (!compByDate.has(c.date)) compByDate.set(c.date, new Set());
    compByDate.get(c.date)!.add(c.nudgeType);
  }
  // O último evento de RESPOSTA vence; um "desfazer" logo depois de uma
  // confirmação automática marca falso positivo do sensor.
  const eventByDateKey = new Map<string, HabitEvent>();
  const autoUndone = new Set<string>();
  for (const e of events) {
    const dk = `${e.date}|${e.key}`;
    if (e.status === 'undone') {
      if (eventByDateKey.get(dk)?.via === 'sensor') autoUndone.add(dk);
      eventByDateKey.delete(dk);
      continue;
    }
    eventByDateKey.set(dk, e);
  }
  // Hoje ainda está em curso: as cobranças das próximas horas não "foram enviadas".
  const decisions = decisionsAll.filter((d) => d.date < toISO);
  const practicesByDate = new Map<string, DayRecord['practices']>();
  for (const s of mindful) {
    if (!practicesByDate.has(s.date)) practicesByDate.set(s.date, []);
    practicesByDate.get(s.date)!.push({
      kind: s.kind === 'breathing' ? 'respiração' : 'Ioga Nidra',
      minutes: Math.round(s.minutes),
      completed: s.completed,
      at: hhmmOf(s.startedAt) ?? '',
    });
  }
  const feedbackByDate = new Map<string, string[]>();
  for (const f of feedback) {
    const d = f.createdAt.slice(0, 10);
    const text = [f.reason, f.customText].filter(Boolean).join(' — ');
    if (!text) continue;
    if (!feedbackByDate.has(d)) feedbackByDate.set(d, []);
    feedbackByDate.get(d)!.push(text);
  }

  const days: DayRecord[] = [];
  for (let i = 0; i < opts.days; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const date = iso(d);
    const comp = compByDate.get(date) ?? new Set<string>();
    const log = logByDate.get(date) ?? null;
    const habits: DayHabit[] = itemKeys.map((key) => {
      let status: ItemStatus = '—';
      if (comp.has(key)) status = 'feito';
      else if (comp.has(`${key}:skip`)) status = 'não fez';
      else if (comp.has(`${key}:missed`)) status = 'sem resposta';
      const ev = eventByDateKey.get(`${date}|${key}`);
      return {
        key,
        title: titles.get(key) ?? key,
        status,
        via: ev?.via ?? null,
        k: ev?.k ?? null,
        latencyMin: ev?.latencyMin ?? null,
        technique: ev?.technique ?? null,
        reason: ev?.reason ?? null,
        evidence: ev?.via === 'sensor' ? ev?.evidence ?? null : null,
        autoUndone: autoUndone.has(`${date}|${key}`),
      };
    });
    days.push({
      date,
      weekday: format(d, 'EEE', { locale: ptBR }),
      experiments: activeExperimentsOn(experiments, date),
      sleep: log
        ? {
            target: log.targetTime,
            actual: log.actualTime,
            lateMin: minutesLateOf(log.targetTime, log.actualTime),
            morningFeeling: log.morningFeeling,
            notes: log.notes,
            remindersSent: log.remindersSent,
          }
        : null,
      health: healthByDate.get(date) ?? null,
      habits,
      practices: practicesByDate.get(date) ?? [],
      feedback: feedbackByDate.get(date) ?? [],
    });
  }

  // Resumo
  const nights = days.filter((x) => x.sleep && x.sleep.actual);
  const lates = nights.map((x) => x.sleep!.lateMin).filter((v): v is number => v !== null);
  const feelings = days.map((x) => x.sleep?.morningFeeling).filter((v): v is number => typeof v === 'number');
  const steps = days.map((x) => x.health?.steps).filter((v): v is number => typeof v === 'number' && v > 0);
  const sleepMins = days.map((x) => x.health?.sleepMinutes).filter((v): v is number => typeof v === 'number' && v > 0);
  const pastDays = days.filter((x) => x.date < toISO);
  const completeDays = pastDays.filter((x) => x.habits.every((h) => h.status === 'feito' || h.status === 'não fez')).length;
  const habitRates = itemKeys.map((key) => {
    const rows = pastDays.map((x) => x.habits.find((h) => h.key === key)!);
    return {
      title: titles.get(key) ?? key,
      done: rows.filter((h) => h.status === 'feito').length,
      notDone: rows.filter((h) => h.status === 'não fez').length,
      noAnswer: rows.filter((h) => h.status === 'sem resposta' || h.status === '—').length,
    };
  });
  const summary: Summary = {
    nights: nights.length,
    nightsOnTime: lates.filter((v) => v <= 15).length,
    avgLateMin: avg(lates),
    avgMorningFeeling: avg(feelings),
    avgSteps: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null,
    avgSleepMinutes: sleepMins.length ? Math.round(sleepMins.reduce((a, b) => a + b, 0) / sleepMins.length) : null,
    completeDays,
    totalDays: pastDays.length,
    habitRates,
  };

  return {
    fromISO, toISO, config, days, summary, experiments, techniques, states, chat, interview, followups, titles,
    decisions, automaticity,
  };
}

type Collected = Awaited<ReturnType<typeof collect>>;

/** Compara um experimento com o período de mesma duração imediatamente anterior. */
function experimentComparison(e: Experiment, days: DayRecord[]): string {
  const start = e.startDate;
  const end = e.endDate ?? days[days.length - 1]?.date ?? start;
  const during = days.filter((d) => d.date >= start && d.date <= end);
  if (during.length === 0) return 'sem dias no período exportado';
  const len = during.length;
  const before = days.filter((d) => d.date < start).slice(-len);
  const stat = (set: DayRecord[]) => {
    const lates = set.map((d) => d.sleep?.lateMin).filter((v): v is number => typeof v === 'number');
    const feel = set.map((d) => d.sleep?.morningFeeling).filter((v): v is number => typeof v === 'number');
    const stp = set.map((d) => d.health?.steps).filter((v): v is number => typeof v === 'number' && v > 0);
    const all = set.flatMap((d) => d.habits);
    const answered = all.filter((h) => h.status === 'feito' || h.status === 'não fez');
    const doneRate = answered.length ? Math.round((all.filter((h) => h.status === 'feito').length / answered.length) * 100) : null;
    return { late: avg(lates), feel: avg(feel), steps: stp.length ? Math.round(stp.reduce((a, b) => a + b, 0) / stp.length) : null, doneRate, n: set.length };
  };
  const a = stat(before);
  const b = stat(during);
  const f = (v: number | null, unit = '') => (v === null ? '—' : `${v}${unit}`);
  return (
    `antes (${a.n} dias) → durante (${b.n} dias): ` +
    `atraso médio ${f(a.late, ' min')} → ${f(b.late, ' min')}; ` +
    `acordou ${f(a.feel, '/10')} → ${f(b.feel, '/10')}; ` +
    `hábitos feitos ${f(a.doneRate, '%')} → ${f(b.doneRate, '%')}; ` +
    `passos ${f(a.steps)} → ${f(b.steps)}`
  );
}

const ANALYSIS_PROMPT = `Você é um coach de saúde comportamental, rigoroso e direto, ajudando uma pessoa a melhorar sono, saúde física e mental a partir dos próprios dados. Abaixo estão os registros que o app dela (Askeo) coletou no período: noites de sono (horário-alvo, horário real, como acordou e o que escreveu), hábitos diários (feito / não fez / sem resposta, por onde respondeu, em qual cobrança, com que atraso e o motivo), dados do relógio quando disponíveis, experimentos em andamento e o que já se sabe sobre as causas.

Faça, nesta ordem:
1. Padrões: o que se repete (dias da semana, sequências, gatilhos que aparecem nas falas dela).
2. Correlações prováveis entre sono, hábitos e como ela acorda — diga o que é sugestivo e o que é só coincidência com esta quantidade de dados.
3. Qualidade da coleta: onde faltam respostas e o que isso impede de concluir.
4. Até 3 intervenções TESTÁVEIS, cada uma com: o que mudar, por quantos dias, qual número deve mudar e quanto. Prefira mudanças pequenas e específicas.
5. Se houver experimentos em andamento, avalie-os com o "antes → durante" fornecido.

Use as falas dela quando forem relevantes, citando literalmente. Não moralize. Termine perguntando o que ela topa testar.`;

function md(c: Collected): string {
  const { fromISO, toISO, config, days, summary: s, experiments, techniques, states, chat, interview, followups, decisions, automaticity } = c;
  const out: string[] = [];
  out.push(`# Askeo — exportação de sinais (${days.length} dias: ${fromISO} → ${toISO})`);
  out.push('');
  out.push('## Instruções para a IA (cole junto com os dados)');
  out.push('');
  out.push(ANALYSIS_PROMPT);
  out.push('');
  out.push('## Perfil');
  out.push('');
  out.push(`- Nome: ${config.name?.trim() || '(não informado)'}`);
  out.push(`- Horário-alvo de dormir: ${config.bedtime}`);
  out.push(`- Tom escolhido para a coruja: ${config.tone}`);
  out.push('- Relógio: Huawei — os dados de passos/sono/FC chegam pelo Health Connect apenas quando o Huawei Health está sincronizando com ele; dias sem esses campos = sem sincronização, não sem atividade.');
  out.push('');
  out.push('## Resumo do período');
  out.push('');
  out.push(`- Noites registradas: ${s.nights}${s.nights ? ` (${s.nightsOnTime} no horário, tolerância 15 min)` : ''}`);
  out.push(`- Atraso médio ao deitar: ${s.avgLateMin === null ? '—' : fmtLate(Math.round(s.avgLateMin))}`);
  out.push(`- Como acordou (média 0–10): ${s.avgMorningFeeling ?? '—'}`);
  out.push(`- Sono pelo relógio (média): ${s.avgSleepMinutes === null ? '—' : fmtMinutes(s.avgSleepMinutes)}`);
  out.push(`- Passos (média dos dias com dado): ${s.avgSteps ?? '—'}`);
  out.push(`- Dias com registro completo: ${s.completeDays} de ${s.totalDays} (taxa de resposta ${s.totalDays ? Math.round((s.completeDays / s.totalDays) * 100) : 0}%)`);
  if (s.habitRates.length) {
    out.push('');
    out.push('| Hábito | feito | não fez | sem resposta |');
    out.push('|---|---:|---:|---:|');
    for (const h of s.habitRates) out.push(`| ${h.title} | ${h.done} | ${h.notDone} | ${h.noAnswer} |`);
  }
  out.push('');
  if (experiments.length) {
    out.push('## Experimentos (intervenções)');
    out.push('');
    for (const e of experiments) {
      out.push(`- **${e.name}** (${e.startDate} → ${e.endDate ?? 'em andamento'})${e.hypothesis ? ` — hipótese: ${e.hypothesis}` : ''}`);
      out.push(`  - ${experimentComparison(e, days)}`);
    }
    out.push('');
  }
  const rated = techniques.filter((t) => t.shown >= 3);
  if (rated.length) {
    out.push('## Técnicas de persuasão (o que precede um "feito")');
    out.push('');
    out.push('| técnica | mostrada | converteu | taxa |');
    out.push('|---|---:|---:|---:|');
    for (const t of rated.sort((a, b) => b.converted / b.shown - a.converted / a.shown)) {
      out.push(`| ${t.technique} | ${t.shown} | ${t.converted} | ${Math.round((t.converted / t.shown) * 100)}% |`);
    }
    out.push('');
  }
  if (automaticity.length) {
    out.push('## Automaticidade ("faço sem pensar", 1–7, autoavaliação semanal)');
    out.push('');
    const byKey = new Map<string, { date: string; score: number }[]>();
    for (const a of automaticity) {
      if (!byKey.has(a.key)) byKey.set(a.key, []);
      byKey.get(a.key)!.push({ date: a.date, score: a.score });
    }
    for (const [key, list] of byKey) {
      out.push(`- ${c.titles.get(key) ?? key}: ${list.map((x) => `${x.score} (${x.date.slice(5)})`).join(' → ')}`);
    }
    out.push('');
  }
  if (decisions.length) {
    out.push('## Decisões da coruja (o que ela mandou, pulou ou cancelou)');
    out.push('');
    const agg = new Map<string, Record<string, number>>();
    for (const d of decisions) {
      const k = d.kind === 'insistence' ? `cobrança ${d.k}` : d.kind === 'anchor' ? 'âncora' : d.kind;
      const row = agg.get(k) ?? {};
      row[d.action] = (row[d.action] ?? 0) + 1;
      agg.set(k, row);
    }
    out.push('| tipo | enviada | pulada | cancelada (já respondido) | bloqueada |');
    out.push('|---|---:|---:|---:|---:|');
    const order = (x: string) => (x === 'âncora' ? 0 : x.startsWith('cobrança') ? parseInt(x.split(' ')[1], 10) : 99);
    for (const [k, r] of [...agg.entries()].sort((a, b) => order(a[0]) - order(b[0]))) {
      out.push(`| ${k} | ${r.send ?? 0} | ${r.skip ?? 0} | ${r.cancelled ?? 0} | ${r.blocked ?? 0} |`);
    }
    out.push('');
    out.push('("pulada" inclui batidas sorteadas para NÃO tocar — comparar os dias com e sem ela estima o efeito da cobrança.)');
    out.push('');
  }
  const formed = states.filter((st) => st.state !== 'forming');
  if (formed.length) {
    out.push('## Hábitos já consolidados (a coruja parou de cobrar)');
    out.push('');
    for (const st of formed) out.push(`- ${c.titles.get(st.nudgeType) ?? st.nudgeType} — desde ${st.formedAt ?? '?'}`);
    out.push('');
  }
  out.push('## Dia a dia');
  out.push('');
  for (const d of days) {
    const hasAnything = d.sleep || d.health || d.habits.some((h) => h.status !== '—') || d.feedback.length || d.practices.length;
    if (!hasAnything) continue;
    out.push(`### ${d.date} (${d.weekday})${d.experiments.length ? ` · experimento: ${d.experiments.join(', ')}` : ''}`);
    if (d.sleep) {
      const parts = [`alvo ${d.sleep.target}`];
      if (d.sleep.actual) parts.push(`deitou ${d.sleep.actual}${d.sleep.lateMin !== null && d.sleep.lateMin > 0 ? ` (+${fmtLate(d.sleep.lateMin)})` : d.sleep.lateMin !== null ? ' (no horário)' : ''}`);
      else parts.push('não marcou que dormiu');
      if (d.sleep.remindersSent) parts.push(`${d.sleep.remindersSent} lembretes`);
      out.push(`- sono: ${parts.join(' · ')}`);
      if (d.sleep.morningFeeling !== null || d.sleep.notes) {
        const m = [];
        if (d.sleep.morningFeeling !== null) m.push(`${d.sleep.morningFeeling}/10`);
        if (d.sleep.notes) m.push(`"${d.sleep.notes.replace(/\s+/g, ' ').trim()}"`);
        out.push(`- manhã: ${m.join(' — ')}`);
      }
    }
    if (d.health) {
      const h = d.health;
      const parts: string[] = [];
      if (h.sleepMinutes) parts.push(`relógio: ${hhmmOf(h.sleepStart) ?? '?'}–${hhmmOf(h.sleepEnd) ?? '?'} (${fmtMinutes(h.sleepMinutes)})`);
      if (typeof h.steps === 'number') parts.push(`passos ${h.steps}`);
      if (typeof h.exerciseMinutes === 'number' && h.exerciseMinutes > 0) parts.push(`exercício ${h.exerciseMinutes} min`);
      if (typeof h.restingHr === 'number') parts.push(`FC repouso ${h.restingHr}`);
      if (typeof h.weightKg === 'number') parts.push(`peso ${h.weightKg} kg`);
      if (parts.length) out.push(`- saúde: ${parts.join(' · ')}`);
    }
    const hs = d.habits.filter((h) => h.status !== '—');
    if (hs.length) {
      out.push(
        `- hábitos: ${hs
          .map((h) => {
            const mark = h.status === 'feito' ? '✅' : h.status === 'não fez' ? '❌' : '❔';
            const meta: string[] = [];
            if (h.evidence) meta.push(`automático: ${h.evidence}`);
            else if (h.k) meta.push(`${h.k}ª cobrança`);
            else if (h.via && h.via !== 'auto') meta.push(h.via === 'home' ? 'pela Home' : h.via);
            if (h.latencyMin !== null && h.latencyMin > 0) meta.push(`+${h.latencyMin} min`);
            else if (h.latencyMin !== null && h.latencyMin < 0 && h.status === 'feito') meta.push(`${-h.latencyMin} min ANTES do horário`);
            else if (h.latencyMin !== null && h.latencyMin < 0) meta.push(`avisou ${-h.latencyMin} min antes do horário`);
            if (h.autoUndone) meta.push('confirmação automática desfeita pela pessoa');
            if (h.reason) meta.push(`"${h.reason}"`);
            return `${h.title} ${mark}${meta.length ? ` (${meta.join(', ')})` : ''}`;
          })
          .join(' · ')}`,
      );
    }
    if (d.practices.length) {
      out.push(
        `- práticas no app: ${d.practices
          .map((p) => `${p.kind} ${p.minutes} min às ${p.at}${p.completed ? ' (completa)' : ' (interrompida)'}`)
          .join(' · ')}`,
      );
    }
    for (const f of d.feedback) out.push(`- disse ao adiar/responder: "${f}"`);
    out.push('');
  }
  if (interview?.summary) {
    out.push('## Entrevista inicial (causas e gatilhos)');
    out.push('');
    if (interview.summary.causes?.length) out.push(`- Causas: ${interview.summary.causes.join('; ')}`);
    if (interview.summary.triggers?.length) out.push(`- Gatilhos: ${interview.summary.triggers.join('; ')}`);
    if (interview.summary.notes) out.push(`- Notas: ${interview.summary.notes}`);
    if (followups.length) {
      out.push('- Atualizações posteriores:');
      for (const f of followups) out.push(`  - ${f.date}: "${f.text}"`);
    }
    out.push('');
  }
  if (chat.length) {
    out.push('## Conversas com a coruja no período');
    out.push('');
    for (const m of chat) {
      const who = m.role === 'user' ? 'pessoa' : 'coruja';
      out.push(`- ${m.createdAt.slice(0, 16)} · ${who}: ${m.content.replace(/\s+/g, ' ').trim()}`);
    }
    out.push('');
  }
  out.push('## Legenda');
  out.push('');
  out.push('- ✅ feito · ❌ não fez (a pessoa disse) · ❔ sem resposta (ninguém respondeu; NÃO é "não fez")');
  out.push('- "Nª cobrança": em qual insistência a resposta veio; "+X min": atraso em relação ao horário programado; "X min ANTES do horário": feito antes de a coruja chamar (sinal de hábito automático)');
  out.push('- "automático: …": o app confirmou sozinho por evidência (treino gravado no relógio, prática feita no app) — a pessoa não precisou responder');
  out.push('- "como acordou": nota 0–10 dada na manhã seguinte; texto entre aspas é literal da pessoa');
  out.push('');
  return out.join('\n');
}

function csv(c: Collected): string {
  const keys = c.days[0]?.habits.map((h) => h.key) ?? [];
  const head = ['data', 'dia', 'alvo', 'deitou', 'atraso_min', 'acordou_0_10', 'nota_manha', 'relogio_sono_min', 'passos', 'exercicio_min', 'fc_repouso', 'peso_kg', 'praticas_min', 'experimentos', ...keys.map((k) => c.titles.get(k) ?? k)];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [head.map(esc).join(',')];
  for (const d of c.days) {
    rows.push(
      [
        d.date,
        d.weekday,
        d.sleep?.target ?? '',
        d.sleep?.actual ?? '',
        d.sleep?.lateMin ?? '',
        d.sleep?.morningFeeling ?? '',
        d.sleep?.notes ?? '',
        d.health?.sleepMinutes ?? '',
        d.health?.steps ?? '',
        d.health?.exerciseMinutes ?? '',
        d.health?.restingHr ?? '',
        d.health?.weightKg ?? '',
        d.practices.length ? d.practices.reduce((a, p) => a + p.minutes, 0) : '',
        d.experiments.join('; '),
        ...d.habits.map((h) => (h.status === '—' ? '' : h.status)),
      ]
        .map(esc)
        .join(','),
    );
  }
  return rows.join('\n');
}

export async function buildExport(opts: ExportOptions): Promise<{ markdown: string; csv: string; json: string }> {
  const c = await collect(opts);
  const json = JSON.stringify(
    {
      period: { from: c.fromISO, to: c.toISO, days: opts.days },
      profile: { name: c.config.name, bedtime: c.config.bedtime, tone: c.config.tone },
      summary: c.summary,
      experiments: c.experiments,
      techniques: c.techniques,
      habitStates: c.states,
      days: c.days,
      automaticity: c.automaticity,
      decisionPoints: c.decisions,
      interview: c.interview?.summary ?? null,
      interviewFollowups: c.followups,
      chat: c.chat,
    },
    null,
    2,
  );
  return { markdown: md(c), csv: csv(c), json };
}

export async function copyMarkdownToClipboard(opts: ExportOptions): Promise<{ ok: boolean; chars: number; error?: string }> {
  try {
    const { markdown } = await buildExport(opts);
    await Clipboard.setStringAsync(markdown);
    return { ok: true, chars: markdown.length };
  } catch (e) {
    return { ok: false, chars: 0, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}

export async function shareExport(formatKind: ExportFormat, opts: ExportOptions): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: 'Compartilhamento não disponível neste aparelho.' };
    const built = await buildExport(opts);
    const content = formatKind === 'md' ? built.markdown : formatKind === 'csv' ? built.csv : built.json;
    const mime = formatKind === 'md' ? 'text/markdown' : formatKind === 'csv' ? 'text/csv' : 'application/json';
    const dest = `${FileSystem.cacheDirectory}askeo-sinais_${iso(new Date())}_${opts.days}d.${formatKind}`;
    await FileSystem.writeAsStringAsync(dest, content, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(dest, { mimeType: mime, dialogTitle: 'Exportar sinais do Askeo' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}
