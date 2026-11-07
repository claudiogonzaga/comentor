// A geometria da pintura, sem React: o ensō a pincel e as fibras do washi viram
// caminhos SVG prontos (strings), que Enso.tsx e arte.tsx só desenham.
//
// O ensō é um traço só, do topo, no sentido horário. A largura vem de um perfil
// de pressão (o pincel pousa pesado, corre, se afina e termina seco); as bordas
// têm um tremor leve, diferente por fora e por dentro; no fim, o pincel se
// recolhe um pouco para dentro e deixa a abertura. Pintar uma fração `frac` é
// pintar o mesmo traço até ali: o ensō cresce como cresceria na mão.

/** Quanto do círculo o traço percorre: o resto é a abertura. */
const VARREDURA = 2 * Math.PI * (333 / 360);
/** Começa logo depois do topo (o ângulo cresce no sentido horário na tela). */
const ANGULO_INICIAL = -Math.PI / 2 + 0.07;

function suave(a: number, b: number, t: number): number {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** Raio relativo: a mão respira e, no fim, o traço entra um pouco. */
function raioRel(t: number): number {
  return (
    1 +
    0.014 * Math.sin(2 * Math.PI * t + 0.8) +
    0.009 * Math.sin(2 * Math.PI * 2.3 * t + 2.0) -
    0.035 * suave(0.8, 1, t)
  );
}

/** Pressão do pincel ao longo do traço (1 = largura cheia). */
function pressao(t: number): number {
  const pouso = 0.8 + 0.3 * Math.exp(-(((t - 0.025) / 0.035) ** 2));
  const corpo = 1 - 0.36 * t ** 1.3 + 0.05 * Math.sin(2 * Math.PI * 2.7 * t + 0.4);
  const cauda = 1 - 0.74 * suave(0.84, 1, t);
  return pouso * corpo * cauda;
}

/** Tremor das bordas, mais áspero no fim, quando a tinta acaba. */
function tremor(t: number, lado: 0 | 1): number {
  const amp = 0.05 + 0.13 * suave(0.68, 1, t);
  const n =
    lado === 0
      ? 0.6 * Math.sin(37 * t + 1) + 0.4 * Math.sin(83 * t + 2)
      : 0.6 * Math.sin(41 * t + 3) + 0.4 * Math.sin(71 * t + 0.5);
  return 1 + amp * n;
}

interface Amostra {
  x: number;
  y: number;
  /** Normal para fora (unitária) e tangente (unitária). */
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  h: number; // meia largura
  t: number;
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();

function amostras(size: number, t0: number, t1: number, passo: number): Amostra[] {
  const c = size / 2;
  const R = size * 0.385;
  const W = size * 0.078;
  const n = Math.max(2, Math.ceil((t1 - t0) / passo) + 1);
  const pts: Amostra[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    const a = ANGULO_INICIAL + t * VARREDURA;
    const r = R * raioRel(t);
    // Derivada numérica: a normal acompanha a curva de verdade, não o círculo ideal.
    const e = 1e-3;
    const a2 = ANGULO_INICIAL + (t + e) * VARREDURA;
    const r2 = R * raioRel(t + e);
    const x = c + r * Math.cos(a);
    const y = c + r * Math.sin(a);
    const dx = c + r2 * Math.cos(a2) - x;
    const dy = c + r2 * Math.sin(a2) - y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    // Sentido horário na tela (y para baixo): a normal para fora é (ty, -tx).
    pts.push({ x, y, tx, ty, nx: ty, ny: -tx, h: (W / 2) * pressao(t), t });
  }
  return pts;
}

/**
 * Contorno fechado de um trecho do traço. `escala` dá a fração da largura em cada
 * ponto; a ponta de trás é redonda, a da frente só quando `frente` (o traço
 * termina ali, e não emenda nos fios).
 */
function contorno(pts: Amostra[], escala: (t: number) => number, desloc = 0, frente = true): string {
  if (pts.length < 2) return '';
  const fora = pts.map((p) => {
    const h = p.h * escala(p.t) * tremor(p.t, 0);
    return [p.x + p.nx * (h + desloc), p.y + p.ny * (h + desloc)];
  });
  const dentro = pts.map((p) => {
    const h = p.h * escala(p.t) * tremor(p.t, 1);
    return [p.x - p.nx * (h - desloc), p.y - p.ny * (h - desloc)];
  });
  const ponta = (p: Amostra, h: number, adiante: boolean) => {
    const out: number[][] = [];
    const s = adiante ? 1 : -1;
    for (let k = 1; k < 8; k += 1) {
      const phi = (Math.PI * k) / 8;
      out.push([
        p.x + s * h * (p.nx * Math.cos(phi) + p.tx * Math.sin(phi)),
        p.y + s * h * (p.ny * Math.cos(phi) + p.ty * Math.sin(phi)),
      ]);
    }
    return out;
  };
  const ult = pts[pts.length - 1];
  const pri = pts[0];
  const seq = [
    ...fora,
    ...(frente ? ponta(ult, ult.h * escala(ult.t), true) : []),
    ...dentro.slice().reverse(),
    ...ponta(pri, pri.h * escala(pri.t), false),
  ];
  return `M${seq.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/** Daqui em diante o pincel começa a secar e o traço se abre em fios (kasure). */
const SECA = 0.6;

/**
 * As cerdas: faixas da largura do traço (-1 = borda de dentro, 1 = de fora). Cada
 * uma se afasta das vizinhas no seu ritmo (abre), algumas acabam antes (a tinta
 * acabou), o tom vai clareando (o cinza dos fios secos) e, com o traço ainda em
 * curso, as pontas não chegam juntas (atraso, em amostras): a frente é de pincel.
 */
const FIOS = [
  { de: -1, ate: -0.6, abre: 1.0, acaba: 0.986, tom: 0.8, atraso: 0 },
  { de: -0.6, ate: -0.22, abre: 0.75, acaba: 1.01, tom: 0.9, atraso: 1 },
  { de: -0.22, ate: 0.14, abre: 1.25, acaba: 0.955, tom: 0.74, atraso: 0 },
  { de: 0.14, ate: 0.5, abre: 0.85, acaba: 1.01, tom: 0.88, atraso: 2 },
  { de: 0.5, ate: 1, abre: 1.1, acaba: 0.972, tom: 0.8, atraso: 1 },
];
/** O fio clareia aos poucos: três trechos, do quase cheio ao tom seco. */
const TRECHOS = [SECA, 0.7, 0.83, 1.01];
const CLAREIA = [0.3, 0.68, 1];

type Pt = number[];

function bordasDoFio(p: Amostra, fio: (typeof FIOS)[number]): [Pt, Pt] {
  const vao = 0.2 * fio.abre * suave(SECA, 1, p.t);
  let lo = fio.de + (fio.de > -1 ? vao / 2 : 0);
  let hi = fio.ate - (fio.ate < 1 ? vao / 2 : 0);
  // Perto do fim do fio, ele se afina até o meio: a cerda solta o papel.
  const fecho = suave(fio.acaba - 0.07, fio.acaba, p.t);
  const meio = (lo + hi) / 2;
  lo += (meio - lo) * fecho;
  hi -= (hi - meio) * fecho;
  const borda = (o: number): Pt => {
    const h = p.h * o * tremor(p.t, o > 0 ? 0 : 1);
    return [p.x + p.nx * h, p.y + p.ny * h];
  };
  return [borda(lo), borda(hi)];
}

/** Faixa entre duas bordas; com `ponta`, a frente arredondada de uma cerda. */
function faixa(a: Pt[], b: Pt[], ponta: Amostra | null): string {
  if (a.length < 2) return '';
  const tampa: Pt[] = [];
  if (ponta) {
    const pa = a[a.length - 1];
    const pb = b[b.length - 1];
    const mx = (pa[0] + pb[0]) / 2;
    const my = (pa[1] + pb[1]) / 2;
    const r = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) / 2;
    if (r > 0.05) {
      const ux = (pa[0] - mx) / r;
      const uy = (pa[1] - my) / r;
      for (let k = 1; k < 6; k += 1) {
        const phi = (Math.PI * k) / 6;
        tampa.push([mx + r * (ux * Math.cos(phi) + ponta.tx * Math.sin(phi)), my + r * (uy * Math.cos(phi) + ponta.ty * Math.sin(phi))]);
      }
    }
  }
  const seq = [...a, ...tampa, ...b.slice().reverse()];
  return `M${seq.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}

/** Os trechos de um fio, até a frente do traço (`fim`). */
function fio(pts: Amostra[], x: (typeof FIOS)[number], fim: number): { d: string; tom: number }[] {
  let vivos = pts.filter((p) => p.t <= x.acaba);
  const emCurso = fim < x.acaba;
  if (emCurso && x.atraso) vivos = vivos.slice(0, Math.max(0, vivos.length - x.atraso));
  if (vivos.length < 2) return [];
  const out: { d: string; tom: number }[] = [];
  for (let k = 0; k < 3; k += 1) {
    const de = vivos.findIndex((p) => p.t >= TRECHOS[k]);
    if (de < 0) break;
    let ate = vivos.findIndex((p) => p.t >= TRECHOS[k + 1]);
    const ultimo = ate < 0;
    // Cada trecho invade uma amostra do seguinte: as cores são opacas, a emenda some.
    ate = ultimo ? vivos.length : Math.min(vivos.length, ate + 1);
    const trecho = vivos.slice(Math.max(0, de - (k ? 1 : 0)), ate);
    const bordas = trecho.map((p) => bordasDoFio(p, x));
    const d = faixa(
      bordas.map((e) => e[0]),
      bordas.map((e) => e[1]),
      ultimo && emCurso ? trecho[trecho.length - 1] : null,
    );
    if (d) out.push({ d, tom: 1 - (1 - x.tom) * CLAREIA[k] });
    if (ultimo) break;
  }
  return out;
}

export interface EnsoCaminhos {
  /** A tinta que se espalha no papel em volta: duas bordas de lavado, bem fracas. */
  lavados: string[];
  /** O corpo do traço, até o pincel começar a secar. */
  corpo: string;
  /** O miolo carregado do começo, em dois degraus (largo e estreito): o pincel pousou ali com tinta cheia. */
  nucleos: [string, string] | null;
  /** Os fios do fim (kasure), cada um com seu tom (1 = tinta cheia). */
  fios: { d: string; tom: number }[];
}

const VAZIO: EnsoCaminhos = { lavados: [], corpo: '', nucleos: null, fios: [] };

/** O ensō pintado até `frac` (0 a 1) numa caixa quadrada de `size` pontos. */
export function ensoCaminhos(size: number, frac: number): EnsoCaminhos {
  const fim = Math.max(0, Math.min(1, frac));
  if (fim <= 0.002) return VAZIO;
  const passo = 1 / 240;
  const pts = amostras(size, 0, fim, passo);
  // O corpo passa um pouco por baixo do começo dos fios: a emenda não aparece.
  const molhado = fim <= SECA ? pts : amostras(size, 0, Math.min(fim, SECA + 2 * passo), passo);
  const seco = fim > SECA ? amostras(size, SECA, fim, passo) : [];
  const frente = fim <= SECA;
  const miolo = amostras(size, 0, Math.min(fim, 0.42), passo);
  return {
    lavados: [
      contorno(pts, () => 1.42, size * 0.004, frente),
      contorno(pts, () => 1.18, size * 0.003, frente),
    ],
    corpo: contorno(molhado, () => 1, 0, frente),
    nucleos: [
      contorno(miolo, (t) => 0.72 * (1 - suave(0.1, 0.42, t)) + 0.04),
      contorno(miolo, (t) => 0.4 * (1 - suave(0.08, 0.36, t)) + 0.03),
    ],
    fios: seco.length ? FIOS.flatMap((x) => fio(seco, x, fim)) : [],
  };
}

/** Mistura duas cores #RRGGBB: k = 0 dá `a`, k = 1 dá `b`. */
export function misturar(a: string, b: string, k: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const canal = (sh: number) => {
    const x = (ca >> sh) & 255;
    const y = (cb >> sh) & 255;
    return Math.round(x + (y - x) * k);
  };
  return `#${((canal(16) << 16) | (canal(8) << 8) | canal(0)).toString(16).padStart(6, '0')}`;
}

/** Onde o pincel pousa (o ponto de tinta da preparação) e o tamanho da gota. */
export function pousoDoPincel(size: number): { x: number; y: number; r: number } {
  const [p] = amostras(size, 0, 0.001, 1);
  return { x: p.x, y: p.y, r: p.h * 0.95 };
}

/** Uma gota de tinta, redonda mas não perfeita. */
export function gota(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 18; i += 1) {
    const a = (2 * Math.PI * i) / 18;
    const rr = r * (1 + 0.07 * Math.sin(3 * a + 1) + 0.05 * Math.sin(5 * a + 2));
    pts.push(`${f(cx + rr * Math.cos(a))} ${f(cy + rr * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}

// ---- o papel ----

/** Gerador determinístico: o papel é o mesmo a cada abertura. */
function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Fibra {
  d: string;
  largura: number;
  opacidade: number;
  /** true = fibra clara (mais clara que o papel); false = escura (da cor da tinta). */
  clara: boolean;
}

export interface Mancha {
  cx: number;
  cy: number;
  r: number;
  opacidade: number;
}

/** As fibras de kozo e as nuvens do washi numa área w×h. Quase invisíveis, de propósito. */
export function papel(w: number, h: number, semente = 7): { fibras: Fibra[]; manchas: Mancha[] } {
  const rnd = aleatorio(semente);
  const fibras: Fibra[] = [];
  const total = Math.round((w * h) / 7000);
  for (let i = 0; i < total; i += 1) {
    const x = rnd() * w;
    const y = rnd() * h;
    const ang = rnd() * Math.PI;
    const len = 8 + rnd() * 34;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    const curva = (rnd() - 0.5) * len * 0.5;
    const cx = (x + x2) / 2 - Math.sin(ang) * curva;
    const cy = (y + y2) / 2 + Math.cos(ang) * curva;
    const clara = rnd() < 0.5;
    fibras.push({
      d: `M${f(x)} ${f(y)}Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`,
      largura: 0.35 + rnd() * 0.6,
      opacidade: clara ? 0.2 + rnd() * 0.18 : 0.025 + rnd() * 0.03,
      clara,
    });
  }
  const manchas: Mancha[] = [];
  for (let i = 0; i < 6; i += 1) {
    manchas.push({
      cx: rnd() * w,
      cy: rnd() * h,
      r: 70 + rnd() * 130,
      opacidade: 0.018 + rnd() * 0.02,
    });
  }
  return { fibras, manchas };
}

// ---- o selo ----

/** Um quadrado de selo (hanko) com a borda gasta. */
export function quadradoDoSelo(s: number, semente = 3): string {
  const rnd = aleatorio(semente);
  const pts: string[] = [];
  const m = s * 0.035;
  const lado = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < 6; i += 1) {
      const k = i / 6;
      pts.push(`${f(x0 + (x1 - x0) * k + (rnd() - 0.5) * m)} ${f(y0 + (y1 - y0) * k + (rnd() - 0.5) * m)}`);
    }
  };
  lado(0, 0, s, 0);
  lado(s, 0, s, s);
  lado(s, s, 0, s);
  lado(0, s, 0, 0);
  return `M${pts.join('L')}Z`;
}

/** Pontinhos onde o selo não pegou tinta. */
export function falhasDoSelo(s: number, semente = 11): { cx: number; cy: number; r: number }[] {
  const rnd = aleatorio(semente);
  return Array.from({ length: 9 }, () => ({
    cx: s * (0.06 + rnd() * 0.88),
    cy: s * (0.06 + rnd() * 0.88),
    r: s * (0.006 + rnd() * 0.014),
  }));
}
