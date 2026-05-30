// apps/frontend/gamejs/src/core/managers/firebase_manager.ts
/**
 * Unified facade over all Firebase services.
 * Provides a single entry point for auth, cloud save, leaderboard,
 * storage, and cloud functions.
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import FirebaseAuth from '../firebase/auth';
import FirebaseCloudSave from '../firebase/cloud_save';
import FirebaseLeaderboard from '../firebase/leaderboard';
import FirebaseStorage from '../firebase/storage';
import FirebaseFunctions from '../firebase/functions';

export type FirebaseManagerOptions = {
    autoRestoreSession?: boolean;
};

/**
 * Central manager for all Firebase backend interactions.
 * Delegates to individual Firebase service singletons.
 */
export default class FirebaseManager extends Node {
    private static _instance: FirebaseManager | null = null;

    static get instance(): FirebaseManager | null {
        return FirebaseManager._instance;
    }

    _ready(): void {
        logger.debug('FirebaseManager._ready');
        FirebaseManager._instance = this;
        (globalThis as Record<string, unknown>).firebaseManagerInstance = this;
    }

    // --- AUTH ---

    get auth(): FirebaseAuth | null {
        return this._getAuth();
    }

    get isAuthenticated(): boolean {
        return this._getAuth()?.isAuthenticated ?? false;
    }

    get currentUser() {
        return this._getAuth()?.currentUser;
    }

    async signInWithEmail(email: string, password: string): Promise<ReturnType<FirebaseAuth['sign_in_with_email']>> {
        logger.debug('FirebaseManager.signInWithEmail', { email });
        const auth = this._requireAuth();
        return auth.sign_in_with_email(email, password);
    }

    async signUpWithEmail(email: string, password: string): Promise<ReturnType<FirebaseAuth['sign_up_with_email']>> {
        logger.debug('FirebaseManager.signUpWithEmail', { email });
        const auth = this._requireAuth();
        return auth.sign_up_with_email(email, password);
    }

    async signInAnonymous(): Promise<ReturnType<FirebaseAuth['sign_in_anonymous']>> {
        logger.debug('FirebaseManager.signInAnonymous');
        const auth = this._requireAuth();
        return auth.sign_in_anonymous();
    }

    async signInWithGoogle(idToken: string): Promise<ReturnType<FirebaseAuth['sign_in_with_google']>> {
        logger.debug('FirebaseManager.signInWithGoogle');
        const auth = this._requireAuth();
        return auth.sign_in_with_google(idToken);
    }

    signOut(): void {
        logger.debug('FirebaseManager.signOut');
        this._getAuth()?.sign_out();
    }

    // --- CLOUD SAVE ---

    async saveGame(gameId: string, level: number, score: number, data: Record<string, unknown>): Promise<boolean> {
        logger.debug('FirebaseManager.saveGame', { gameId, level, score });
        const cloudSave = this._requireCloudSave();
        return cloudSave.save_game(gameId, level, score, data);
    }

    async loadGame(gameId: string): Promise<ReturnType<FirebaseCloudSave['load_game']>> {
        logger.debug('FirebaseManager.loadGame', { gameId });
        const cloudSave = this._requireCloudSave();
        return cloudSave.load_game(gameId);
    }

    async deleteGame(gameId: string): Promise<boolean> {
        logger.debug('FirebaseManager.deleteGame', { gameId });
        const cloudSave = this._requireCloudSave();
        return cloudSave.delete_game(gameId);
    }

    // --- LEADERBOARD ---

    async submitScore(gameId: string, uid: string, playerName: string, score: number): Promise<boolean> {
        logger.debug('FirebaseManager.submitScore', { gameId, playerName, score });
        const leaderboard = this._requireLeaderboard();
        return leaderboard.submit_score(gameId, uid, playerName, score);
    }

    async fetchLeaderboard(gameId: string, limitCount: number): Promise<ReturnType<FirebaseLeaderboard['fetch_leaderboard']>> {
        logger.debug('FirebaseManager.fetchLeaderboard', { gameId, limitCount });
        const leaderboard = this._requireLeaderboard();
        return leaderboard.fetch_leaderboard(gameId, limitCount);
    }

    // --- STORAGE ---

    async uploadFile(path: string, content: string, contentType: string): Promise<string | null> {
        logger.debug('FirebaseManager.uploadFile', { path });
        const storage = this._requireStorage();
        return storage.upload_file(path, content, contentType);
    }

    async downloadFile(path: string): Promise<string | null> {
        logger.debug('FirebaseManager.downloadFile', { path });
        const storage = this._requireStorage();
        return storage.download_file(path);
    }

    async deleteFile(path: string): Promise<boolean> {
        logger.debug('FirebaseManager.deleteFile', { path });
        const storage = this._requireStorage();
        return storage.delete_file(path);
    }

    // --- FUNCTIONS ---

    async callFunction(name: string, data: Record<string, unknown>, region?: string): Promise<ReturnType<FirebaseFunctions['call_function']>> {
        logger.debug('FirebaseManager.callFunction', { name });
        const functions = this._requireFunctions();
        return functions.call_function(name, data, region);
    }

    async promptAI(prompt: string, gameId: string): Promise<ReturnType<FirebaseFunctions['prompt_ai']>> {
        logger.debug('FirebaseManager.promptAI', { gameId });
        const functions = this._requireFunctions();
        return functions.prompt_ai(prompt, gameId);
    }

    // --- PRIVATE HELPERS ---

    private _getAuth(): FirebaseAuth | null {
        return (
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null)
        );
    }

    private _requireAuth(): FirebaseAuth {
        const auth = this._getAuth();
        if (!auth) {
            throw new Error('FirebaseAuth not available');
        }
        return auth;
    }

    private _getCloudSave(): FirebaseCloudSave | null {
        return (
            FirebaseCloudSave.instance ??
            ((globalThis as Record<string, unknown>).firebaseCloudSaveInstance as FirebaseCloudSave | null)
        );
    }

    private _requireCloudSave(): FirebaseCloudSave {
        const cs = this._getCloudSave();
        if (!cs) {
            throw new Error('FirebaseCloudSave not available');
        }
        return cs;
    }

    private _getLeaderboard(): FirebaseLeaderboard | null {
        return (
            FirebaseLeaderboard.instance ??
            ((globalThis as Record<string, unknown>).firebaseLeaderboardInstance as FirebaseLeaderboard | null)
        );
    }

    private _requireLeaderboard(): FirebaseLeaderboard {
        const lb = this._getLeaderboard();
        if (!lb) {
            throw new Error('FirebaseLeaderboard not available');
        }
        return lb;
    }

    private _getStorage(): FirebaseStorage | null {
        return (
            FirebaseStorage.instance ??
            ((globalThis as Record<string, unknown>).firebaseStorageInstance as FirebaseStorage | null)
        );
    }

    private _requireStorage(): FirebaseStorage {
        const st = this._getStorage();
        if (!st) {
            throw new Error('FirebaseStorage not available');
        }
        return st;
    }

    private _getFunctions(): FirebaseFunctions | null {
        return (
            FirebaseFunctions.instance ??
            ((globalThis as Record<string, unknown>).firebaseFunctionsInstance as FirebaseFunctions | null)
        );
    }

    private _requireFunctions(): FirebaseFunctions {
        const fn = this._getFunctions();
        if (!fn) {
            throw new Error('FirebaseFunctions not available');
        }
        return fn;
    }
}

export { FirebaseManager };
