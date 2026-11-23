import { INDICATOR_KEYS } from './indicators';
import { backupSchema, type ExportEntry } from './schemas';

// Células de texto que começam com = + - @ podem ser interpretadas como
// fórmula ao abrir o CSV no Excel/Sheets (CSV injection). Neutraliza-se com
// apóstrofo. Só afeta a exportação; o dado original permanece intacto.
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  'entry_date', 'status', 'sleep_hours', 'sleep_notes',
  'events_context', 'behavior_notes', ...INDICATOR_KEYS,
];

export function toCsv(entries: ExportEntry[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const e of entries) {
    lines.push([
      e.entry_date, e.status, e.sleep_hours, e.sleep_notes,
      e.events_context, e.behavior_notes,
      ...INDICATOR_KEYS.map(k => e.scores[k] ?? null),
    ].map(csvCell).join(','));
  }
  // BOM para o Excel reconhecer UTF-8 com acentos
  return '\uFEFF' + lines.join('\r\n');
}

export function toBackupJson(entries: ExportEntry[]): string {
  return JSON.stringify(
    { schema_version: 1, exported_at: new Date().toISOString(), entries },
    null,
    2,
  );
}

// Lê e valida um arquivo de backup. Lança erro legível se estiver inválido:
// nunca importa dados parcialmente validados.
export function parseBackup(text: string): ExportEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? ` (em ${first.path.join('.')})` : '';
    throw new Error(`Backup inválido: ${first.message}${where}`);
  }
  return parsed.data.entries;
}
