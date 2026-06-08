// apps/frontend/pwa/src/lib/client/game/services/firebase/firebase_app.ts
/**
 * Firebase application facade — wires up all REST-based Firebase services.
 * Singleton pattern: call createFirebase() once, reuse the instance.
 */

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/client/game/core/base_game_class.ts';
import type { FirebaseAuthInterface } from './auth.ts';
import { getFirebaseAuth } from './auth.ts';
import { type FirebaseConfig, getConfig } from './config.ts';
import type { FirebaseFirestoreInterface } from './firestore.ts';
import { getFirebaseFirestore } from './firestore.ts';
import type { FirebaseFunctionsInterface } from './functions.ts';
import { getFirebaseFunctions } from './functions.ts';
import type { FirebaseHttpClientInterface } from './http_client.ts';
import { getFirebaseHttpClient } from './http_client.ts';
import type { FirebaseStorageInterface } from './storage.ts';
import { getFirebaseStorage } from './storage.ts';

export type FirebaseAppOptions = BaseGameClassOptions;

export type FirebaseAppInterface = BaseGameClassInterface & {
  readonly config: FirebaseConfig;
  readonly http: FirebaseHttpClientInterface;
  readonly auth: FirebaseAuthInterface;
  readonly firestore: FirebaseFirestoreInterface;
  readonly storage: FirebaseStorageInterface;
  readonly functions: FirebaseFunctionsInterface;
  readonly isEmulator: boolean;
};

/**
 * Firebase application instance with all REST-based services.
 */
class FirebaseApp extends BaseGameClass<FirebaseAppOptions> implements FirebaseAppInterface {
  readonly config: FirebaseConfig;
  readonly http: FirebaseHttpClientInterface;
  readonly auth: FirebaseAuthInterface;
  readonly firestore: FirebaseFirestoreInterface;
  readonly storage: FirebaseStorageInterface;
  readonly functions: FirebaseFunctionsInterface;

  constructor(options: FirebaseAppOptions) {
    super(options);
    this.config = getConfig();
    this.http = getFirebaseHttpClient({
      className: 'FirebaseHttpClient',
      apiKey: this.config.apiKey,
    });
    this.auth = getFirebaseAuth({ className: 'FirebaseAuth', http: this.http });
    this.firestore = getFirebaseFirestore({ className: 'FirebaseFirestore', http: this.http });
    this.storage = getFirebaseStorage({ className: 'FirebaseStorage', http: this.http });
    this.functions = getFirebaseFunctions({ className: 'FirebaseFunctions', http: this.http });
  }

  /** Whether running against Firebase emulators. */
  get isEmulator(): boolean {
    return this.config.isEmulator;
  }
}

let _instance: FirebaseAppInterface | undefined;

/**
 * Creates or returns the singleton Firebase application instance.
 */
export const createFirebase = (): FirebaseAppInterface => {
  if (!_instance) {
    _instance = FirebaseApp.create({ className: 'FirebaseApp' });
  }
  return _instance;
};

/**
 * Returns the current Firebase instance (or creates one if needed).
 */
export const getFirebase = (): FirebaseAppInterface => createFirebase();
