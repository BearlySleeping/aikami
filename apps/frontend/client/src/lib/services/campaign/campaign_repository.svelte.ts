// apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts
//
// IndexedDB-backed repository for Campaign aggregate persistence.
// Shares the aikami_saves database with gameSaveService.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine

import type { Campaign } from '@aikami/types';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name — shared with gameSaveService. */
const DB_NAME = 'aikami_saves';

/** Database version — bumped to 2 to add the campaigns object store. */
const DB_VERSION = 2;

/** Object store name for campaign documents. */
const STORE_NAME = 'campaigns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal IndexedDB document shape. */
type CampaignDocument = {
  /** Same as Campaign.id — used as the object store key. */
  id: string;
  /** Full campaign data stored as a JSON string. */
  data: string;
  /** ISO timestamp of last update — used for sorting. */
  updatedAt: string;
};

export type CampaignRepositoryInterface = {
  /** Persists a campaign (upsert by ID). */
  create(campaign: Campaign): Promise<Campaign>;
  /** Retrieves a campaign by ID, or undefined if not found. */
  getById(id: string): Promise<Campaign | undefined>;
  /** Retrieves all campaigns, sorted by updatedAt descending (newest first). */
  getAll(): Promise<Campaign[]>;
  /** Updates an existing campaign (throws if not found). */
  update(campaign: Campaign): Promise<Campaign>;
  /** Deletes a campaign by ID. */
  delete(id: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Repository Implementation
// ---------------------------------------------------------------------------

class CampaignRepository implements CampaignRepositoryInterface {
  /** @inheritdoc */
  async create(campaign: Campaign): Promise<Campaign> {
    const db = await this._openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      await this._putDocument(store, campaign);
      return campaign;
    } finally {
      db.close();
    }
  }

  /** @inheritdoc */
  async getById(id: string): Promise<Campaign | undefined> {
    const db = await this._openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const doc = await this._getDocument(store, id);
      return doc;
    } finally {
      db.close();
    }
  }

  /** @inheritdoc */
  async getAll(): Promise<Campaign[]> {
    const db = await this._openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = (): void => {
          const docs = request.result as CampaignDocument[];
          const campaigns = docs.map((d) => JSON.parse(d.data) as Campaign);
          // Sort by updatedAt descending (newest first)
          campaigns.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          resolve(campaigns);
        };
        request.onerror = (): void => {
          reject(request.error ?? new Error('IndexedDB getAll failed'));
        };
      });
    } finally {
      db.close();
    }
  }

  /** @inheritdoc */
  async update(campaign: Campaign): Promise<Campaign> {
    const db = await this._openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const existing = await this._getDocument(store, campaign.id);
      if (!existing) {
        throw new Error(`Campaign not found: ${campaign.id}`);
      }
      await this._putDocument(store, campaign);
      return campaign;
    } finally {
      db.close();
    }
  }

  /** @inheritdoc */
  async delete(id: string): Promise<void> {
    const db = await this._openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      await this._deleteDocument(store, id);
    } finally {
      db.close();
    }
  }

  // -----------------------------------------------------------------------
  // Private: IndexedDB helpers
  // -----------------------------------------------------------------------

  /** Opens the IndexedDB database, handling version upgrades. */
  private _openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (): void => {
        const db = request.result;
        // Ensure the legacy saves store exists (gameSaveService v1 creates it)
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'id' });
        }
        // Create the campaigns store if it doesn't exist (v2 migration)
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (): void => {
        resolve(request.result);
      };

      request.onerror = (): void => {
        logger.error('CampaignRepository: failed to open IndexedDB', request.error);
        reject(request.error ?? new Error('IndexedDB open failed'));
      };
    });
  }

  /** Stores a campaign document in the object store. */
  private _putDocument(store: IDBObjectStore, campaign: Campaign): Promise<void> {
    const doc: CampaignDocument = {
      id: campaign.id,
      data: JSON.stringify(campaign),
      updatedAt: campaign.updatedAt,
    };

    return new Promise((resolve, reject) => {
      const request = store.put(doc);
      request.onsuccess = (): void => resolve();
      request.onerror = (): void => reject(request.error ?? new Error('IndexedDB put failed'));
    });
  }

  /** Retrieves a campaign document from the object store. */
  private _getDocument(store: IDBObjectStore, id: string): Promise<Campaign | undefined> {
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = (): void => {
        const doc = request.result as CampaignDocument | undefined;
        if (!doc) {
          resolve(undefined);
          return;
        }
        resolve(JSON.parse(doc.data) as Campaign);
      };
      request.onerror = (): void => reject(request.error ?? new Error('IndexedDB get failed'));
    });
  }

  /** Deletes a campaign document from the object store. */
  private _deleteDocument(store: IDBObjectStore, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = (): void => resolve();
      request.onerror = (): void => reject(request.error ?? new Error('IndexedDB delete failed'));
    });
  }
}

/** Shared singleton instance. */
export const campaignRepository: CampaignRepositoryInterface = new CampaignRepository();
