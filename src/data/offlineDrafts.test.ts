import { afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { INDICATOR_KEYS } from '../domain/indicators';
import { deleteOfflineDraft, getOfflineDraft, saveOfflineDraft } from './offlineDrafts';
import type { DraftFields } from '../domain/schemas';

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { indexedDB: globalThis.indexedDB },
});

const fields = (score: number | null): DraftFields => ({
  sleep_hours: 7.5,
  sleep_notes: 'Sono de teste',
  events_context: 'Dia de teste',
  behavior_notes: 'Observação local',
  scores: Object.fromEntries(INDICATOR_KEYS.map(key => [key, score])),
});

const DB_NAME = 'entrelinhas-offline';

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion blocked'));
  });
});

describe('persistência de rascunhos offline (IndexedDB)', () => {
  it('guarda e recupera todas as respostas e a versão-base', async () => {
    await saveOfflineDraft('entry-a', '2026-11-24T10:00:00.000Z', fields(4));

    const recovered = await getOfflineDraft('entry-a');

    expect(recovered).not.toBeNull();
    expect(recovered?.baseUpdatedAt).toBe('2026-11-24T10:00:00.000Z');
    expect(recovered?.fields.sleep_hours).toBe(7.5);
    expect(Object.keys(recovered!.fields.scores)).toHaveLength(45);
    expect(recovered?.fields.scores.tristeza).toBe(4);
    expect(recovered?.savedAt).toBeTruthy();
  });

  it('mantém registros de dias diferentes isolados', async () => {
    await saveOfflineDraft('entry-a', 'v1', fields(2));
    await saveOfflineDraft('entry-b', 'v8', fields(8));

    expect((await getOfflineDraft('entry-a'))?.fields.scores.tristeza).toBe(2);
    expect((await getOfflineDraft('entry-b'))?.fields.scores.tristeza).toBe(8);
  });

  it('substitui a versão local pela edição mais recente sem perder a versão-base', async () => {
    await saveOfflineDraft('entry-a', 'server-v1', fields(3));
    await saveOfflineDraft('entry-a', 'server-v2', fields(9));

    const recovered = await getOfflineDraft('entry-a');
    expect(recovered?.baseUpdatedAt).toBe('server-v2');
    expect(recovered?.fields.scores.tristeza).toBe(9);
  });

  it('remove a cópia local depois de sincronização confirmada', async () => {
    await saveOfflineDraft('entry-a', 'server-v1', fields(6));
    await deleteOfflineDraft('entry-a');

    expect(await getOfflineDraft('entry-a')).toBeNull();
  });

  it('retorna null quando não existe cópia local', async () => {
    expect(await getOfflineDraft('missing-entry')).toBeNull();
  });
});
