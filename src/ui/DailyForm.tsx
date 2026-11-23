import { useCallback, useEffect, useRef, useState } from 'react';
import { DIMENSIONS, type Dimension } from '../domain/indicators';
import { draftSchema, missingForComplete, type DraftFields } from '../domain/schemas';
import {
  getOrCreateEntry, saveDraft, completeEntry, ConflictError, type LoadedEntry,
} from '../data/repository';
import {
  saveOfflineDraft, getOfflineDraft, deleteOfflineDraft,
} from '../data/offlineDrafts';

const DEBOUNCE_MS = 800;

function formatDate(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function countFilled(scores: Record<string, number | null>): number {
  return Object.values(scores).filter(v => v !== null).length;
}

export function DailyForm({ date }: { date: string }) {
  const [entry, setEntry] = useState<LoadedEntry | null>(null);
  const [fields, setFields] = useState<DraftFields | null>(null);
  const [status, setStatus] = useState<'draft' | 'complete'>('draft');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [offlineConflict, setOfflineConflict] = useState(false);

  // Cada persistência entra na mesma fila e aguarda a anterior.
  const entryRef = useRef<LoadedEntry | null>(null);
  const fieldsRef = useRef<DraftFields | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const revisionRef = useRef(0);
  const offlineConflictRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setEntry(null); setFields(null); setDirty(false);
    setMessage(''); setLoadError(''); setSaveState('idle'); setOfflineConflict(false);
    offlineConflictRef.current = false;
    entryRef.current = null; fieldsRef.current = null;
    revisionRef.current = 0;
    saveQueueRef.current = Promise.resolve(true);

    getOrCreateEntry(date)
      .then(async e => {
        const pending = await getOfflineDraft(e.id).catch(() => null);
        if (cancelled) return;
        const serverFields: DraftFields = {
          sleep_hours: e.sleep_hours, sleep_notes: e.sleep_notes,
          events_context: e.events_context, behavior_notes: e.behavior_notes, scores: e.scores,
        };
        const recovered = pending?.fields ?? serverFields;
        entryRef.current = e; fieldsRef.current = recovered;
        setEntry(e); setFields(recovered); setStatus(e.status);
        if (pending) {
          if (pending.baseUpdatedAt === e.updated_at) {
            revisionRef.current = 1;
            setDirty(true);
            setMessage('Rascunho local recuperado. Sincronizando com o servidor…');
          } else {
            setOfflineConflict(true);
            offlineConflictRef.current = true;
            setSaveState('error');
            setMessage('Há uma cópia local e o registro do servidor foi alterado em outra sessão. A cópia local foi preservada; não será sobrescrita automaticamente.');
          }
        }
      })
      .catch(err => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, [date]);

  const persist = useCallback((): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const e = entryRef.current;
      const f = fieldsRef.current;
      if (!e || !f || offlineConflictRef.current) return false;
      const revision = revisionRef.current;
      const parsed = draftSchema.safeParse(f);
      if (!parsed.success) {
        setSaveState('error');
        setMessage(parsed.error.issues[0]?.message ?? 'Dados inválidos');
        return false;
      }
      setSaveState('saving');
      let localStored = false;
      try { await saveOfflineDraft(e.id, e.updated_at, f); localStored = true; } catch { /* sincronização online ainda pode funcionar */ }
      try {
        const updatedAt = await saveDraft(e, f);
        const updated = { ...e, updated_at: updatedAt, scores: f.scores };
        entryRef.current = updated;
        setEntry(updated);
        if (revisionRef.current === revision) {
          await deleteOfflineDraft(e.id).catch(() => undefined);
          // Uma edição pode ocorrer enquanto a limpeza do IndexedDB está pendente.
          if (revisionRef.current !== revision && fieldsRef.current) {
            await saveOfflineDraft(e.id, updatedAt, fieldsRef.current).catch(() => undefined);
          }
        } else if (fieldsRef.current) {
          await saveOfflineDraft(e.id, updatedAt, fieldsRef.current).catch(() => undefined);
        }
        setSaveState('saved'); setMessage('');
        return true;
      } catch (err) {
        setSaveState('error');
        setMessage(err instanceof ConflictError
          ? err.message
          : localStored
            ? 'Não foi possível sincronizar. Uma cópia local foi guardada neste navegador; tente novamente quando a conexão voltar.'
            : 'Não foi possível sincronizar nem guardar uma cópia local neste navegador. Mantenha esta tela aberta e tente novamente.');
        return false;
      }
    };
    const queued = saveQueueRef.current.then(run, run);
    saveQueueRef.current = queued;
    return queued;
  }, []);
  // Avisa antes de fechar/navegar enquanto há alterações não confirmadas.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Autosave com debounce.
  useEffect(() => {
    if (!dirty) return;
    const revision = revisionRef.current;
    const t = setTimeout(() => {
      void persist().then(ok => {
        if (ok && revisionRef.current === revision) setDirty(false);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [dirty, fields, persist]);

  function update(fn: (f: DraftFields) => DraftFields) {
    const next = fn(fieldsRef.current!);
    fieldsRef.current = next;
    revisionRef.current += 1;
    if (entryRef.current) {
      void saveOfflineDraft(entryRef.current.id, entryRef.current.updated_at, next)
        .catch(() => setMessage('Não foi possível guardar a cópia offline neste navegador.'));
    }
    setFields(next);
    setDirty(true);
    setSaveState('idle');
  }

  async function onComplete() {
    const f = fieldsRef.current;
    if (!f || !entryRef.current || offlineConflict) return;
    const missing = missingForComplete(f);
    if (missing.length > 0) {
      setSaveState('error');
      setMessage(`Faltam ${missing.length} campo(s). Ex.: ${missing.slice(0, 3).join('; ')}.`);
      return;
    }
    setSaveState('saving');
    try {
      let saved = false;
      let stableRevision = -1;
      while (!saved || stableRevision !== revisionRef.current) {
        stableRevision = revisionRef.current;
        saved = await persist();
        if (!saved) return;
      }
      await completeEntry(entryRef.current.id);
      setStatus('complete'); setDirty(false);
      setMessage('Registro concluído.');
    } catch (err) {
      setSaveState('error');
      setMessage(err instanceof Error ? err.message : 'Falha ao concluir.');
    }
  }

  if (loadError) return <p className="error">Erro ao carregar: {loadError}</p>;
  if (!fields || !entry) return <p>Carregando…</p>;

  const filled = countFilled(fields.scores);
  const total = Object.keys(fields.scores).length;

  return (
    <form className="daily" onSubmit={e => e.preventDefault()}>
      <header className="daily-header">
        <h2>{formatDate(date)}</h2>
        <span className={`badge ${status}`}>
          {status === 'complete' ? 'Concluído' : 'Rascunho'}
        </span>
        <small className="save-state">
          {saveState === 'saving' && 'Salvando…'}
          {saveState === 'saved' && !dirty && 'Salvo'}
        </small>
      </header>

      <p className="progress">
        {filled}/{total} indicadores · sono {fields.sleep_hours !== null ? 'informado' : 'pendente'}
      </p>

      {status === 'complete' && (
        <p className="notice">
          Registro concluído. Alterações são gravadas no histórico de revisões.
        </p>
      )}

      {DIMENSIONS.map(dim => (
        <DimensionSection
          key={dim.key}
          dim={dim}
          fields={fields}
          onScore={(k, v) => update(f => ({ ...f, scores: { ...f.scores, [k]: v } }))}
          onSleepHours={v => update(f => ({ ...f, sleep_hours: v }))}
        />
      ))}

      <section className="narrative">
        <h3>Registro narrativo</h3>
        <label>
          Acontecimentos e contexto <span className="req">*</span>
          <textarea
            value={fields.events_context}
            onChange={e => update(f => ({ ...f, events_context: e.target.value }))}
            rows={4}
          />
        </label>
        <label>
          Observações sobre seu comportamento <span className="req">*</span>
          <textarea
            value={fields.behavior_notes}
            onChange={e => update(f => ({ ...f, behavior_notes: e.target.value }))}
            rows={4}
          />
        </label>
        <label>
          Notas sobre o sono (opcional)
          <textarea
            value={fields.sleep_notes}
            onChange={e => update(f => ({ ...f, sleep_notes: e.target.value }))}
            rows={2}
          />
        </label>
      </section>

      <footer className="daily-footer">
        {message && <p className="message">{message}</p>}
        {saveState === 'error' && dirty && !offlineConflict && (
          <button type="button" className="link" onClick={() => {
            void persist().then(ok => { if (ok) setDirty(false); });
          }}>
            Tentar salvar novamente
          </button>
        )}
        {offlineConflict && (
          <button type="button" className="link" onClick={() => {
            if (!window.confirm('Descartar a cópia local e carregar a versão do servidor?')) return;
            const current = entryRef.current;
            if (!current) return;
            void deleteOfflineDraft(current.id).then(() => getOrCreateEntry(date)).then(e => {
              const fresh: DraftFields = {
                sleep_hours: e.sleep_hours, sleep_notes: e.sleep_notes,
                events_context: e.events_context, behavior_notes: e.behavior_notes, scores: e.scores,
              };
              entryRef.current = e; fieldsRef.current = fresh;
              setEntry(e); setFields(fresh); setStatus(e.status);
              setOfflineConflict(false); offlineConflictRef.current = false;
              setDirty(false); setSaveState('saved'); setMessage('');
            }).catch(err => setMessage(err instanceof Error ? err.message : 'Falha ao recarregar.'));
          }}>
            Descartar cópia local e recarregar
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={onComplete}
          disabled={status === 'complete' || saveState === 'saving' || offlineConflict}
        >
          Concluir registro
        </button>
      </footer>
    </form>
  );
}

function DimensionSection({
  dim, fields, onScore, onSleepHours,
}: {
  dim: Dimension;
  fields: DraftFields;
  onScore: (key: string, value: number | null) => void;
  onSleepHours: (v: number | null) => void;
}) {
  const filled = dim.indicators.filter(i => fields.scores[i.key] != null).length;
  const isSleep = dim.key === 'sleep';
  const sleepDone = fields.sleep_hours !== null;

  return (
    <details className="dimension" open>
      <summary>
        {dim.label}
        <span className="count">
          {filled + (isSleep && sleepDone ? 1 : 0)}/{dim.indicators.length + (isSleep ? 1 : 0)}
        </span>
      </summary>

      {isSleep && (
        <label className="hours">
          Horas dormidas
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={24}
            step={0.25}
            value={fields.sleep_hours ?? ''}
            onChange={e => {
              const v = e.target.value;
              onSleepHours(v === '' ? null : Number(v));
            }}
          />
        </label>
      )}

      {dim.indicators.map(ind => (
        <ScoreInput
          key={ind.key}
          label={ind.label}
          value={fields.scores[ind.key] ?? null}
          onChange={v => onScore(ind.key, v)}
        />
      ))}
    </details>
  );
}

function ScoreInput({
  label, value, onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="score">
      <div className="score-head">
        <span>{label}</span>
        <strong className={value === null ? 'unset' : ''}>{value ?? 'não preenchido'}</strong>
      </div>
      <div className="score-controls">
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={value ?? 0}
          aria-label={label}
          onChange={e => onChange(Number(e.target.value))}
        />
        {value !== null && (
          <button type="button" className="link" onClick={() => onChange(null)}>
            limpar
          </button>
        )}
      </div>
    </div>
  );
}
