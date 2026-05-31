// apps/frontend/game/src/core/firebase/firebase_app.ts
/**
 * Firebase application facade — wires up all REST-based Firebase services.
 * Singleton pattern: call createFirebase() once, reuse the instance.
 */

import { FirebaseAuth } from './auth.ts';
import { type FirebaseConfig, getConfig } from './config.ts';
import { FirebaseFirestore } from './firestore.ts';
import { FirebaseFunctions } from './functions.ts';
import { FirebaseHttpClient } from './http_client.ts';
import { FirebaseStorage } from './storage.ts';

/**
 * Firebase application instance with all REST-based services.
 */
export class FirebaseApp {
  readonly config: FirebaseConfig;
  readonly http: FirebaseHttpClient;
  readonly auth: FirebaseAuth;
  readonly firestore: FirebaseFirestore;
  readonly storage: FirebaseStorage;
  readonly functions: FirebaseFunctions;

  constructor() {
    this.config = getConfig();
    this.http = new FirebaseHttpClient({ apiKey: this.config.apiKey });
    this.auth = new FirebaseAuth(this.http);
    this.firestore = new FirebaseFirestore(this.http);
    this.storage = new FirebaseStorage(this.http);
    this.functions = new FirebaseFunctions(this.http);
  }

  /** Whether running against Firebase emulators. */
  get isEmulator(): boolean {
    return this.config.isEmulator;
  }
}

let _instance: FirebaseApp | undefined;

/**
 * Creates or returns the singleton Firebase application instance.
 */
export const createFirebase = (): FirebaseApp => {
  if (!_instance) {
    _instance = new FirebaseApp();
  }
  return _instance;
};

/**
 * Returns the current Firebase instance (or creates one if needed).
 */
export const getFirebase = (): FirebaseApp => createFirebase();
