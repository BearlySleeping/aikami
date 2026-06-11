// apps/frontend/client/src/lib/game/services/firebase/index.ts
/**
 * Lightweight Firebase SDK for the game client.
 * REST-based, no Firebase JS SDK dependency — keeps WebGL payload minimal.
 *
 * Usage:
 *   import { createFirebase } from '$lib/game/services/firebase/index.ts';
 *   const fb = createFirebase();
 *   await fb.auth.signInAnonymous();
 *   const doc = await fb.firestore.getDocument('games/abc/saves/xyz');
 */

export { type FirebaseAuthInterface, type FirebaseUser, getFirebaseAuth } from './auth.ts';
export { type FirebaseConfig, getConfig, resolveConfig } from './config.ts';
export {
  createFirebase,
  type FirebaseAppInterface,
  getFirebase,
} from './firebase_app.ts';
export {
  type FirebaseFirestoreInterface,
  type FirestoreDocument,
  getFirebaseFirestore,
} from './firestore.ts';
export {
  type FirebaseFunctionsInterface,
  type FunctionsResponse,
  getFirebaseFunctions,
} from './functions.ts';
export type { HttpResult } from './http_client.ts';
export { type FirebaseHttpClientInterface, getFirebaseHttpClient } from './http_client.ts';
export { type FirebaseStorageInterface, getFirebaseStorage } from './storage.ts';
