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
type AnalysisView = 'overview' | 'evolution' | 'relations';

const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

export function Analysis() {
  const today = localDateKey();
  const [rangeDays, setRangeDays] = useState(30);
  const [indicator, setIndicator] = useState('tristeza');
  const [compare, setCompare] = useState<string>('');
  const [view, setView] = useState<AnalysisView>('overview');
  const [recordsMap, setRecordsMap] = useState<Map<string, DayRecord>>(new Map());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const from = addDays(today, -(rangeDays - 1));
  const to = today;

  useEffect(() => {
    let active = true;
    setError('');
    setLoading(true);
    listDays(from, to)
      .then(r => { if (active) setRecordsMap(r.records); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Falha ao carregar os registros.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  const records: DayRecord[] = useMemo(
    () => buildRange(from, to).map(d => recordsMap.get(d) ?? { date: d, status: null, scores: {}, sleep_hours: null }),
    [from, to, recordsMap],
  );

  const cov = coverage(records);
  const coveragePct = cov.days ? Math.round((cov.complete + cov.draft) / cov.days * 100) : 0;
  const values = series(records, indicator);
  const sum = summarize(values);
  const week = weekComparison(values);
  const trend = sum.n >= 7 ? slope(values) : null;
  const ma = movingAverage(values, 7);
  const sleep = sleepSeries(records);
  const sleepSummary = summarize(sleep);
  const corr = compare ? spearman(values, series(records, compare)) : null;

  const chartLabel = (date: string) => {
    const parsed = new Date(`${date}T12:00:00`);
    return rangeDays > 90
      ? parsed.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
      : parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };
  const chartData = records.map((r, i) => ({
    date: chartLabel(r.date),
    value: values[i],
    compare: compare ? series(records, compare)[i] : null,
    avg7: ma[i],
  }));
  const sleepData = records.map((r, i) => ({ date: chartLabel(r.date), sleep: sleep[i] }));

  const dimensionCoverage = DIMENSIONS.map(d => {
    const possible = records.length * d.indicators.length;
    const observed = records.reduce((n, record) =>
      n + d.indicators.filter(item => record.status && record.scores[item.key] !== null && record.scores[item.key] !== undefined).length, 0);
    return { ...d, possible, observed, pct: possible ? Math.round(observed / possible * 100) : 0 };
  });
  const totalPossible = records.length * ALL_INDICATORS.length;
  const totalObserved = dimensionCoverage.reduce((n, d) => n + d.observed, 0);
  const observationPct = totalPossible ? Math.round(totalObserved / totalPossible * 100) : 0;

  return (
    <section className="analysis">
      <header className="analysis-header">
        <span className="eyebrow">LEITURA DOS SEUS REGISTROS</span>
        <h1>Análises</h1>
        <p className="muted">Uma visão organizada do que foi registrado. Os dados descrevem observações; não produzem diagnósticos nem explicam causas por conta própria.</p>
      </header>

      <div className="analysis-workspace">
        <div className="analysis-period">
          <span className="period-label">PERÍODO OBSERVADO</span>
          <div className="seg" aria-label="Selecionar período">
            {RANGES.map(r => (
              <button key={r.days} type="button" className={rangeDays === r.days ? 'active' : ''}
                aria-pressed={rangeDays === r.days} onClick={() => setRangeDays(r.days)}>{r.label}</button>
            ))}
          </div>
        </div>
        <nav className="analysis-tabs" aria-label="Seções das análises">
          <button type="button" className={view === 'overview' ? 'active' : ''} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => setView('overview')}>
            <span className="analysis-tab-index">01</span><span><strong>Visão geral</strong><small>Panorama do período</small></span>
          </button>
          <button type="button" className={view === 'evolution' ? 'active' : ''} aria-current={view === 'evolution' ? 'page' : undefined} onClick={() => setView('evolution')}>
            <span className="analysis-tab-index">02</span><span><strong>Evolução</strong><small>Um indicador no tempo</small></span>
          </button>
          <button type="button" className={view === 'relations' ? 'active' : ''} aria-current={view === 'relations' ? 'page' : undefined} onClick={() => setView('relations')}>
            <span className="analysis-tab-index">03</span><span><strong>Relações</strong><small>Exploração entre variáveis</small></span>
          </button>
        </nav>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <div className="analysis-loading" role="status"><span className="loading-pulse" />Organizando os registros deste período…</div>
      ) : !error && (
        <>
          {view === 'overview' && (
            <section className="analysis-view" aria-labelledby="overview-title">
              <div className="view-intro">
                <div><span className="eyebrow">01 · PANORAMA</span><h2 id="overview-title">O que existe neste período</h2></div>
                <p>Antes de observar tendências, veja a quantidade e a distribuição dos registros disponíveis.</p>
              </div>
              <div className="overview-metrics">
                <article className="overview-metric overview-metric-primary">
                  <span>Dias com registro</span><strong>{cov.complete + cov.draft}<small> / {cov.days}</small></strong>
                  <div className="metric-track"><i style={{ width: `${coveragePct}%` }} /></div>
                  <small>{coveragePct}% dos dias do período</small>
                </article>
                <article className="overview-metric">
                  <span>Registros concluídos</span><strong>{cov.complete}</strong><small>Registros finalizados</small>
                </article>
                <article className="overview-metric">
                  <span>Rascunhos</span><strong>{cov.draft}</strong><small>Registros ainda não concluídos</small>
                </article>
                <article className="overview-metric">
                  <span>Valores preenchidos</span><strong>{totalObserved.toLocaleString('pt-BR')}</strong><small>{observationPct}% das possibilidades de observação</small>
                </article>
              </div>
              <div className="analysis-panel dimension-coverage-panel">
                <div className="panel-heading"><div><span className="eyebrow">DISTRIBUIÇÃO</span><h3>Presença de dados por dimensão</h3></div><span className="panel-meta">valores preenchidos</span></div>
                <p className="muted small">A proporção considera todos os indicadores de cada dimensão em todos os dias do período. Campos não preenchidos permanecem ausentes, não são tratados como zero.</p>
                <div className="dimension-coverage-list">
                  {dimensionCoverage.map(d => (
                    <div className="dimension-coverage-row" key={d.key}>
                      <div className="dimension-coverage-label"><strong>{d.label}</strong><span>{d.observed} / {d.possible}</span></div>
                      <div className="dimension-coverage-track"><i style={{ width: `${d.pct}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="analysis-panel">
                <div className="panel-heading"><div><span className="eyebrow">OUTRO REGISTRO</span><h3>Horas de sono</h3></div><strong className="panel-number">{fmt(sleepSummary.mean, 1)}<small> h · média</small></strong></div>
                {sleepSummary.n ? <p className="muted small">Há {sleepSummary.n} dia(s) com duração do sono preenchida neste período. A média não representa, isoladamente, qualidade ou recuperação.</p> : <p className="muted">Ainda não há duração do sono registrada neste período.</p>}
              </div>
              <div className="analysis-next-step"><span>PRÓXIMA LEITURA</span><p>Escolha um indicador para acompanhar sua variação ao longo do tempo.</p><button type="button" onClick={() => setView('evolution')}>Explorar evolução <span aria-hidden="true">→</span></button></div>
            </section>
          )}

          {view === 'evolution' && (
            <section className="analysis-view" aria-labelledby="evolution-title">
              <div className="view-intro">
                <div><span className="eyebrow">02 · SÉRIE TEMPORAL</span><h2 id="evolution-title">Acompanhar um indicador</h2></div>
                <p>Observe os valores registrados e como se distribuem no intervalo escolhido.</p>
              </div>
              <div className="analysis-panel indicator-picker">
                <label>Indicador para acompanhar
                  <select value={indicator} onChange={e => setIndicator(e.target.value)}>
                    {DIMENSIONS.map(d => <optgroup key={d.key} label={d.label}>
                      {d.indicators.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                    </optgroup>)}
                  </select>
                </label>
                <div className="indicator-summary">
                  <div><span className="eyebrow">VALOR MÉDIO</span><strong>{fmt(sum.mean)}</strong></div>
                  <div><span className="eyebrow">OBSERVAÇÕES</span><strong>{sum.n}</strong></div>
                  <div><span className="eyebrow">MÍNIMO / MÁXIMO</span><strong>{sum.n ? `${sum.min} / ${sum.max}` : '—'}</strong></div>
                </div>
              </div>
              {sum.n === 0 ? <p className="notice">Ainda não há valores para este indicador no período. Experimente ampliar o intervalo ou escolher outro indicador.</p> : (
                <>
                  <div className="analysis-panel chart-panel">
                    <div className="panel-heading"><div><span className="eyebrow">EVOLUÇÃO NO TEMPO</span><h3>{INDICATOR_LABEL[indicator]}</h3></div><span className="panel-meta">escala de 0 a 10</span></div>
                    <p className="muted small">Cada ponto representa um valor registrado. Espaços sem ponto indicam dias sem avaliação.</p>
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="date" minTickGap={16} tick={{ fontSize: 11 }} />
                          <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="value" name={INDICATOR_LABEL[indicator]} stroke="#45685c" strokeWidth={2.5} connectNulls={false} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="avg7" name="Média móvel 7d" stroke="#b28a58" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="scale-description">Extremos da escala: <strong>{ALL_INDICATORS.find(item => item.key === indicator)?.scaleLow}</strong> → <strong>{ALL_INDICATORS.find(item => item.key === indicator)?.scaleHigh}</strong>.</p>
                  </div>
                  <div className="analysis-panel">
                    <div className="panel-heading"><div><span className="eyebrow">RESUMO ESTATÍSTICO</span><h3>Valores no período</h3></div></div>
                    <div className="stats">
                      <Stat label="Desvio padrão" value={fmt(sum.sd)} />
                      <Stat label="Últimos 7 dias" value={fmt(week.current.mean)} sub={`n=${week.current.n}`} />
                      <Stat label="7 dias anteriores" value={fmt(week.previous.mean)} sub={`n=${week.previous.n}`} />
                      <Stat label="Variação entre médias" value={signed(week.deltaMean)} sub={week.current.n < 7 || week.previous.n < 7 ? 'amostra parcial' : 'últimos 7 vs. 7 anteriores'} />
                      <Stat label="Inclinação linear / dia" value={trend === null ? 'insuficiente' : signed(trend)} sub={sum.n < 7 ? 'requer ao menos 7 observações' : 'descrição matemática, não previsão'} />
                    </div>
                    {sum.n < 7 && <p className="muted small">Amostra pequena: tendências e comparações podem ser instáveis.</p>}
                  </div>
                </>
              )}
              <div className="analysis-panel">
                <div className="panel-heading"><div><span className="eyebrow">SONO</span><h3>Duração registrada</h3></div><strong className="panel-number">{fmt(sleepSummary.mean, 1)}<small> h</small></strong></div>
                {sleepSummary.n ? <div className="chart"><ResponsiveContainer width="100%" height={180}>
                  <LineChart data={sleepData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" minTickGap={16} tick={{ fontSize: 11 }} /><YAxis domain={[0, 24]} ticks={[0, 6, 12, 18, 24]} /><Tooltip /><Line type="monotone" dataKey="sleep" name="Horas dormidas" stroke="#78927b" strokeWidth={2.5} connectNulls={false} dot={{ r: 3 }} /></LineChart>
                </ResponsiveContainer></div> : <p className="muted">Não há valores de horas de sono neste período.</p>}
              </div>
            </section>
          )}

          {view === 'relations' && (
            <section className="analysis-view" aria-labelledby="relations-title">
              <div className="view-intro">
                <div><span className="eyebrow">03 · EXPLORAÇÃO</span><h2 id="relations-title">Observar relações</h2></div>
                <p>Compare duas variáveis para investigar perguntas. Uma associação não demonstra que uma variável provoca a outra.</p>
              </div>
              <div className="analysis-panel relation-picker">
                <label>Primeiro indicador
                  <select value={indicator} onChange={e => { setIndicator(e.target.value); if (e.target.value === compare) setCompare(''); }}>
                    {DIMENSIONS.map(d => <optgroup key={d.key} label={d.label}>{d.indicators.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}</optgroup>)}
                  </select>
                </label>
                <div className="relation-connector" aria-hidden="true">×</div>
                <label>Segundo indicador
                  <select value={compare} onChange={e => setCompare(e.target.value)}>
                    <option value="">Selecione uma variável</option>
                    {ALL_INDICATORS.filter(i => i.key !== indicator).map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                  </select>
                </label>
              </div>
              {!compare ? <div className="relation-empty"><span aria-hidden="true">↗</span><h3>Escolha duas variáveis</h3><p>Você poderá explorar quantos dias possuem observações simultâneas e, quando habilitado, uma medida de associação.</p></div> : (
                <div className="analysis-panel relation-result">
                  <span className="eyebrow">OBSERVAÇÕES SIMULTÂNEAS</span>
                  <strong className="relation-pair">{INDICATOR_LABEL[indicator]} <span>×</span> {INDICATOR_LABEL[compare]}</strong>
                  <div className="relation-count">{corr?.n ?? 0}<small> dias com os dois valores preenchidos</small></div>
                  {!CORRELATIONS_ENABLED ? (
                    <div className="analysis-caveat"><strong>Correlação exploratória ainda desativada</strong><p>A comparação estatística não está habilitada nesta versão. A interface mostra a quantidade de pares completos, sem calcular ou sugerir uma relação.</p><small>Quando habilitada, a análise exigirá pelo menos {MIN_PAIRS} pares completos e continuará sendo descritiva, não causal.</small></div>
                  ) : corr?.status === 'computed' ? (
                    <p>Correlação de Spearman (ρ): <strong>{fmt(corr.rho, 2)}</strong>, com {corr.n} pares. Associação estatística não demonstra causalidade.</p>
                  ) : <p className="muted">Pares insuficientes: {corr?.n ?? 0} de {MIN_PAIRS} necessários.</p>}
                </div>
              )}
              <div className="analysis-method-card"><strong>Como interpretar</strong><p>Uma relação estatística pode refletir coincidência, contexto compartilhado, direção inversa ou outras variáveis. Use a comparação como ponto de partida para reflexão, não como conclusão sobre seu comportamento.</p></div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="stat"><span className="stat-label">{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}
