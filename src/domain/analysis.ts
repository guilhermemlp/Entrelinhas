// Análise longitudinal. Funções puras, sem I/O, testáveis.
//
// Princípios:
//  - Todo resultado carrega n (quantos dias entraram no cálculo).
//  - Dias sem registro NÃO são zero: são ausentes (null) e excluídos.
//  - Correlações estão implementadas, mas só são exibidas quando
//    CORRELATIONS_ENABLED = true E há pelo menos MIN_PAIRS pares completos.

import { addDays } from './dates';

export const CORRELATIONS_ENABLED = false;
export const MIN_PAIRS = 30;

export interface DayRecord {
  date: string;                       // 'YYYY-MM-DD'
  status: 'draft' | 'complete' | null; // null = sem registro naquele dia
  scores: Record<string, number | null>;
  sleep_hours: number | null;
}

export function buildRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface Coverage {
  days: number;
  complete: number;
  draft: number;
  missing: number;
}

export function coverage(records: DayRecord[]): Coverage {
  let complete = 0, draft = 0, missing = 0;
  for (const r of records) {
    if (r.status === 'complete') complete++;
    else if (r.status === 'draft') draft++;
    else missing++;
  }
  return { days: records.length, complete, draft, missing };
}

// Série de um indicador: null onde não há registro ou não há valor.
export function series(records: DayRecord[], key: string): (number | null)[] {
  return records.map(r => (r.status ? (r.scores[key] ?? null) : null));
}

export function sleepSeries(records: DayRecord[]): (number | null)[] {
  return records.map(r => (r.status ? r.sleep_hours : null));
}

export interface Summary {
  n: number;
  mean: number | null;
  sd: number | null;      // desvio padrão amostral (n-1)
  min: number | null;
  max: number | null;
}

export function summarize(values: (number | null)[]): Summary {
  const xs = values.filter((v): v is number => v !== null);
  const n = xs.length;
  if (n === 0) return { n, mean: null, sd: null, min: null, max: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1
    ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1))
    : null;
  return { n, mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

// Inclinação por mínimos quadrados (unidades do indicador por dia).
// Ignora ausências em vez de tratá-las como zero.
export function slope(values: (number | null)[]): number | null {
  const pts: [number, number][] = [];
  values.forEach((v, i) => { if (v !== null) pts.push([i, v]); });
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export interface WeekComparison {
  current: Summary;   // últimos 7 dias do intervalo
  previous: Summary;  // 7 dias anteriores
  deltaMean: number | null;
}

export function weekComparison(values: (number | null)[]): WeekComparison {
  const current = summarize(values.slice(-7));
  const previous = summarize(values.slice(-14, -7));
  // Só compara períodos equivalentes quando os dois blocos têm sete observações.
  // Médias parciais continuam disponíveis acima, mas não geram uma variação enganosa.
  const deltaMean = current.n === 7 && previous.n === 7
    ? current.mean! - previous.mean!
    : null;
  return { current, previous, deltaMean };
}

// Média móvel com janela fixa; posições sem valores suficientes ficam null.
export function movingAverage(values: (number | null)[], window = 7): (number | null)[] {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return win.length >= Math.ceil(window / 2) ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

// ---- Correlação exploratória (gated) ----

function ranks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j) / 2 + 1; // ranks médios em empates
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null; // variância zero: correlação indefinida
  return num / Math.sqrt(da * db);
}

export interface CorrelationResult {
  n: number;
  rho: number | null;
  status: 'disabled' | 'insufficient' | 'computed';
}

// Spearman sobre pares completos. Retorna rho apenas se houver pares suficientes.
export function spearman(
  xs: (number | null)[],
  ys: (number | null)[],
  minPairs: number = MIN_PAIRS,
): CorrelationResult {
  const pairs: [number, number][] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (x !== null && y !== null) pairs.push([x, y]);
  });
  const n = pairs.length;
  if (n < minPairs) return { n, rho: null, status: 'insufficient' };
  const rho = pearson(ranks(pairs.map(p => p[0])), ranks(pairs.map(p => p[1])));
  return { n, rho, status: 'computed' };
}
