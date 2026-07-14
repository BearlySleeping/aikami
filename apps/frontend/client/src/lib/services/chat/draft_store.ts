// apps/frontend/client/src/lib/services/chat/draft_store.ts
//
// IndexedDB-backed draft persistence for chat inputs.
// Per-chat drafts are saved on input change and restored when a chat
// is opened. Cleared on message send.
//
// Contract: C-231 AC-2 Input Draft Persistence

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { logger } from '$logger';

// ── Constants ────────────────────────────────────────────────────────────

const DB_NAME = 'aikami-chat-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

// ── Types ────────────────────────────────────────────────────────────────

/** IndexedDB record shape for a chat input draft. */
type DraftRecord = {
  chatId: string;
  text: string;
  updatedAt: number;
};

// ── Service Interface ────────────────────────────────────────────────────

export type DraftStoreInterface = BaseFrontendClassInterface & {
  /** Saves or updates a draft for the given chat. */
  saveDraft(options: { chatId: string; text: string }): Promise<void>;
  /** Loads the draft text for the given chat, or empty string if none. */
  loadDraft(options: { chatId: string }): Promise<string>;
  /** Removes the draft for the given chat (called on send). */
  clearDraft(options: { chatId: string }): Promise<void>;
  /** Removes drafts for chat IDs that are no longer active. */
  deleteOrphanedDrafts(options: { activeChatIds: string[] }): Promise<void>;
};

// ── Implementation ───────────────────────────────────────────────────────

class DraftStore
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements DraftStoreInterface
{
  private _db: IDBDatabase | null = null;
  private _dbReady: Promise<IDBDatabase> | null = null;

  /**
   * Opens the IndexedDB database, creating the object store if needed.
   * Caches the connection for the lifetime of the service.
   */
  private _getDb(): Promise<IDBDatabase> {
    if (this._db) {
      return Promise.resolve(this._db);
    }
    if (this._dbReady) {
      return this._dbReady;
    }

    this._dbReady = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'chatId' });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this._db = db;
        db.onclose = () => {
          this._db = null;
          this._dbReady = null;
        };
        resolve(db);
      };

      request.onerror = (event) => {
        const error = (event.target as IDBOpenDBRequest).error;
        logger.error('DraftStore: failed to open IndexedDB', error);
        reject(error);
      };
    });

    return this._dbReady;
  }

  /** Wraps an IDBRequest in a Promise with type safety. */
  private _promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async saveDraft(options: { chatId: string; text: string }): Promise<void> {
    const { chatId, text } = options;
    const db = await this._getDb();
    const record: DraftRecord = {
      chatId,
      text,
      updatedAt: Date.now(),
    };
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await this._promisify(store.put(record));
  }

  async loadDraft(options: { chatId: string }): Promise<string> {
    const { chatId } = options;
    const db = await this._getDb();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const record = await this._promisify(store.get(chatId) as IDBRequest<DraftRecord | undefined>);
    return record?.text ?? '';
  }

  async clearDraft(options: { chatId: string }): Promise<void> {
    const { chatId } = options;
    const db = await this._getDb();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await this._promisify(store.delete(chatId));
  }

  async deleteOrphanedDrafts(options: { activeChatIds: string[] }): Promise<void> {
    const { activeChatIds } = options;
    const activeSet = new Set(activeChatIds);
    const db = await this._getDb();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const allRecords = await this._promisify(store.getAll() as IDBRequest<DraftRecord[]>);

    for (const record of allRecords) {
      if (!activeSet.has(record.chatId)) {
        await this._promisify(store.delete(record.chatId));
      }
    }
  }

  override async dispose(): Promise<void> {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._dbReady = null;
    }
    await super.dispose();
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const draftStore: DraftStoreInterface = DraftStore.create({
  className: 'DraftStore',
});
