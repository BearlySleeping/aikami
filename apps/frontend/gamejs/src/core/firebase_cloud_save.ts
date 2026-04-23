// apps/frontend/gamejs/src/core/firebase_cloud_save.ts
/**
 * @fileoverview Firebase Cloud Save service for game data persistence
 * @module firebase_cloud_save
 * @description Manages game save/load operations via Firestore REST API
 */
import { Node } from 'godot';
import { logger } from '../utils/logger';
import Firebase from './firebase';
import FirebaseAuth from './firebase_auth';
import FirebaseHttpClient from './firebase_http_client';

/**
 * @interface FirestoreDoc
 * @description Firestore document response structure
 */
interface FirestoreDoc {
    name?: string;
    fields?: Record<string, unknown>;
    createTime?: string;
    updateTime?: string;
}

/**
 * @interface GameSave
 * @description Game save data structure
 */
export interface GameSave {
    uid: string;
    gameId: string;
    level: number;
    score: number;
    timestamp: number;
    data: Record<string, unknown>;
}

/**
 * @class FirebaseCloudSave
 * @extends Node
 * @description Singleton service for cloud save operations
 */
export default class FirebaseCloudSave extends Node {
    private static _instance: FirebaseCloudSave | null = null;

    /**
     * @static
     * @get instance
     * @returns {FirebaseCloudSave | null}
     */
    static get instance(): FirebaseCloudSave | null {
        return FirebaseCloudSave._instance;
    }

    /** @method _ready */
    _ready(): void {
        FirebaseCloudSave._instance = this;
        (globalThis as Record<string, unknown>).firebaseCloudSaveInstance = this;
        logger.debug('FirebaseCloudSave: _ready');
    }

    /**
     * @method save_game
     * @async
     * @param {string} gameId - Unique game identifier
     * @param {number} level - Current level
     * @param {number} score - Player score
     * @param {Record<string, unknown>} data - Additional save data
     * @returns {Promise<boolean>} Success status
     */
    async save_game(gameId: string, level: number, score: number, data: Record<string, unknown>): Promise<boolean> {
        logger.debug('FirebaseCloudSave: save_game', gameId);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http || !auth?.currentUser) {
            logger.error('FirebaseCloudSave: missing dependencies');
            return false;
        }

        const url = `${firebase.firestoreEndpoint}/games/${gameId}/saves/${auth.currentUser.uid}`;

        const saveData = {
            fields: {
                uid: { stringValue: auth.currentUser.uid },
                gameId: { stringValue: gameId },
                level: { integerValue: level.toString() },
                score: { integerValue: score.toString() },
                timestamp: { timestampValue: new Date().toISOString() },
                data: { stringValue: JSON.stringify(data) },
            },
        };

        return new Promise((resolve) => {
            http.patch(firebase.config.apiKey, url, JSON.stringify(saveData), (success) => {
                logger.debug('FirebaseCloudSave: save_game result', success);
                resolve(success);
            });
        });
    }

    /**
     * @method load_game
     * @async
     * @param {string} gameId - Unique game identifier
     * @returns {Promise<GameSave | null>} Loaded game save or null
     */
    async load_game(gameId: string): Promise<GameSave | null> {
        logger.debug('FirebaseCloudSave: load_game', gameId);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http || !auth?.currentUser) {
            logger.error('FirebaseCloudSave: missing dependencies');
            return null;
        }

        const url = `${firebase.firestoreEndpoint}/games/${gameId}/saves/${auth.currentUser.uid}`;

        return new Promise((resolve) => {
            http.get(firebase.config.apiKey, url, (success, response) => {
                if (!success || !response) {
                    logger.debug('FirebaseCloudSave: load_game failed');
                    resolve(null);
                    return;
                }

                try {
                    const doc = JSON.parse(response.body) as FirestoreDoc;
                    if (!doc.fields) {
                        resolve(null);
                        return;
                    }

                    const fields = doc.fields as Record<string, { stringValue?: string; integerValue?: string }>;
                    resolve({
                        uid: fields.uid?.stringValue || '',
                        gameId: fields.gameId?.stringValue || '',
                        level: Number.parseInt(fields.level?.integerValue || '0', 10),
                        score: Number.parseInt(fields.score?.integerValue || '0', 10),
                        timestamp: Date.now(),
                        data: JSON.parse(fields.data?.stringValue || '{}'),
                    });
                } catch {
                    logger.error('FirebaseCloudSave: parse error');
                    resolve(null);
                }
            });
        });
    }

    /**
     * @method delete_game
     * @async
     * @param {string} gameId - Unique game identifier
     * @returns {Promise<boolean>} Success status
     */
    async delete_game(gameId: string): Promise<boolean> {
        logger.debug('FirebaseCloudSave: delete_game', gameId);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http || !auth?.currentUser) {
            logger.error('FirebaseCloudSave: missing dependencies');
            return false;
        }

        const url = `${firebase.firestoreEndpoint}/games/${gameId}/saves/${auth.currentUser.uid}`;

        return new Promise((resolve) => {
            // Use PATCH with empty fields to delete
            const deleteData = { fields: {} };
            http.patch(firebase.config.apiKey, url, JSON.stringify(deleteData), (success) => {
                logger.debug('FirebaseCloudSave: delete_game result', success);
                resolve(success);
            });
        });
    }
}
