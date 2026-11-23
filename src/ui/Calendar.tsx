import { useEffect, useState } from 'react';
import { listDays } from '../data/repository';
import { buildRange, coverage, type DayRecord } from '../domain/analysis';
import { localDateKey, monthRange } from '../domain/dates';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function Calendar({ onSelect }: { onSelect: (date: string) => void }) {
  const today = localDateKey();
  const [ym, setYm] = useState(() => {
    const [y, m] = today.split('-').map(Number);
    return { y, m0: m - 1 };
  });
  const [records, setRecords] = useState<Map<string, DayRecord>>(new Map());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { from, to } = monthRange(ym.y, ym.m0);

  useEffect(() => {
    let active = true;
    setError('');
    setLoading(true);
    listDays(from, to)
      .then(r => { if (active) setRecords(r.records); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Falha ao carregar o calendário.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  const firstWeekday = new Date(Date.UTC(ym.y, ym.m0, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m0 + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${ym.y}-${pad(ym.m0 + 1)}-${pad(i + 1)}`),
  ];

  const monthRecords = buildRange(from, to).map(
    d => records.get(d) ?? { date: d, status: null, scores: {}, sleep_hours: null },
  );
  const c = coverage(monthRecords);

  function shift(delta: number) {
    setYm(prev => {
      const total = prev.y * 12 + prev.m0 + delta;
      return { y: Math.floor(total / 12), m0: ((total % 12) + 12) % 12 };
    });
  }

  return (
    <section className="calendar">
      <div className="cal-nav">
        <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior">‹</button>
        <h2>{MONTHS[ym.m0]} de {ym.y}</h2>
        <button type="button" onClick={() => shift(1)} aria-label="Próximo mês">›</button>
      </div>

      <p className="coverage">
        {c.complete} concluídos · {c.draft} rascunhos · {c.missing} sem registro
      </p>
      {loading && <p className="muted" role="status">Carregando calendário…</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => <div key={i} className="cal-wd">{w}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={`e${i}`} />;
          const rec = records.get(date);
          const st = rec?.status ?? 'none';
          const future = date > today;
          const dayNum = Number(date.slice(-2));
          return (
            <button
              type="button"
              key={date}
              disabled={future || loading}
              className={`cal-day ${st} ${date === today ? 'today' : ''}`}
              aria-current={date === today ? 'date' : undefined}
              onClick={() => onSelect(date)}
              aria-label={`${date}: ${st === 'complete' ? 'concluído' : st === 'draft' ? 'rascunho' : 'sem registro'}`}
            >
              {dayNum}
            </button>
          );
        })}
      </div>

      <ul className="legend">
        <li><span className="swatch complete" /> Concluído</li>
        <li><span className="swatch draft" /> Rascunho</li>
        <li><span className="swatch none" /> Sem registro</li>
      </ul>
    </section>
  );
}
