import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { DIMENSIONS, INDICATOR_LABEL, ALL_INDICATORS } from '../domain/indicators';
import { addDays, localDateKey } from '../domain/dates';
import {
  buildRange, coverage, movingAverage, series, sleepSeries, slope, spearman,
  summarize, weekComparison, CORRELATIONS_ENABLED, MIN_PAIRS, type DayRecord,
} from '../domain/analysis';
import { listDays } from '../data/repository';

const RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: '1 ano', days: 365 },
];

const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

export function Analysis() {
  const today = localDateKey();
  const [rangeDays, setRangeDays] = useState(30);
  const [indicator, setIndicator] = useState('tristeza');
  const [compare, setCompare] = useState<string>('');
  const [recordsMap, setRecordsMap] = useState<Map<string, DayRecord>>(new Map());
  const [error, setError] = useState('');

  const from = addDays(today, -(rangeDays - 1));
  const to = today;

  useEffect(() => {
    setError('');
    listDays(from, to)
      .then(r => setRecordsMap(r.records))
      .catch(e => setError(e.message));
  }, [from, to]);

  const records: DayRecord[] = useMemo(
    () => buildRange(from, to).map(d => recordsMap.get(d) ?? { date: d, status: null, scores: {}, sleep_hours: null }),
    [from, to, recordsMap],
  );

  const cov = coverage(records);
  const values = series(records, indicator);
  const sum = summarize(values);
  const week = weekComparison(values);
  const trend = sum.n >= 7 ? slope(values) : null;
  const ma = movingAverage(values, 7);

  const chartData = records.map((r, i) => ({
    date: r.date.slice(5),
    value: values[i],
    compare: compare ? series(records, compare)[i] : null,
    avg7: ma[i],
  }));
  const sleep = sleepSeries(records);
  const sleepData = records.map((r, i) => ({ date: r.date.slice(5), sleep: sleep[i] }));

  const corr = compare
    ? spearman(values, series(records, compare))
    : null;

  return (
    <section className="analysis">
      <div className="controls">
        <div className="seg">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              className={rangeDays === r.days ? 'active' : ''}
              onClick={() => setRangeDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label>
          Indicador
          <select value={indicator} onChange={e => setIndicator(e.target.value)}>
            {DIMENSIONS.map(d => (
              <optgroup key={d.key} label={d.label}>
                {d.indicators.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Comparar com (opcional)
          <select value={compare} onChange={e => setCompare(e.target.value)}>
            <option value="">— nenhum —</option>
            {ALL_INDICATORS.filter(i => i.key !== indicator).map(i => (
              <option key={i.key} value={i.key}>{i.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <p className="base">
        <strong>Base do período:</strong> {cov.days} dias · {cov.complete} concluídos ·{' '}
        {cov.draft} rascunhos · {cov.missing} sem registro. Os valores abaixo consideram apenas
        dias com valor preenchido (n).
      </p>

      <div className="stats">
        <Stat label="n (dias com valor)" value={String(sum.n)} />
        <Stat label="Média" value={fmt(sum.mean)} />
        <Stat label="Desvio padrão" value={fmt(sum.sd)} />
        <Stat label="Mínimo / máximo" value={sum.n ? `${sum.min} / ${sum.max}` : '—'} />
        <Stat label="Últimos 7 dias" value={fmt(week.current.mean)} sub={`n=${week.current.n}`} />
        <Stat label="7 anteriores" value={fmt(week.previous.mean)} sub={`n=${week.previous.n}`} />
        <Stat label="Variação semanal" value={signed(week.deltaMean)} />
        <Stat
          label="Tendência (por dia)"
          value={trend === null ? 'insuficiente' : signed(trend)}
          sub={sum.n < 7 ? 'precisa de ao menos 7 dias' : undefined}
        />
      </div>

      <h3>{INDICATOR_LABEL[indicator]}</h3>
      <div className="chart">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={16} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="value" name={INDICATOR_LABEL[indicator]} stroke="#3b5b8c" connectNulls={false} dot />
            <Line type="monotone" dataKey="avg7" name="Média móvel 7d" stroke="#9aa5b1" strokeDasharray="4 4" dot={false} connectNulls />
            {compare && (
              <Line type="monotone" dataKey="compare" name={INDICATOR_LABEL[compare]} stroke="#b5562f" connectNulls={false} dot />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3>Sono (horas)</h3>
      <div className="chart">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={sleepData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={16} />
            <YAxis domain={[0, 12]} />
            <Tooltip />
            <Line type="monotone" dataKey="sleep" name="Horas dormidas" stroke="#4f7d5b" connectNulls={false} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3>Correlação exploratória</h3>
      {!CORRELATIONS_ENABLED && (
        <p className="muted">
          Desativada nesta versão. Correlações só são exibidas com pelo menos {MIN_PAIRS} dias
          com ambos os valores e com a funcionalidade habilitada explicitamente.
        </p>
      )}
      {CORRELATIONS_ENABLED && compare && corr && (
        corr.status === 'computed'
          ? <p>ρ (Spearman) = <strong>{fmt(corr.rho, 2)}</strong>, n = {corr.n}. Associação estatística, não causal.</p>
          : <p className="muted">Pares insuficientes: n = {corr.n} de {MIN_PAIRS} necessários.</p>
      )}
      {CORRELATIONS_ENABLED && !compare && (
        <p className="muted">Escolha um segundo indicador em “Comparar com”.</p>
      )}

      <p className="muted small">
        Observado: valores registrados. Associação: estatística descritiva, sem diagnóstico.
        Interpretação: fica por sua conta.
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}
