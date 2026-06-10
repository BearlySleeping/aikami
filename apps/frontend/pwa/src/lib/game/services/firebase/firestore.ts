// apps/frontend/pwa/src/lib/game/services/firebase/firestore.ts
/**
 * Firestore REST API client for the game — no Firebase SDK.
 * Lightweight wrapper over the Firestore v1 REST API.
 */

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/game/core/base_game_class.ts';
import { getConfig } from './config.ts';
import type { FirebaseHttpClientInterface } from './http_client.ts';

/**
 * A Firestore document value (wrapped for REST API).
 */
type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values: FirestoreValue[] } }
  | { timestampValue: string }
  | { nullValue: null };

/**
 * Raw Firestore document shape from REST API.
 */
export type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

export type FirebaseFirestoreOptions = BaseGameClassOptions & {
  http: FirebaseHttpClientInterface;
};

export type FirebaseFirestoreInterface = BaseGameClassInterface & {
  getDocument<T = Record<string, unknown>>(path: string): Promise<T | null>;
  setDocument(path: string, data: Record<string, unknown>): Promise<boolean>;
  deleteDocument(path: string): Promise<boolean>;
  queryDocuments<T = Record<string, unknown>>(
    collection: string,
    field: string,
    value: string,
  ): Promise<T[]>;
};

/**
 * Service for Firestore document operations via REST API.
 */
class FirebaseFirestore
  extends BaseGameClass<FirebaseFirestoreOptions>
  implements FirebaseFirestoreInterface
{
  private readonly _http: FirebaseHttpClientInterface;

  constructor(options: FirebaseFirestoreOptions) {
    super(options);
    this._http = options.http;
  }

  /**
   * Reads a document from Firestore.
   * @param path - Document path (e.g. "games/abc123/saves/user456")
   * @returns Parsed document or null if not found
   */
  async getDocument<T = Record<string, unknown>>(path: string): Promise<T | null> {
    const config = getConfig();
    const url = `${config.firestoreEndpoint}/${path}`;

    try {
      const result = await this._http.get(url);
      if (result.status === 404) {
        return null;
      }

      const doc = result.body as FirestoreDocument;
      if (!doc.fields) {
        return null;
      }

      return this._unpackFields(doc.fields) as T;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Creates or overwrites a document in Firestore.
   * @param path - Document path
   * @param data - Plain object to store
   * @returns Whether the operation succeeded
   */
  async setDocument(path: string, data: Record<string, unknown>): Promise<boolean> {
    const config = getConfig();
    const url = `${config.firestoreEndpoint}/${path}`;

    try {
      const result = await this._http.patch(url, {
        fields: this._packFields(data),
      });
      return result.status >= 200 && result.status < 300;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Deletes a document from Firestore.
   * @param path - Document path
   * @returns Whether the operation succeeded
   */
  async deleteDocument(path: string): Promise<boolean> {
    const config = getConfig();
    const url = `${config.firestoreEndpoint}/${path}`;

    try {
      const result = await this._http.delete(url);
      return result.status >= 200 && result.status < 300;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Queries documents from a Firestore collection.
   * @param collection - Collection path
   * @param field - Field name to filter on
   * @param value - Value to match
   * @returns Array of matching documents
   */
  async queryDocuments<T = Record<string, unknown>>(
    collection: string,
    field: string,
    value: string,
  ): Promise<T[]> {
    const config = getConfig();
    const url = `${config.firestoreEndpoint}:runQuery`;

    try {
      const result = await this._http.post(url, {
        structuredQuery: {
          from: [{ collectionId: collection.split('/').pop() || collection }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: 'EQUAL',
              value: { stringValue: value },
            },
          },
        },
      });

      const body = result.body as Array<{ document?: FirestoreDocument }> | undefined;
      if (!body || !Array.isArray(body)) {
        return [];
      }

      return body
        .filter((d) => d.document?.fields != null)
        .map((d) => this._unpackFields(d.document?.fields ?? {}) as T);
    } catch (_err) {
      return [];
    }
  }

  override async setup(): Promise<void> {}

  /**
   * Packs a plain JS object into Firestore REST field format.
   */
  private _packFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, value] of Object.entries(data)) {
      fields[key] = this._packValue(value);
    }
    return fields;
  }

  /**
   * Packs a single value into Firestore REST format.
   */
  private _packValue(value: unknown): FirestoreValue {
    if (value === null || value === undefined) {
      return { nullValue: null };
    }
    if (typeof value === 'string') {
      return { stringValue: value };
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === 'boolean') {
      return { booleanValue: value };
    }
    if (value instanceof Date) {
      return { timestampValue: value.toISOString() };
    }
    if (Array.isArray(value)) {
      return {
        arrayValue: { values: value.map((v) => this._packValue(v)) },
      };
    }
    if (typeof value === 'object') {
      return {
        mapValue: { fields: this._packFields(value as Record<string, unknown>) },
      };
    }
    return { stringValue: String(value) };
  }

  /**
   * Unpacks Firestore REST field format into a plain JS object.
   */
  private _unpackFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      result[key] = this._unpackValue(value);
    }
    return result;
  }

  /**
   * Unpacks a single Firestore REST value into a JS value.
   */
  private _unpackValue(value: FirestoreValue): unknown {
    if ('stringValue' in value) {
      return value.stringValue;
    }
    if ('integerValue' in value) {
      return Number.parseInt(value.integerValue, 10);
    }
    if ('doubleValue' in value) {
      return value.doubleValue;
    }
    if ('booleanValue' in value) {
      return value.booleanValue;
    }
    if ('nullValue' in value) {
      return null;
    }
    if ('timestampValue' in value) {
      return new Date(value.timestampValue);
    }
    if ('mapValue' in value) {
      return this._unpackFields(value.mapValue.fields);
    }
    if ('arrayValue' in value) {
      return value.arrayValue.values.map((v) => this._unpackValue(v));
    }
    return null;
  }
}

export const getFirebaseFirestore = (
  options: FirebaseFirestoreOptions,
): FirebaseFirestoreInterface => new FirebaseFirestore(options);
