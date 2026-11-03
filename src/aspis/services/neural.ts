// A rede neural local de recomendação do Aspis.
//
// Cada 👍/👎 é um exemplo de treino. A rede aprende, aqui no aparelho e sem nuvem,
// o que você considera alinhado, e a previsão dela entra na nota de alinhamento ao
// lado da nota da IA: com poucas marcações pesa pouco, com muitas pesa mais.
//
// A arquitetura é pequena de propósito, para treinar em milissegundos no JS:
//   palavras do título, canal e pilar → hashing em 4096 baldes → embedding de 16
//   dimensões (média) + 4 números → camada oculta de 24 (tanh) → uma saída (sigmoide).
// Treina com Adagrad, que lida bem com entradas esparsas. O Mac tem a mesma rede em
// neural.py e as marcações passam pela sincronização: os dois aprendem com as duas.

import { File, Paths } from 'expo-file-system';

import * as db from './db';
import { scoreToStars } from '../constants/defaults';
import type { ThumbRecord, VideoRecord } from '../types';

const BUCKETS = 4096;
const EMB = 16;
const NUM = 4;
const INPUT = EMB + NUM;
const HIDDEN = 24;
const MAX_TOKENS = 48;

const OFF_W1 = BUCKETS * EMB;
const OFF_B1 = OFF_W1 + INPUT * HIDDEN;
const OFF_W2 = OFF_B1 + HIDDEN;
const OFF_B2 = OFF_W2 + HIDDEN;
const PARAMS = OFF_B2 + 1;

const LEARNING_RATE = 0.08;
const L2 = 1e-4;

/** Abaixo disto a rede ainda não sabe nada de você: a nota é só a da IA. */
const MIN_LABELS = 5;
/** Com esta quantidade de marcações ela chega ao peso máximo. */
const FULL_LABELS = 100;
const MAX_WEIGHT = 0.6;

/** Replay: junto de cada marcação nova, revê algumas antigas para não esquecê-las. */
const REPLAY = 32;
const CONSOLIDATE_EVERY = 10;
const CONSOLIDATE_EPOCHS = 6;
const CHUNK = 40;
const HITS_WINDOW = 50;
const MAGIC = 0x4b4e4e31; // arquivo da rede, versão 1

const STOPWORDS = new Set(
  (
    'que com para por uma uns umas dos das nos nas num numa como mais mas foi ser sao tem sua seu suas seus ' +
    'esse essa isso este esta isto voce voces ele ela eles elas nao sim the and for with from this that you your ' +
    'are was were how why what when who will can not but about into have has had its their'
  ).split(' '),
);

function emptyWeights(): Float32Array {
  // Semente fixa: a mesma rede nasce igual a cada zeramento.
  const w = new Float32Array(PARAMS);
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296 - 0.5;
  };
  for (let i = 0; i < OFF_W1; i += 1) w[i] = rand() * 0.02;
  for (let i = OFF_W1; i < OFF_B1; i += 1) w[i] = rand() * 0.4;
  for (let i = OFF_W2; i < OFF_B2; i += 1) w[i] = rand() * 0.4;
  return w;
}

let weights: Float32Array = emptyWeights();
let accum: Float32Array = new Float32Array(PARAMS);
let labelCount = 0;
let sinceConsolidate = 0;
let hits: number[] = [];
let loaded = false;
let consolidating = false;

// Vetores de trabalho, reaproveitados: o treino não pode gerar lixo a cada passo.
const xVec = new Float32Array(INPUT);
const hVec = new Float32Array(HIDDEN);
const gHidden = new Float32Array(HIDDEN);
const gInput = new Float32Array(INPUT);

function modelFile(): File {
  return new File(Paths.document, 'aspis-rede.bin');
}

function hashBucket(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % BUCKETS;
}

function words(text: string | null | undefined): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** O que a rede enxerga de um vídeo. */
interface Sample {
  tokens: number[];
  numeric: [number, number, number, number];
}

function durationMinutes(text: string | null | undefined): number {
  if (!text) return 0;
  const h = /(\d+)\s*h/.exec(text);
  const m = /(\d+)\s*min/.exec(text);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

function toSample(v: {
  neutral_title?: string | null;
  original_title?: string | null;
  channel?: string | null;
  channel_id?: string | null;
  pillar?: string | null;
  resumo?: string | null;
  score?: number | null;
  is_clickbait?: number | boolean | null;
  duration?: string | null;
}): Sample {
  const title = words(v.neutral_title);
  const original = words(v.original_title);
  const seen = new Set<string>();
  const add = (token: string) => {
    if (seen.size < MAX_TOKENS) seen.add(token);
  };
  if (v.channel_id || v.channel) add(`c:${v.channel_id || v.channel}`);
  if (v.pillar) add(`p:${v.pillar}`);
  title.forEach((w) => add(`t:${w}`));
  for (let i = 0; i + 1 < title.length; i += 1) add(`b:${title[i]}_${title[i + 1]}`);
  original.forEach((w) => add(`t:${w}`));
  words(v.resumo).slice(0, 20).forEach((w) => add(`r:${w}`));
  const score = Math.max(0, Math.min(100, Number(v.score) || 0)) / 100;
  return {
    tokens: Array.from(seen, hashBucket),
    numeric: [
      score,
      v.is_clickbait ? 1 : 0,
      Math.min(1, Math.log1p(durationMinutes(v.duration)) / 5),
      1,
    ],
  };
}

/** Passa pela rede; deixa em xVec e hVec o que a retropropagação vai precisar. */
function forward(s: Sample): number {
  xVec.fill(0);
  const n = s.tokens.length || 1;
  for (const t of s.tokens) {
    const base = t * EMB;
    for (let i = 0; i < EMB; i += 1) xVec[i] += weights[base + i] / n;
  }
  for (let i = 0; i < NUM; i += 1) xVec[EMB + i] = s.numeric[i];
  let y = weights[OFF_B2];
  for (let j = 0; j < HIDDEN; j += 1) {
    let sum = weights[OFF_B1 + j];
    const row = OFF_W1 + j * INPUT;
    for (let i = 0; i < INPUT; i += 1) sum += weights[row + i] * xVec[i];
    const h = Math.tanh(sum);
    hVec[j] = h;
    y += weights[OFF_W2 + j] * h;
  }
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, y))));
}

function adagrad(index: number, gradient: number): void {
  const g = gradient + L2 * weights[index];
  accum[index] += g * g;
  weights[index] -= (LEARNING_RATE * g) / Math.sqrt(accum[index] + 1e-8);
}

/** Um passo de treino: `target` é 1 (👍) ou 0 (👎). */
function trainStep(s: Sample, target: number, importance = 1): void {
  const p = forward(s);
  const e = (p - target) * importance;
  gInput.fill(0);
  adagrad(OFF_B2, e);
  for (let j = 0; j < HIDDEN; j += 1) {
    const h = hVec[j];
    const wOut = weights[OFF_W2 + j];
    gHidden[j] = e * wOut * (1 - h * h);
    adagrad(OFF_W2 + j, e * h);
    adagrad(OFF_B1 + j, gHidden[j]);
    const row = OFF_W1 + j * INPUT;
    for (let i = 0; i < INPUT; i += 1) {
      gInput[i] += gHidden[j] * weights[row + i];
      adagrad(row + i, gHidden[j] * xVec[i]);
    }
  }
  const n = s.tokens.length || 1;
  for (const t of s.tokens) {
    const base = t * EMB;
    for (let i = 0; i < EMB; i += 1) adagrad(base + i, gInput[i] / n);
  }
}

function saveModel(): void {
  try {
    const header = new Int32Array([MAGIC, PARAMS, labelCount, sinceConsolidate]);
    const hitBytes = new Int32Array([hits.length, ...hits]);
    const size =
      header.byteLength + hitBytes.byteLength + weights.byteLength + accum.byteLength;
    const out = new Uint8Array(size);
    let off = 0;
    for (const part of [header, hitBytes, weights, accum]) {
      out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), off);
      off += part.byteLength;
    }
    const file = modelFile();
    file.create({ overwrite: true });
    file.write(out);
  } catch (err) {
    console.warn('[neural] não salvou a rede:', err);
  }
}

function loadModel(): boolean {
  try {
    const file = modelFile();
    if (!file.exists) return false;
    const bytes = file.bytesSync ? file.bytesSync() : null;
    if (!bytes) return false;
    const copy = bytes.slice().buffer;
    const header = new Int32Array(copy, 0, 4);
    if (header[0] !== MAGIC || header[1] !== PARAMS) return false;
    labelCount = header[2];
    sinceConsolidate = header[3];
    const nHits = new Int32Array(copy, 16, 1)[0];
    hits = Array.from(new Int32Array(copy, 20, nHits));
    const start = 20 + nHits * 4;
    weights = new Float32Array(copy.slice(start, start + PARAMS * 4));
    accum = new Float32Array(copy.slice(start + PARAMS * 4, start + PARAMS * 8));
    return true;
  } catch (err) {
    console.warn('[neural] não leu a rede:', err);
    return false;
  }
}

/**
 * Todos os exemplos: as marcações explícitas e, com peso menor, o que você já
 * tinha pulado ou salvo antes de os polegares existirem.
 */
function allExamples(): { s: Sample; target: number; importance: number }[] {
  const out: { s: Sample; target: number; importance: number }[] = [];
  const seen = new Set<string>();
  for (const t of db.getThumbs()) {
    if (t.value !== 1 && t.value !== -1) continue;
    seen.add(t.neutral_title);
    out.push({ s: toSample(t), target: t.value === 1 ? 1 : 0, importance: 1 });
  }
  const { negatives, positives } = db.getFeedbackExamples(200);
  for (const v of negatives) {
    if (!seen.has(v.neutral_title)) out.push({ s: toSample(v), target: 0, importance: 0.5 });
  }
  for (const v of positives) {
    if (!seen.has(v.neutral_title)) out.push({ s: toSample(v), target: 1, importance: 0.5 });
  }
  return out;
}

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Revê tudo o que já foi marcado, em fatias, sem travar a tela. */
function consolidate(): void {
  if (consolidating) return;
  consolidating = true;
  const examples = allExamples();
  labelCount = db.getThumbs().filter((t) => t.value !== 0).length;
  weights = emptyWeights();
  accum = new Float32Array(PARAMS);
  const queue: { s: Sample; target: number; importance: number }[] = [];
  for (let epoch = 0; epoch < CONSOLIDATE_EPOCHS; epoch += 1) queue.push(...shuffle(examples.slice()));
  const run = () => {
    const end = Math.min(queue.length, CHUNK);
    for (let i = 0; i < end; i += 1) {
      const ex = queue.pop()!;
      trainStep(ex.s, ex.target, ex.importance);
    }
    if (queue.length > 0) {
      setTimeout(run, 0);
      return;
    }
    sinceConsolidate = 0;
    consolidating = false;
    saveModel();
  };
  setTimeout(run, 0);
}

/** Abre a rede guardada. Sem arquivo, ou com marcações novas pendentes, treina. */
export function initNeural(): void {
  if (loaded) return;
  loaded = true;
  const ok = loadModel();
  const labels = db.getThumbs().filter((t) => t.value !== 0).length;
  if (!ok || labels !== labelCount) consolidate();
}

/** A rede aprende com uma marcação nova, na hora. value: 1 👍, -1 👎, 0 desfez. */
export function learnThumb(video: VideoRecord, value: 1 | -1 | 0): void {
  initNeural();
  db.setThumb(video, value);
  if (value === 0) {
    labelCount = db.getThumbs().filter((t) => t.value !== 0).length;
    consolidate();
    return;
  }
  const sample = toSample(video);
  // Antes de aprender: ela teria acertado? É a medida honesta do que já sabe.
  if (labelCount >= MIN_LABELS) {
    const said = forward(sample) >= 0.5 ? 1 : -1;
    hits = [...hits, said === value ? 1 : 0].slice(-HITS_WINDOW);
  }
  labelCount = db.getThumbs().filter((t) => t.value !== 0).length;
  if (consolidating) return; // a passada em curso já vê esta marcação na próxima
  const target = value === 1 ? 1 : 0;
  for (let i = 0; i < 3; i += 1) trainStep(sample, target);
  const past = shuffle(allExamples()).slice(0, REPLAY);
  for (const ex of past) trainStep(ex.s, ex.target, ex.importance);
  sinceConsolidate += 1;
  saveModel();
  if (sinceConsolidate >= CONSOLIDATE_EVERY) consolidate();
}

/** Marcações que chegaram do outro aparelho: a rede revê tudo em segundo plano. */
export function thumbsChanged(): void {
  initNeural();
  consolidate();
}

/** O peso da rede na nota, conforme o quanto ela já foi treinada (0 a 0,6). */
export function neuralWeight(): number {
  if (labelCount < MIN_LABELS) return 0;
  return Math.min(MAX_WEIGHT, (MAX_WEIGHT * (labelCount - MIN_LABELS + 1)) / (FULL_LABELS - MIN_LABELS));
}

/** A nota de alinhamento: a da IA, ajustada pelo que a rede aprendeu de você. */
export function alignedScore(video: VideoRecord): number {
  const w = neuralWeight();
  if (w <= 0) return video.score;
  return Math.round(video.score * (1 - w) + forward(toSample(video)) * 100 * w);
}

export function alignedStars(video: VideoRecord): number {
  return scoreToStars(alignedScore(video));
}

export interface NeuralStats {
  labels: number;
  weightPct: number;
  /** Acertos entre as últimas marcações, antes de aprender com elas. */
  hits: number;
  total: number;
  training: boolean;
}

export function neuralStats(): NeuralStats {
  initNeural();
  return {
    labels: labelCount,
    weightPct: Math.round(neuralWeight() * 100),
    hits: hits.reduce((a, b) => a + b, 0),
    total: hits.length,
    training: consolidating,
  };
}

/** Esquece tudo o que a rede aprendeu. As marcações também saem. */
export function resetNeural(): void {
  db.clearThumbs();
  labelCount = 0;
  sinceConsolidate = 0;
  hits = [];
  weights = emptyWeights();
  accum = new Float32Array(PARAMS);
  try {
    const file = modelFile();
    if (file.exists) file.delete();
  } catch {
    /* some na próxima gravação */
  }
}

export type { ThumbRecord };
