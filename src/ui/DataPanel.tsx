import { useState } from 'react';
import { fetchAllForExport, restoreEntries, eraseMyData } from '../data/repository';
import { toCsv, toBackupJson, parseBackup } from '../domain/export';
import { localDateKey } from '../domain/dates';

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

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await fn(); } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha inesperada.');
    } finally { setBusy(false); }
  }

  const stamp = localDateKey();

  return (
    <section className="data-panel">
      <h2>Exportar</h2>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => run(async () => {
          const entries = await fetchAllForExport();
          download(`diario-${stamp}.csv`, toCsv(entries), 'text/csv;charset=utf-8');
          setMessage(`${entries.length} registros exportados em CSV.`);
        })}>CSV</button>

        <button type="button" disabled={busy} onClick={() => run(async () => {
          const entries = await fetchAllForExport();
          download(`diario-${stamp}.json`, toBackupJson(entries), 'application/json');
          setMessage(`${entries.length} registros exportados em JSON (backup).`);
        })}>JSON (backup)</button>

        <button type="button" disabled={busy} onClick={() => window.print()}>
          Relatório (imprimir / salvar em PDF)
        </button>
      </div>

      <h2>Restaurar backup</h2>
      <p className="muted">
        Dias que já existem não são sobrescritos: são ignorados e listados abaixo.
      </p>
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
            const r = await restoreEntries(entries);
            setMessage(
              `Importados: ${r.imported}. Ignorados (já existiam): ${r.skipped.length}` +
              (r.skipped.length ? ` (${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? '…' : ''})` : ''),
            );
          });
          e.target.value = '';
        }}
      />

      <h2>Apagar meus dados</h2>
      <p className="muted">
        Remove permanentemente todos os seus registros e revisões. Não há recuperação
        pelo aplicativo. Faça um backup JSON antes.
      </p>
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

      {message && <p className="message">{message}</p>}
    </section>
  );
}
