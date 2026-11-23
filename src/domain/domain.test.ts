import { describe, it, expect } from 'vitest';
import {
  summarize, slope, coverage, weekComparison, spearman, movingAverage,
  buildRange, series, type DayRecord,
} from './analysis';
import { addDays, daysBetween, monthRange, localDateKey } from './dates';
import { ALL_INDICATORS, DIMENSIONS, INDICATOR_KEYS } from './indicators';
import { draftSchema, missingForComplete, exportEntrySchema, backupSchema, type DraftFields } from './schemas';

const rec = (date: string, status: DayRecord['status'], v: number | null = null): DayRecord => ({
  date, status, sleep_hours: null,
  scores: { tristeza: v },
});

describe('catálogo de indicadores', () => {
  it('tem 45 indicadores de escala, como especificado (fonte: schema SQL)', () => {
    expect(ALL_INDICATORS.length).toBe(45);
    expect(new Set(INDICATOR_KEYS).size).toBe(45); // sem duplicatas
    expect(DIMENSIONS.length).toBe(8);
  });
});

describe('datas', () => {
  it('soma dias atravessando fim de mês e ano', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('calcula diferença em dias de forma inteira', () => {
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(28);
  });
  it('intervalo do mês cobre o último dia correto (inclui bissexto)', () => {
    expect(monthRange(2024, 1)).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange(2026, 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('localDateKey usa componentes locais', () => {
    expect(localDateKey(new Date(2026, 4, 9, 23, 59))).toBe('2026-05-09');
  });
});

describe('summarize', () => {
  it('ignora ausências em vez de tratá-las como zero', () => {
    const s = summarize([2, null, 4, null]);
    expect(s.n).toBe(2);
    expect(s.mean).toBe(3);
    expect(s.min).toBe(2);
    expect(s.max).toBe(4);
  });
  it('desvio padrão amostral (n-1)', () => {
    expect(summarize([2, 4, 4, 4, 5, 5, 7, 9]).sd).toBeCloseTo(2.138, 3);
  });
  it('n = 0 não produz média', () => {
    expect(summarize([null, null])).toEqual({ n: 0, mean: null, sd: null, min: null, max: null });
  });
});

describe('slope', () => {
  it('inclinação de série linear é exata', () => {
    expect(slope([1, 2, 3, 4])).toBeCloseTo(1, 10);
  });
  it('pula ausências mas preserva posição temporal', () => {
    // valores em dias 0 e 2 (dia 1 ausente): inclinação 1/dia
    expect(slope([0, null, 2])).toBeCloseTo(1, 10);
  });
  it('menos de dois pontos não gera tendência', () => {
    expect(slope([null, 5, null])).toBeNull();
  });
});

describe('coverage', () => {
  it('separa completo, rascunho e ausente', () => {
    const c = coverage([rec('a', 'complete'), rec('b', 'draft'), rec('c', null)]);
    expect(c).toEqual({ days: 3, complete: 1, draft: 1, missing: 1 });
  });
});

describe('weekComparison', () => {
  it('compara últimos 7 dias com os 7 anteriores', () => {
    const values = [...Array(7).fill(2), ...Array(7).fill(6)];
    const w = weekComparison(values);
    expect(w.previous.mean).toBe(2);
    expect(w.current.mean).toBe(6);
    expect(w.deltaMean).toBe(4);
  });
  it('sem a semana anterior completa, não calcula variação', () => {
    expect(weekComparison([5, 5, 5]).deltaMean).toBeNull();
  });
});

describe('movingAverage', () => {
  it('não calcula com janela insuficiente de dados', () => {
    const ma = movingAverage([null, null, null, 4], 4);
    expect(ma[3]).toBeNull(); // só 1 valor em janela de 4 (< metade)
  });
});

describe('spearman (correlação exploratória)', () => {
  it('não calcula abaixo do mínimo de pares', () => {
    const xs = [1, 2, 3, 4, 5];
    const r = spearman(xs, xs);
    expect(r.status).toBe('insufficient');
    expect(r.rho).toBeNull();
  });
  it('calcula monotonia perfeita quando há pares suficientes', () => {
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const ys = xs.map(x => x * x); // monotônica crescente
    const r = spearman(xs, ys);
    expect(r.status).toBe('computed');
    expect(r.rho).toBeCloseTo(1, 10);
  });
  it('trata empates com ranks médios', () => {
    const xs = Array.from({ length: 30 }, (_, i) => Math.floor(i / 3));
    const ys = Array.from({ length: 30 }, (_, i) => i);
    const r = spearman(xs, ys);
    expect(r.rho).not.toBeNull();
    expect(r.rho!).toBeGreaterThan(0.9);
  });
  it('variância zero devolve indefinido, não NaN', () => {
    const xs = Array(30).fill(3);
    const ys = Array.from({ length: 30 }, (_, i) => i);
    expect(spearman(xs, ys).rho).toBeNull();
  });
});

describe('buildRange e series', () => {
  it('dias sem registro viram ausência, não zero', () => {
    const range = buildRange('2026-05-01', '2026-05-03');
    expect(range).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
    const recs = [rec('2026-05-01', 'draft', 7), rec('2026-05-02', null), rec('2026-05-03', 'complete', 3)];
    expect(series(recs, 'tristeza')).toEqual([7, null, 3]);
  });
});

describe('validação de rascunho e conclusão', () => {
  const emptyScores = Object.fromEntries(INDICATOR_KEYS.map(k => [k, null]));
  const base: DraftFields = {
    sleep_hours: null, sleep_notes: '', events_context: '', behavior_notes: '',
    scores: emptyScores,
  };

  it('aceita rascunho totalmente vazio', () => {
    expect(draftSchema.safeParse(base).success).toBe(true);
  });
  it('rejeita indicador desconhecido', () => {
    const r = draftSchema.safeParse({ ...base, scores: { inventado: 3 } });
    expect(r.success).toBe(false);
  });
  it('rejeita score fora de 0–10', () => {
    const r = draftSchema.safeParse({ ...base, scores: { tristeza: 11 } });
    expect(r.success).toBe(false);
  });
  it('aceita horas de sono em quartos de hora e rejeita frações estranhas', () => {
    expect(draftSchema.safeParse({ ...base, sleep_hours: 6.25 }).success).toBe(true);
    expect(draftSchema.safeParse({ ...base, sleep_hours: 6.1 }).success).toBe(false);
  });
  it('lista tudo que falta para concluir', () => {
    const missing = missingForComplete(base);
    expect(missing).toContain('Horas de sono');
    expect(missing).toContain('Acontecimentos e contexto');
    expect(missing).toContain('Observações sobre seu comportamento');
    expect(missing.length).toBe(45 + 3);
  });
  it('campos narrativos só com espaços não contam como preenchidos', () => {
    const missing = missingForComplete({ ...base, events_context: '   ' });
    expect(missing).toContain('Acontecimentos e contexto');
  });
  it('backup marcado como concluído mas incompleto é rejeitado', () => {
    const r = exportEntrySchema.safeParse({
      entry_date: '2026-05-01', status: 'complete', sleep_hours: 7,
      sleep_notes: '', events_context: 'x', behavior_notes: 'y', scores: emptyScores,
    });
    expect(r.success).toBe(false);
  });
});


describe('validação de backup', () => {
  const scores = Object.fromEntries(INDICATOR_KEYS.map(k => [k, null]));
  const entry = {
    entry_date: '2026-05-01',
    status: 'draft' as const,
    sleep_hours: null,
    sleep_notes: '',
    events_context: '',
    behavior_notes: '',
    scores,
  };

  it('rejeita datas duplicadas no mesmo backup', () => {
    const result = backupSchema.safeParse({
      schema_version: 1,
      entries: [entry, entry],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita backup com indicador ausente', () => {
    const incomplete = { ...entry, scores: { ...scores } };
    delete (incomplete.scores as Record<string, number | null>).tristeza;
    const result = backupSchema.safeParse({
      schema_version: 1,
      entries: [incomplete],
    });
    expect(result.success).toBe(false);
  });

  it('aceita backup com os 45 indicadores e datas únicas', () => {
    const result = backupSchema.safeParse({
      schema_version: 1,
      entries: [entry, { ...entry, entry_date: '2026-05-02' }],
    });
    expect(result.success).toBe(true);
  });
});
