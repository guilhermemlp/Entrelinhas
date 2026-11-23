import { z } from 'zod';
import { INDICATOR_KEYS, ALL_INDICATORS, INDICATOR_LABEL } from './indicators';

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
export const score = z.number().int().min(0).max(10);

// Campos editáveis de um registro. Pontuações podem ser null (rascunho).
export const draftSchema = z.object({
  sleep_hours: z.number().min(0).max(24).multipleOf(0.25).nullable(),
  sleep_notes: z.string().max(2000),
  events_context: z.string().max(5000),
  behavior_notes: z.string().max(5000),
  scores: z.record(z.string(), score.nullable()),
}).superRefine((v, ctx) => {
  for (const k of Object.keys(v.scores)) {
    if (!INDICATOR_KEYS.includes(k)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Indicador desconhecido: ${k}` });
    }
  }
});

export type DraftFields = z.infer<typeof draftSchema>;

// Lista do que falta para concluir. A regra final é reaplicada no banco
// (complete_entry); aqui só dá feedback antes da chamada.
export function missingForComplete(v: DraftFields): string[] {
  const missing: string[] = [];
  if (v.sleep_hours === null) missing.push('Horas de sono');
  for (const ind of ALL_INDICATORS) {
    if (v.scores[ind.key] == null) missing.push(`Indicador: ${INDICATOR_LABEL[ind.key]}`);
  }
  if (v.events_context.trim() === '') missing.push('Acontecimentos e contexto');
  if (v.behavior_notes.trim() === '') missing.push('Observações sobre seu comportamento');
  return missing;
}

// Registro completo como vem do backup ou da exportação.
export const exportEntrySchema = z.object({
  entry_date: dateKey,
  status: z.enum(['draft', 'complete']),
  sleep_hours: z.number().min(0).max(24).nullable(),
  sleep_notes: z.string().max(2000),
  events_context: z.string().max(5000),
  behavior_notes: z.string().max(5000),
  scores: z.record(z.string(), score.nullable()),
}).superRefine((v, ctx) => {
  for (const k of Object.keys(v.scores)) {
    if (!INDICATOR_KEYS.includes(k)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Indicador desconhecido: ${k}` });
    }
  }
  if (v.status === 'complete' && missingForComplete({ ...v, scores: v.scores }).length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Registro ${v.entry_date} marcado como concluído, mas incompleto` });
  }
});

export type ExportEntry = z.infer<typeof exportEntrySchema>;

export const backupSchema = z.object({
  schema_version: z.literal(1),
  exported_at: z.string().optional(),
  entries: z.array(exportEntrySchema),
});
