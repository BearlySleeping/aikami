// apps/frontend/gamejs/src/core/firebase/leaderboard.ts
/**
 * @fileoverview Firebase Leaderboard service for game scores
 * @module firebase_leaderboard
 * @description Manages leaderboard/rankings via Firestore REST API
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import Firebase from './index';
import FirebaseHttpClient from './http_client';

/**
 * @interface LeaderboardEntry
 * @description Single leaderboard entry
 */
export interface LeaderboardEntry {
    rank: number;
    uid: string;
    username: string;
    score: number;
    gameId: string;
}

/**
 * @class FirebaseLeaderboard
 * @extends Node
 * @description Singleton service for leaderboard operations
 */
export default class FirebaseLeaderboard extends Node {
    private static _instance: FirebaseLeaderboard | null = null;
    private _entries: LeaderboardEntry[] = [];

    /**
     * @static
     * @get instance
     * @returns {FirebaseLeaderboard | null}
     */
    static get instance(): FirebaseLeaderboard | null {
        return FirebaseLeaderboard._instance;
    }

    /**
     * @get entries
     * @returns {LeaderboardEntry[]}
     */
    get entries(): LeaderboardEntry[] {
        return this._entries;
    }

    /** @method _ready */
    _ready(): void {
        FirebaseLeaderboard._instance = this;
        (globalThis as Record<string, unknown>).firebaseLeaderboardInstance = this;
        logger.debug('FirebaseLeaderboard: _ready');
    }

    /**
     * @method submit_score
     * @async
     * @param {string} gameId - Unique game identifier
     * @param {string} uid - User ID
     * @param {string} username - Display name
     * @param {number} score - Player score
     * @returns {Promise<boolean>} Success status
     */
    async submit_score(gameId: string, uid: string, username: string, score: number): Promise<boolean> {
        logger.debug('FirebaseLeaderboard: submit_score', gameId, score);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseLeaderboard: missing dependencies');
            return false;
        }

        const url = `${firebase.firestoreEndpoint}/leaderboard/${gameId}/scores/${uid}`;

        const scoreData = {
            fields: {
                uid: { stringValue: uid },
                username: { stringValue: username },
                score: { integerValue: score.toString() },
                gameId: { stringValue: gameId },
                timestamp: { timestampValue: new Date().toISOString() },
            },
        };

        return new Promise((resolve) => {
            http.patch(firebase.config.apiKey, url, JSON.stringify(scoreData), (success) => {
                logger.debug('FirebaseLeaderboard: submit_score result', success);
                resolve(success);
            });
        });
    }

    /**
     * @method fetch_leaderboard
     * @async
     * @param {string} gameId - Unique game identifier
     * @param {number} limit - Maximum entries to fetch (default 10)
     * @returns {Promise<LeaderboardEntry[]>} Array of leaderboard entries
     */
    async fetch_leaderboard(gameId: string, _limit = 10): Promise<LeaderboardEntry[]> {
        logger.debug('FirebaseLeaderboard: fetch_leaderboard', gameId);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseLeaderboard: missing dependencies');
            return [];
        }

        const url = `${firebase.firestoreEndpoint}/leaderboard/${gameId}/scores`;

        return new Promise((resolve) => {
            http.get(firebase.config.apiKey, url, (success, response) => {
                if (!success || !response) {
                    logger.debug('FirebaseLeaderboard: fetch_leaderboard failed');
                    resolve([]);
                    return;
                }

                try {
                    const data = JSON.parse(response.body) as {
                        documents?: Array<{
                            fields: {
                                uid: { stringValue: string };
                                username: { stringValue: string };
                                score: { integerValue: string };
                                gameId: { stringValue: string };
                            };
                        }>;
                    };

                    const entries: LeaderboardEntry[] = [];
                    if (data.documents) {
                        data.documents.forEach((doc, index) => {
                            const fields = doc.fields;
                            entries.push({
                                rank: index + 1,
                                uid: fields.uid?.stringValue || '',
                                username: fields.username?.stringValue || 'Anonymous',
                                score: Number.parseInt(fields.score?.integerValue || '0', 10),
                                gameId: fields.gameId?.stringValue || '',
                            });
                        });
                    }

                    this._entries = entries;
                    resolve(entries);
                } catch {
                    logger.error('FirebaseLeaderboard: parse error');
                    resolve([]);
                }
            });
        });
    }
}
