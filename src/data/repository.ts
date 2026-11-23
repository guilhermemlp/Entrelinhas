import { supabase } from '../lib/supabase';
import { INDICATOR_KEYS } from '../domain/indicators';
import type { DraftFields } from '../domain/schemas';
import type { DayRecord } from '../domain/analysis';
import type { ExportEntry } from '../domain/schemas';

export interface EntryRow {
  id: string;
  entry_date: string;
  sleep_hours: number | null;
  sleep_notes: string;
  events_context: string;
  behavior_notes: string;
  status: 'draft' | 'complete';
  updated_at: string;
}

export interface LoadedEntry extends EntryRow {
  scores: Record<string, number | null>;
}

// Conflito de edição: o registro foi alterado (outro dispositivo/aba)
// desde que foi carregado. Nunca sobrescrevemos silenciosamente.
export class ConflictError extends Error {
  constructor() {
    super('Este registro foi alterado em outro lugar. Recarregue antes de continuar.');
  }
}

function emptyScores(): Record<string, number | null> {
  return Object.fromEntries(INDICATOR_KEYS.map(k => [k, null]));
}

async function fetchScores(entryId: string): Promise<Record<string, number | null>> {
  const { data, error } = await supabase
    .from('indicator_score').select('indicator, score').eq('entry_id', entryId);
  if (error) throw error;
  const scores = emptyScores();
  for (const row of data ?? []) scores[row.indicator] = row.score;
  return scores;
}

// Carrega o registro da data, criando o rascunho se ainda não existir.
// Trata a corrida de dois inserts simultâneos (unique violation 23505).
export async function getOrCreateEntry(date: string): Promise<LoadedEntry> {
  let { data, error } = await supabase
    .from('daily_entry').select('*').eq('entry_date', date).maybeSingle();
  if (error) throw error;

  if (!data) {
    const ins = await supabase
      .from('daily_entry').insert({ entry_date: date }).select('*').single();
    if (ins.error) {
      if (ins.error.code !== '23505') throw ins.error;
      const again = await supabase
        .from('daily_entry').select('*').eq('entry_date', date).single();
      if (again.error) throw again.error;
      data = again.data;
    } else {
      data = ins.data;
    }
  }

  return { ...(data as EntryRow), scores: await fetchScores(data!.id) };
}

// Salva os campos e as pontuações. Retorna o novo updated_at, que o chamador
// deve guardar para o próximo salvamento (controle otimista).
export async function saveDraft(entry: LoadedEntry, draft: DraftFields): Promise<string> {
  const { data, error } = await supabase.rpc('save_entry_draft', {
    p_entry_id: entry.id,
    p_expected_updated_at: entry.updated_at,
    p_payload: {
      sleep_hours: draft.sleep_hours,
      sleep_notes: draft.sleep_notes,
      events_context: draft.events_context,
      behavior_notes: draft.behavior_notes,
      scores: draft.scores,
    },
  });
  if (error) {
    if (error.message.toLowerCase().includes('conflito')) throw new ConflictError();
    throw error;
  }
  if (typeof data !== 'string') throw new Error('O banco não confirmou o salvamento.');
  return data;
}

// Conclusão: a regra é validada no banco (função complete_entry).
export async function completeEntry(entryId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_entry', { p_entry_id: entryId });
  if (error) throw error;
}

// Lista registros em um intervalo, já no formato usado pela análise.
export async function listDays(from: string, to: string): Promise<{
  entries: LoadedEntry[];
  records: Map<string, DayRecord>;
}> {
  const { data, error } = await supabase
    .from('daily_entry')
    .select('*, indicator_score(indicator, score)')
    .gte('entry_date', from)
    .lte('entry_date', to)
    .order('entry_date', { ascending: true });
  if (error) throw error;

  const entries: LoadedEntry[] = [];
  const records = new Map<string, DayRecord>();
  for (const row of data ?? []) {
    const scores = emptyScores();
    const joined = (row.indicator_score ?? []) as { indicator: string; score: number | null }[];
    for (const s of joined) scores[s.indicator] = s.score;
    const entry = row as unknown as EntryRow & { indicator_score?: unknown };
    delete entry.indicator_score;
    entries.push({ ...(entry as EntryRow), scores });
    records.set(entry.entry_date, {
      date: entry.entry_date,
      status: entry.status,
      sleep_hours: entry.sleep_hours,
      scores,
    });
  }
  return { entries, records };
}

// Todos os registros para exportação, no formato do backup.
export async function fetchAllForExport(): Promise<ExportEntry[]> {
  const { entries } = await listDays('0001-01-01', '9999-12-31');
  return entries.map(e => ({
    entry_date: e.entry_date,
    status: e.status,
    sleep_hours: e.sleep_hours,
    sleep_notes: e.sleep_notes,
    events_context: e.events_context,
    behavior_notes: e.behavior_notes,
    scores: e.scores,
  }));
}

// Restauração atômica no banco: ou o lote inteiro é importado, ou nada é alterado.
// Dias existentes são preservados e retornados como ignorados.
export async function restoreEntries(entries: ExportEntry[]): Promise<{
  imported: number;
  skipped: string[];
}> {
  const { data, error } = await supabase.rpc('restore_entries', {
    p_entries: entries,
  });
  if (error) throw error;
  if (!data || typeof data.imported !== 'number' || !Array.isArray(data.skipped)) {
    throw new Error('O banco retornou uma confirmação de restauração inválida.');
  }
  return {
    imported: data.imported,
    skipped: data.skipped.map((date: string) => String(date)),
  };
}

// Apagamento total do próprio usuário (LGPD: eliminação). Ação explícita.
export async function eraseMyData(): Promise<void> {
  const { error } = await supabase.rpc('erase_my_data');
  if (error) throw error;
}
