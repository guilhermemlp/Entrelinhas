import type { DraftFields } from '../domain/schemas';

export interface OfflineDraft {
  entryId: string;
  baseUpdatedAt: string;
  fields: DraftFields;
  savedAt: string;
}

const DB_NAME = 'entrelinhas-offline';
const STORE_NAME = 'pending-drafts';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador não oferece armazenamento offline.'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'entryId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir armazenamento offline.'));
    request.onblocked = () => reject(new Error('Armazenamento offline bloqueado por outra aba.'));
  });
}

export async function saveOfflineDraft(
  entryId: string,
  baseUpdatedAt: string,
  fields: DraftFields,
): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({
        entryId, baseUpdatedAt, fields, savedAt: new Date().toISOString(),
      } satisfies OfflineDraft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Falha ao guardar rascunho offline.'));
      tx.onabort = () => reject(tx.error ?? new Error('Gravação offline cancelada.'));
    });
  } finally {
    db.close();
  }
}

export async function getOfflineDraft(entryId: string): Promise<OfflineDraft | null> {
  const db = await openDatabase();
  try {
    return await new Promise<OfflineDraft | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(entryId);
      request.onsuccess = () => resolve((request.result as OfflineDraft | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Falha ao recuperar rascunho offline.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteOfflineDraft(entryId: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(entryId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Falha ao limpar rascunho offline.'));
      tx.onabort = () => reject(tx.error ?? new Error('Limpeza offline cancelada.'));
    });
  } finally {
    db.close();
  }
}
