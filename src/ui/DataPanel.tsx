import { useEffect, useState } from 'react';
import { DIMENSIONS } from '../domain/indicators';
import { fetchAllForExport, restoreEntries, eraseMyData } from '../data/repository';
import { toCsv, toBackupJson, parseBackup } from '../domain/export';
import { localDateKey } from '../domain/dates';
import type { ExportEntry } from '../domain/schemas';

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataPanel({ onSignOut }: { onSignOut: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [eraseText, setEraseText] = useState('');
  const [restorePreview, setRestorePreview] = useState<{ entries: ExportEntry[]; existingDates: string[]; fileName: string } | null>(null);
  const [reportEntries, setReportEntries] = useState<ExportEntry[] | null>(null);

  useEffect(() => {
    if (!reportEntries) return;
    const timer = window.setTimeout(() => window.print(), 250);
    const clear = () => setReportEntries(null);
    window.addEventListener('afterprint', clear);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', clear); };
  }, [reportEntries]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha inesperada.');
    } finally { setBusy(false); }
  }

  const stamp = localDateKey();

  return (
    <>
    <section className="data-panel">
      <header className="data-panel-header">
        <span className="eyebrow">CONTROLE DOS SEUS REGISTROS</span>
        <h1>Dados e configurações</h1>
        <p>Exporte uma cópia, restaure um backup ou revise as opções de gerenciamento dos seus dados.</p>
      </header>
      <section className="data-card">
        <div className="data-section-heading"><div><span className="eyebrow">PORTABILIDADE</span><h2>Exportar registros</h2></div><p>Escolha o formato adequado para guardar ou consultar seus dados fora do Entrelinhas.</p></div>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => run(async () => {
          const entries = await fetchAllForExport();
          download(`entrelinhas-${stamp}.csv`, toCsv(entries), 'text/csv;charset=utf-8');
          setMessage(`${entries.length} registros exportados em CSV.`);
        })}>CSV</button>

        <button type="button" disabled={busy} onClick={() => run(async () => {
          const entries = await fetchAllForExport();
          download(`entrelinhas-${stamp}.json`, toBackupJson(entries), 'application/json');
          setMessage(`${entries.length} registros exportados em JSON (backup).`);
        })}>JSON (backup)</button>

        <button type="button" disabled={busy} onClick={() => run(async () => {
          const entries = await fetchAllForExport();
          setReportEntries([...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date)));
        })}>
          Relatório estruturado (PDF)
        </button>
      </div>
      </section>

      <section className="data-card">
        <div className="data-section-heading"><div><span className="eyebrow">RECUPERAÇÃO</span><h2>Restaurar backup</h2></div><p>Dias que já existem não são sobrescritos: são ignorados e listados antes da confirmação.</p></div>
      <input
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            setMessage('O backup excede o limite de 10 MB.');
            e.target.value = '';
            return;
          }
          void run(async () => {
            const entries = parseBackup(await file.text());
            const current = await fetchAllForExport();
            const existing = new Set(current.map(entry => entry.entry_date));
            const existingDates = entries
              .filter(entry => existing.has(entry.entry_date))
              .map(entry => entry.entry_date);
            setRestorePreview({ entries, existingDates, fileName: file.name });
            setMessage('');
          });
          e.target.value = '';
        }}
      />
      {restorePreview && (
        <section className="restore-preview" aria-live="polite">
          <h3>Prévia do backup</h3>
          <p><strong>Arquivo:</strong> {restorePreview.fileName}</p>
          <p><strong>Registros no arquivo:</strong> {restorePreview.entries.length}</p>
          {restorePreview.entries.length > 0 && (
            <p><strong>Período:</strong> {restorePreview.entries[0].entry_date} a {restorePreview.entries[restorePreview.entries.length - 1].entry_date}</p>
          )}
          <p><strong>Datas que já existem e serão preservadas:</strong> {restorePreview.existingDates.length}</p>
          {restorePreview.existingDates.length > 0 && (
            <p className="muted">Não haverá sobrescrita. Datas: {restorePreview.existingDates.slice(0, 8).join(', ')}{restorePreview.existingDates.length > 8 ? '…' : ''}</p>
          )}
          <p className="muted">A restauração é enviada como uma única operação. Se houver um registro inválido, o banco rejeita o lote inteiro.</p>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy || restorePreview.entries.length === 0}
              onClick={() => run(async () => {
                const result = await restoreEntries(restorePreview.entries);
                setMessage(`Importados: ${result.imported}. Ignorados (já existiam): ${result.skipped.length}.`);
                setRestorePreview(null);
              })}
            >
              Confirmar restauração
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setRestorePreview(null)}>
              Cancelar
            </button>
          </div>
        </section>
      )}

      </section>

      <section className="data-card data-card-danger">
        <div className="data-section-heading"><div><span className="eyebrow">AÇÃO IRREVERSÍVEL</span><h2>Apagar meus dados</h2></div><p>Remove permanentemente todos os seus registros e revisões. Não há recuperação pelo aplicativo. Faça um backup JSON antes.</p></div>
      <div className="row">
        <input
          placeholder='Digite APAGAR para confirmar'
          value={eraseText}
          onChange={e => setEraseText(e.target.value)}
        />
        <button
          type="button"
          className="danger"
          disabled={busy || eraseText !== 'APAGAR'}
          onClick={() => run(async () => {
            await eraseMyData();
            onSignOut();
          })}
        >
          Apagar tudo
        </button>
      </div>

      {message && <p className="message" role="status" aria-live="polite">{message}</p>}
      </section>
    </section>
    {reportEntries && (
      <article className="print-report">
        <header>
          <h1>Entrelinhas</h1>
          <p>Relatório de observação longitudinal</p>
          <p>Gerado em {new Date().toLocaleString('pt-BR')}</p>
          <p>{reportEntries.length} registros · {reportEntries.length ? `${reportEntries[0].entry_date} a ${reportEntries[reportEntries.length - 1].entry_date}` : 'sem período'}</p>
        </header>
        {reportEntries.map(entry => (
          <section className="print-entry" key={entry.entry_date}>
            <h2>{new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
            <p>Status: {entry.status === 'complete' ? 'Concluído' : 'Rascunho'} · Sono: {entry.sleep_hours === null ? 'não informado' : `${entry.sleep_hours} horas`}</p>
            {DIMENSIONS.map(dim => (
              <div className="print-dimension" key={dim.key}>
                <h3>{dim.label}</h3>
                <dl>
                  {dim.indicators.map(ind => (
                    <div key={ind.key}>
                      <dt>{ind.label}</dt>
                      <dd>{entry.scores[ind.key] == null ? 'Não avaliado' : `${entry.scores[ind.key]} / 10`}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            {entry.events_context && <p><strong>Acontecimentos e contexto:</strong> {entry.events_context}</p>}
            {entry.behavior_notes && <p><strong>Observações sobre comportamento:</strong> {entry.behavior_notes}</p>}
            {entry.sleep_notes && <p><strong>Notas sobre sono:</strong> {entry.sleep_notes}</p>}
          </section>
        ))}
        <footer><small>Este relatório apresenta registros informados pelo usuário. Não constitui diagnóstico ou interpretação clínica.</small></footer>
      </article>
    )}
    </>
  );
}
