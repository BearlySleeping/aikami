// apps/frontend/game/src/core/firebase/index.ts
/**
 * Lightweight Firebase SDK for the game client.
 * REST-based, no Firebase JS SDK dependency — keeps WebGL payload minimal.
 *
 * Usage:
 *   import { createFirebase } from './core/firebase/index.ts';
 *   const fb = createFirebase();
 *   await fb.auth.signInAnonymous();
 *   const doc = await fb.firestore.getDocument('games/abc/saves/xyz');
 */

export { FirebaseAuth, type FirebaseUser } from './auth.ts';
export { type FirebaseConfig, getConfig, resolveConfig } from './config.ts';
export { createFirebase, FirebaseApp, getFirebase } from './firebase_app.ts';
export { FirebaseFirestore, type FirestoreDocument } from './firestore.ts';
export { FirebaseFunctions, type FunctionsResponse } from './functions.ts';
export type { HttpResult } from './http_client.ts';
export { FirebaseHttpClient } from './http_client.ts';
export { FirebaseStorage } from './storage.ts';
