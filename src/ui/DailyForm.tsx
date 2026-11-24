import { useCallback, useEffect, useRef, useState } from 'react';
import { DIMENSIONS, type Dimension, type Indicator } from '../domain/indicators';
import { draftSchema, missingForComplete, type DraftFields } from '../domain/schemas';
import {
  getOrCreateEntry, saveDraft, completeEntry, ConflictError, type LoadedEntry,
} from '../data/repository';
import {
  saveOfflineDraft, getOfflineDraft, deleteOfflineDraft,
} from '../data/offlineDrafts';

const DEBOUNCE_MS = 800;

const FORM_STEPS = [
  { title: 'Visão geral', description: 'Acompanhe o progresso e escolha por onde começar. Nenhum indicador é preenchido automaticamente.', dimensions: [] },
  ...DIMENSIONS.map(dim => ({
    title: dim.label,
    description: `Observe e registre ${dim.label.toLocaleLowerCase('pt-BR')} ao longo do dia. Você pode deixar qualquer item sem avaliação e retornar depois.`,
    dimensions: [dim.key],
  })),
  { title: 'Narrativa e revisão', description: 'Acrescente contexto e revise o registro antes de concluí-lo.', dimensions: [] },
];

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
  const [step, setStep] = useState(0);
  const [showMissing, setShowMissing] = useState(false);
  const [confirmCompletion, setConfirmCompletion] = useState(false);
  const [pendingIndicatorKey, setPendingIndicatorKey] = useState<string | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const previousStepRef = useRef(step);

  // Ao avançar, voltar ou escolher uma etapa, reposiciona a leitura no novo conteúdo.
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    stepHeadingRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Quando a revisão aponta uma pendência específica, abre sua dimensão e leva até o cartão.
  useEffect(() => {
    if (!pendingIndicatorKey) return;
    const target = document.getElementById(`indicator-${pendingIndicatorKey}`);
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const focusTarget = target instanceof HTMLElement && target.matches('button, input')
      ? target
      : target.querySelector('button, input') as HTMLElement | null;
    focusTarget?.focus({ preventScroll: true });
    setPendingIndicatorKey(null);
  }, [step, pendingIndicatorKey]);

  // Cada persistência entra na mesma fila e aguarda a anterior.
  const entryRef = useRef<LoadedEntry | null>(null);
  const fieldsRef = useRef<DraftFields | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const offlineQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);
  const offlineConflictRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setEntry(null); setFields(null); setDirty(false); setStep(0);
    setMessage(''); setLoadError(''); setSaveState('idle'); setOfflineConflict(false);
    offlineConflictRef.current = false;
    entryRef.current = null; fieldsRef.current = null;
    revisionRef.current = 0;
    saveQueueRef.current = Promise.resolve(true);

    getOrCreateEntry(date)
      .then(async e => {
        let pending = null;
        try {
          pending = await getOfflineDraft(e.id);
        } catch {
          if (!cancelled) setMessage('O armazenamento offline não está disponível neste navegador; o salvamento pela internet continua habilitado.');
        }
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

  const queueOffline = useCallback((operation: () => Promise<void>): Promise<void> => {
    const queued = offlineQueueRef.current.then(operation, operation);
    offlineQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, []);

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
      try {
        await queueOffline(() => saveOfflineDraft(e.id, e.updated_at, f));
        localStored = true;
      } catch { /* sincronização online ainda pode funcionar */ }
      try {
        const updatedAt = await saveDraft(e, f);
        const updated = { ...e, updated_at: updatedAt, scores: f.scores };
        entryRef.current = updated;
        setEntry(updated);
        if (revisionRef.current === revision) {
          await queueOffline(() => deleteOfflineDraft(e.id)).catch(() => undefined);
          // Uma edição pode ocorrer enquanto a limpeza do IndexedDB está pendente.
          if (revisionRef.current !== revision && fieldsRef.current) {
            await queueOffline(() => saveOfflineDraft(e.id, updatedAt, fieldsRef.current!)).catch(() => undefined);
          }
        } else if (fieldsRef.current) {
          await queueOffline(() => saveOfflineDraft(e.id, updatedAt, fieldsRef.current!)).catch(() => undefined);
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
  }, [queueOffline]);
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

  // Ao recuperar a conexão, tenta sincronizar o rascunho local sem exigir nova edição.
  useEffect(() => {
    if (!dirty) return;
    const retrySync = () => {
      if (!navigator.onLine || offlineConflictRef.current) return;
      const revision = revisionRef.current;
      void persist().then(ok => {
        if (ok && revisionRef.current === revision) setDirty(false);
      });
    };
    window.addEventListener('online', retrySync);
    return () => window.removeEventListener('online', retrySync);
  }, [dirty, persist]);

  function update(fn: (f: DraftFields) => DraftFields) {
    const next = fn(fieldsRef.current!);
    fieldsRef.current = next;
    revisionRef.current += 1;
    const currentEntry = entryRef.current;
    if (currentEntry) {
      void queueOffline(() => saveOfflineDraft(currentEntry.id, currentEntry.updated_at, next))
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
      setShowMissing(true);
      const firstMissingIndicator = DIMENSIONS
        .flatMap(dim => dim.indicators.map(ind => ({ dimension: dim.key, key: ind.key })))
        .find(item => f.scores[item.key] == null);
      if (firstMissingIndicator) {
        const targetStep = FORM_STEPS.findIndex(item =>
          (item.dimensions as readonly string[]).includes(firstMissingIndicator.dimension)
        );
        if (targetStep >= 0) setStep(targetStep);
      } else if (f.sleep_hours === null) {
        const sleepStep = FORM_STEPS.findIndex(item =>
          (item.dimensions as readonly string[]).includes('sleep')
        );
        setStep(sleepStep);
      } else {
        setStep(FORM_STEPS.length - 1);
      }
      setSaveState('error');
      setMessage(`Ainda faltam ${missing.length} campos para concluir. Voltei à primeira etapa com pendências.`);
      return;
    }
    setShowMissing(false);
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
      setStatus('complete'); setDirty(false); setSaveState('saved');
      setConfirmCompletion(false);
      setMessage('Registro concluído.');
    } catch (err) {
      setSaveState('error');
      setMessage(err instanceof Error ? err.message : 'Falha ao concluir.');
    }
  }

  if (loadError) return <p className="error">Erro ao carregar: {loadError}</p>;
  if (!fields || !entry) return <p>Carregando…</p>;

  const missingFields = missingForComplete(fields);
  const filled = countFilled(fields.scores);
  const total = Object.keys(fields.scores).length;
  const requiredNarrative = Number(fields.events_context.trim().length > 0)
    + Number(fields.behavior_notes.trim().length > 0);
  const completedRequired = filled + Number(fields.sleep_hours !== null) + requiredNarrative;
  const totalRequired = total + 3;
  const stepProgress = FORM_STEPS.map((item, index) => {
    if (index === 0) {
      return {
        filled: completedRequired,
        total: totalRequired,
        complete: completedRequired === totalRequired,
      };
    }
    if (index === FORM_STEPS.length - 1) {
      return {
        filled: requiredNarrative,
        total: 2,
        complete: requiredNarrative === 2,
      };
    }
    const indicators = DIMENSIONS
      .filter(dim => (item.dimensions as readonly string[]).includes(dim.key))
      .flatMap(dim => dim.indicators);
    const scoreCount = indicators.filter(ind => fields.scores[ind.key] !== null).length;
    const includesSleep = (item.dimensions as readonly string[]).includes('sleep');
    const sleepCount = includesSleep && fields.sleep_hours !== null ? 1 : 0;
    const requiredCount = indicators.length + (includesSleep ? 1 : 0);
    return {
      filled: scoreCount + sleepCount,
      total: requiredCount,
      complete: scoreCount + sleepCount === requiredCount,
    };
  });

  return (
    <form className="daily" onSubmit={e => e.preventDefault()}>
      <header className="daily-header">
        <h2>{formatDate(date)}</h2>
        <span className={`badge ${status}`}>
          {status === 'complete' ? 'Concluído' : 'Rascunho'}
        </span>
        <small className={`save-state ${saveState === 'error' ? 'save-error' : ''}`} role="status" aria-live="polite">
          {saveState === 'saving' && 'Salvando…'}
          {saveState === 'saved' && !dirty && 'Alterações salvas'}
          {dirty && saveState !== 'saving' && 'Alterações pendentes'}
          {saveState === 'error' && 'Falha ao salvar'}
        </small>
      </header>

      <section className="form-progress" aria-label="Progresso do registro">
        <div className="progress-overview">
          <div className="progress-metric progress-indicators">
            <span className="progress-metric-label">Indicadores avaliados</span>
            <strong>{filled}<small> / {total}</small></strong>
            <div className="progress-track" role="progressbar" aria-label="Indicadores avaliados" aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled}>
              <span style={{ width: `${total ? filled / total * 100 : 0}%` }} />
            </div>
          </div>
          <div className="progress-metric">
            <span className="progress-metric-label">Informações complementares</span>
            <strong>{Number(fields.sleep_hours !== null) + requiredNarrative}<small> / 3</small></strong>
            <span className="progress-metric-note">Sono e narrativa</span>
          </div>
          <div className={status === 'complete' ? 'progress-metric progress-completion is-complete' : missingFields.length === 0 ? 'progress-metric progress-completion is-ready' : 'progress-metric progress-completion'}>
            <span className="progress-metric-label">Conclusão do registro</span>
            <strong>{status === 'complete' ? 'Concluído' : missingFields.length === 0 ? 'Pronto para concluir' : `${missingFields.length} pendências`}</strong>
            <span className="progress-metric-note">{status === 'complete' ? 'Registro finalizado' : 'A conclusão é uma ação separada'}</span>
          </div>
        </div>
        <nav className="step-nav" aria-label="Navegação entre dimensões e revisão">
          {FORM_STEPS.map((item, index) => {
            if (index === 0) return null;
            const progress = stepProgress[index];
            return (
              <button
                key={item.title}
                type="button"
                className={index === step ? 'step-nav-item active' : 'step-nav-item'}
                aria-current={index === step ? 'step' : undefined}
                aria-label={`${item.title}. ${progress.filled} de ${progress.total} campos preenchidos`}
                onClick={() => setStep(index)}
              >
                <span className="step-nav-number">{progress.complete ? '✓' : index === FORM_STEPS.length - 1 ? '↗' : index - 1}</span>
                <span className="step-nav-label">{item.title}</span>
                <span className="step-nav-count">{progress.filled}/{progress.total}</span>
              </button>
            );
          })}
        </nav>
        <div className="step-heading">
          <h3 ref={stepHeadingRef} tabIndex={-1}>{FORM_STEPS[step].title}</h3>
          <p>{FORM_STEPS[step].description}</p>
          {step > 0 && step < FORM_STEPS.length - 1 && (
            <small className="step-local-progress">
              {stepProgress[step].filled} de {stepProgress[step].total} itens avaliados nesta dimensão
            </small>
          )}
        </div>
      </section>

      {showMissing && missingFields.length > 0 && (
        <section className="missing-summary" role="alert" aria-live="polite">
          <h3>O registro ainda não pode ser concluído</h3>
          <p>Faltam {missingFields.length} campos obrigatórios. A lista abaixo mostra exatamente o que precisa ser preenchido:</p>
          <ul>
            {missingFields.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      <p className="scale-guidance">
        Use os extremos indicados em cada item como referência. Considere o conjunto do dia, não apenas um momento isolado. Se não conseguir avaliar, deixe o item sem preenchimento.
      </p>

      {status === 'complete' && (
        <section className="completion-notice" role="status">
          <span className="completion-check" aria-hidden="true">✓</span>
          <div>
            <h3>Seu registro está concluído</h3>
            <p>As respostas deste dia foram registradas. Você ainda pode revisitar e editar este conteúdo; as alterações ficam no histórico de revisões.</p>
          </div>
        </section>
      )}

      {step === 0 && (
        <section className="overview-step" aria-label="Visão geral do registro">
          <div className="overview-count">
            <strong>{completedRequired} de {totalRequired}</strong>
            <span>campos obrigatórios preenchidos</span>
          </div>
          <div className="overview-dimensions">
            {DIMENSIONS.map(dim => {
              const done = dim.indicators.filter(ind => fields.scores[ind.key] !== null).length
                + (dim.key === 'sleep' && fields.sleep_hours !== null ? 1 : 0);
              const count = dim.indicators.length + (dim.key === 'sleep' ? 1 : 0);
              return (
                <button key={dim.key} type="button" className="overview-dimension"
                  onClick={() => {
                    const target = FORM_STEPS.findIndex(item => (item.dimensions as readonly string[]).includes(dim.key));
                    if (target >= 0) setStep(target);
                  }}>
                  <span>{dim.label}</span>
                  <strong>{done}/{count}</strong>
                  <span className="overview-mini-track"><i style={{ width: `${count ? done / count * 100 : 0}%` }} /></span>
                </button>
              );
            })}
          </div>
          <p className="muted small">Você pode avançar por etapas, voltar e alterar qualquer resposta. O rascunho é salvo automaticamente.</p>
          <button type="button" className="primary" onClick={() => setStep(1)}>Começar registro</button>
        </section>
      )}

      {DIMENSIONS.filter(dim => (FORM_STEPS[step].dimensions as readonly string[]).includes(dim.key)).map(dim => (
        <DimensionSection
          key={dim.key}
          dim={dim}
          fields={fields}
          onScore={(k, v) => update(f => ({ ...f, scores: { ...f.scores, [k]: v } }))}
          onSleepHours={v => update(f => ({ ...f, sleep_hours: v }))}
          onNavigateIndicator={key => {
            const target = document.getElementById(`indicator-${key}`);
            target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
            (target?.querySelector('button, input') as HTMLElement | null)?.focus({ preventScroll: true });
          }}
        />
      ))}

      {step === FORM_STEPS.length - 1 && <>
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
      <section className="review-summary">
        <div className="review-summary-heading">
          <div>
            <h3>Revisão do registro</h3>
            <p>{filled} de {total} indicadores avaliados · {fields.sleep_hours === null ? 'Horas de sono pendentes' : `${fields.sleep_hours} h de sono`}</p>
          </div>
          <span className={missingFields.length === 0 ? 'review-status ready' : 'review-status'}>
            {missingFields.length === 0 ? 'Pronto para concluir' : `${missingFields.length} pendências`}
          </span>
        </div>
        {missingFields.length > 0 ? (
          <div className="review-pending">
            <h4>O que falta preencher</h4>
            <p>Selecione um item para voltar diretamente ao ponto que precisa de atenção.</p>
            {DIMENSIONS.map(dim => {
              const missing = dim.indicators.filter(ind => fields.scores[ind.key] === null);
              const target = FORM_STEPS.findIndex(item => (item.dimensions as readonly string[]).includes(dim.key));
              const sleepMissing = dim.key === 'sleep' && fields.sleep_hours === null;
              if (missing.length === 0 && !sleepMissing) return null;
              return (
                <div className="review-pending-group" key={dim.key}>
                  <button type="button" className="review-pending-dimension" onClick={() => setStep(target)}>
                    <strong>{dim.label}</strong>
                    <span>{missing.length + Number(sleepMissing)} pendente(s) · abrir dimensão →</span>
                  </button>
                  {sleepMissing && (
                    <button type="button" className="review-pending-item" onClick={() => {
                      setPendingIndicatorKey('sleep_hours');
                      setStep(target);
                    }}>
                      Horas de sono <span>Não informado · ir para o campo</span>
                    </button>
                  )}
                  {missing.map(ind => (
                    <button type="button" className="review-pending-item" key={ind.key} onClick={() => {
                      setPendingIndicatorKey(ind.key);
                      setStep(target);
                    }}>
                      {ind.label} <span>Não avaliado · abrir indicador</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {(fields.events_context.trim() === '' || fields.behavior_notes.trim() === '') && (
              <div className="review-pending-group">
                <strong>Narrativa e contexto</strong>
                {fields.events_context.trim() === '' && <button type="button" className="review-pending-item" onClick={() => setStep(FORM_STEPS.length - 1)}>Acontecimentos e contexto <span>Pendente · preencher narrativa</span></button>}
                {fields.behavior_notes.trim() === '' && <button type="button" className="review-pending-item" onClick={() => setStep(FORM_STEPS.length - 1)}>Observações sobre seu comportamento <span>Pendente · preencher narrativa</span></button>}
              </div>
            )}
          </div>
        ) : (
          <p className="review-all-complete">Todos os campos obrigatórios foram preenchidos. Revise as respostas e confirme a conclusão quando estiver pronto.</p>
        )}
        <div className="review-dimensions">
          {DIMENSIONS.map(dim => {
            const done = dim.indicators.filter(ind => fields.scores[ind.key] !== null).length
              + (dim.key === 'sleep' && fields.sleep_hours !== null ? 1 : 0);
            const count = dim.indicators.length + (dim.key === 'sleep' ? 1 : 0);
            const target = FORM_STEPS.findIndex(item => (item.dimensions as readonly string[]).includes(dim.key));
            return <button key={dim.key} type="button" className="link" onClick={() => setStep(target)}>{dim.label}: {done}/{count} · revisar</button>;
          })}
        </div>
      </section>
      </>}

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
        <div className="step-actions">
          <button type="button" className="secondary" onClick={() => setStep(current => Math.max(0, current - 1))} disabled={step === 0}>
            Voltar
          </button>
          {step < FORM_STEPS.length - 1 ? (
            <button type="button" className="primary" onClick={() => setStep(current => Math.min(FORM_STEPS.length - 1, current + 1))}>
              {step === 0 ? 'Começar registro' : 'Próxima etapa'}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => setConfirmCompletion(true)}
              disabled={status === 'complete' || saveState === 'saving' || offlineConflict}
            >
              Revisar e concluir
            </button>
          )}
        </div>
      </footer>

      {confirmCompletion && status !== 'complete' && (
        <div className="completion-backdrop">
          <section className="completion-dialog" role="dialog" aria-modal="true" aria-labelledby="completion-dialog-title" aria-describedby="completion-dialog-description">
            <span className="eyebrow">ÚLTIMA ETAPA</span>
            <h3 id="completion-dialog-title">Concluir o registro deste dia?</h3>
            <p id="completion-dialog-description">Você preencheu {completedRequired} de {totalRequired} campos obrigatórios. Ao confirmar, este dia será marcado como concluído. Você ainda poderá voltar e editar as respostas depois.</p>
            <div className="completion-dialog-actions">
              <button type="button" className="secondary" onClick={() => setConfirmCompletion(false)} disabled={saveState === 'saving'}>Continuar revisando</button>
              <button type="button" className="primary" onClick={() => void onComplete()} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Concluindo…' : 'Confirmar conclusão'}
              </button>
            </div>
          </section>
        </div>
      )}
    </form>
  );
}

function DimensionSection({
  dim, fields, onScore, onSleepHours, onNavigateIndicator,
}: {
  dim: Dimension;
  fields: DraftFields;
  onScore: (key: string, value: number | null) => void;
  onSleepHours: (v: number | null) => void;
  onNavigateIndicator: (key: string) => void;
}) {
  const filled = dim.indicators.filter(i => fields.scores[i.key] != null).length;
  const isSleep = dim.key === 'sleep';
  const sleepDone = fields.sleep_hours !== null;

  return (
    <details className="dimension" open>
      <summary>
        <span className="dimension-summary-copy">
          <strong>{dim.label}</strong>
          <small>{filled + (isSleep && sleepDone ? 1 : 0)} de {dim.indicators.length + (isSleep ? 1 : 0)} avaliados</small>
        </span>
        <span className="dimension-summary-status">
          <span className="dimension-summary-track"><i style={{ width: `${(filled + (isSleep && sleepDone ? 1 : 0)) / (dim.indicators.length + (isSleep ? 1 : 0)) * 100}%` }} /></span>
          <span className="count">{filled + (isSleep && sleepDone ? 1 : 0)}/{dim.indicators.length + (isSleep ? 1 : 0)}</span>
        </span>
      </summary>

      {isSleep && (
        <label className="hours">
          Horas dormidas
          <input
            id="indicator-sleep_hours"
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

      {dim.indicators.map((ind, index) => (
        <ScoreInput
          key={ind.key}
          indicator={ind}
          value={fields.scores[ind.key] ?? null}
          onChange={v => onScore(ind.key, v)}
          hasPrevious={index > 0}
          hasNext={index < dim.indicators.length - 1}
          onPrevious={() => onNavigateIndicator(dim.indicators[index - 1]?.key)}
          onNext={() => onNavigateIndicator(dim.indicators[index + 1]?.key)}
        />
      ))}
    </details>
  );
}

function ScoreInput({
  indicator, value, onChange, hasPrevious, hasNext, onPrevious, onNext,
}: {
  indicator: Indicator;
  value: number | null;
  onChange: (v: number | null) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { key, label, scaleLow, scaleHigh, scaleKind } = indicator;
  const hintId = `scale-hint-${key}`;
  return (
    <fieldset id={`indicator-${key}`} className={value === null ? 'score score-unset' : 'score score-set'}>
      <legend className="score-legend">{label}</legend>
      <div className="score-head">
        <span className="score-kind">{scaleKind === 'intensidade' ? 'Intensidade' : scaleKind === 'capacidade' ? 'Capacidade' : scaleKind === 'qualidade' ? 'Qualidade' : 'Frequência'}</span>
        <output className={value === null ? 'score-value unset' : 'score-value'} htmlFor={key} aria-live="polite">
          {value === null ? 'Não avaliado' : `${value} / 10`}
        </output>
      </div>
      <p className="score-meaning">
        {scaleKind === 'intensidade' && 'Indica o quanto essa experiência esteve presente ou foi intensa. Uma pontuação alta não significa algo positivo ou negativo.'}
        {scaleKind === 'capacidade' && 'Indica como você percebeu sua capacidade neste aspecto: valores maiores representam maior capacidade percebida.'}
        {scaleKind === 'qualidade' && 'Indica sua percepção de qualidade: valores maiores representam uma experiência melhor neste aspecto.'}
        {scaleKind === 'frequencia' && 'Indica com que frequência isso aconteceu: valores maiores representam mais ocorrências.'}
      </p>
      <div className="score-options" role="group" aria-label={`Selecione um valor de 0 a 10 para ${label}`} aria-describedby={hintId}>
        {Array.from({ length: 11 }, (_, score) => (
          <button
            key={score}
            type="button"
            className={value === score ? 'score-option selected' : 'score-option'}
            aria-pressed={value === score}
            aria-label={`${score} de 10`}
            onClick={() => onChange(score)}
          >
            {score}
          </button>
        ))}
      </div>
      <div className="scale-endpoints" id={hintId}>
        <span>0 · {scaleLow}</span>
        <span className="scale-midpoint">5</span>
        <span>10 · {scaleHigh}</span>
      </div>
      {value === null ? (
        <p className="score-unset-hint">Selecione um valor. Se não conseguir avaliar, mantenha sem preenchimento.</p>
      ) : (
        <button type="button" className="link clear-score" onClick={() => onChange(null)} aria-label={`Limpar avaliação de ${label}`}>Limpar avaliação</button>
      )}
      <div className="indicator-navigation" aria-label={`Navegação a partir de ${label}`}>
        <button type="button" className="link" onClick={onPrevious} disabled={!hasPrevious}>← Indicador anterior</button>
        <button type="button" className="link" onClick={onNext} disabled={!hasNext}>Próximo indicador →</button>
      </div>
    </fieldset>
  );
}
