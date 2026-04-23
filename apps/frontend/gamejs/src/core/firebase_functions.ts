// apps/frontend/gamejs/src/core/firebase_functions.ts
/**
 * @fileoverview Firebase Functions service for cloud gameplay logic
 * @module firebase_functions
 * @description Manages Cloud Functions calls for server-side game logic
 */
import { Node } from 'godot';
import { logger } from '../utils/logger';
import type Env from './env';
import Firebase from './firebase';
import FirebaseHttpClient from './firebase_http_client';

/**
 * @interface FunctionsResponse
 * @description Cloud function call response
 */
export interface FunctionsResponse {
    result?: unknown;
    error?: string;
}

/**
 * @class FirebaseFunctions
 * @extends Node
 * @description Singleton service for Cloud Functions calls
 */
export default class FirebaseFunctions extends Node {
    private static _instance: FirebaseFunctions | null = null;

    /**
     * @static
     * @get instance
     * @returns {FirebaseFunctions | null}
     */
    static get instance(): FirebaseFunctions | null {
        return FirebaseFunctions._instance;
    }

    /** @method _ready */
    _ready(): void {
        FirebaseFunctions._instance = this;
        (globalThis as Record<string, unknown>).firebaseFunctionsInstance = this;
        logger.debug('FirebaseFunctions: _ready');
    }

    /**
     * @method get_functions_endpoint
     * @private
     * @param {string} region - Cloud region (default: us-central1)
     * @returns {string} Functions REST API endpoint
     */
    private get_functions_endpoint(region = 'us-central1'): string {
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        if (!firebase) return '';

        const env = (globalThis as Record<string, unknown>).envInstance as Env | null;
        if (env?.is_emulator) {
            // Firebase Functions emulator: /{project}/{region}
            return `http://127.0.0.1:5001/${firebase.config.projectId}/${region}`;
        }
        return `https://${region}-${firebase.config.projectId}.cloudfunctions.net`;
    }

    /**
     * @method call_function
     * @async
     * @param {string} name - Function name (e.g., "generateImage")
     * @param {Record<string, unknown>} data - Input data for the function
     * @param {string} region - Cloud region (default: us-central1)
     * @returns {Promise<FunctionsResponse>} Function result or error
     */
    async call_function(
        name: string,
        data: Record<string, unknown> = {},
        region = 'us-central1',
    ): Promise<FunctionsResponse> {
        logger.debug('FirebaseFunctions: call_function', name, 'region:', region);

        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseFunctions: missing dependencies');
            return { error: 'Missing dependencies' };
        }

        const endpoint = this.get_functions_endpoint(region);
        if (!endpoint) {
            logger.error('FirebaseFunctions: no endpoint');
            return { error: 'No endpoint' };
        }

        // Emulator URL format: /project/region/functionName
        const url = `${endpoint}/${name}`;

        const payload = { data };

        return new Promise((resolve) => {
            http.post(firebase.config.apiKey, url, JSON.stringify(payload), (success, response) => {
                if (!success || !response) {
                    logger.error('FirebaseFunctions: call failed');
                    resolve({ error: 'Call failed' });
                    return;
                }

                try {
                    const result = JSON.parse(response.body);
                    logger.debug('FirebaseFunctions: result', result);
                    if (result.error) {
                        resolve({ error: result.error });
                    } else {
                        resolve({ result: result });
                    }
                } catch {
                    logger.error('FirebaseFunctions: parse error');
                    resolve({ error: 'Parse error' });
                }
            });
        });
    }

    /**
     * @method call_http_function
     * @async
     * @param {string} name - Function name (e.g., "prompt_ai")
     * @param {Record<string, unknown>} data - Input data for the function (sent as raw body, not wrapped in { data })
     * @param {string} region - Cloud region (default: us-central1)
     * @returns {Promise<FunctionsResponse>} Function result or error
     */
    async call_http_function(
        name: string,
        data: Record<string, unknown> = {},
        region = 'us-central1',
    ): Promise<FunctionsResponse> {
        logger.debug('FirebaseFunctions: call_http_function', name, 'region:', region);

        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseFunctions: missing dependencies');
            return { error: 'Missing dependencies' };
        }

        const endpoint = this.get_functions_endpoint(region);
        if (!endpoint) {
            logger.error('FirebaseFunctions: no endpoint');
            return { error: 'No endpoint' };
        }

        // Emulator URL format: /project/region/functionName
        const url = `${endpoint}/${name}`;

        // HTTP functions receive raw body, not wrapped in { data: ... }
        const payload = data;

        return new Promise((resolve) => {
            http.post(firebase.config.apiKey, url, JSON.stringify(payload), (success, response) => {
                if (!success || !response) {
                    logger.error('FirebaseFunctions: HTTP call failed');
                    resolve({ error: 'Call failed' });
                    return;
                }

                try {
                    const result = JSON.parse(response.body);
                    logger.debug('FirebaseFunctions: HTTP result', result);
                    if (result.error) {
                        resolve({ error: result.error });
                    } else {
                        resolve({ result: result });
                    }
                } catch {
                    logger.error('FirebaseFunctions: HTTP parse error');
                    resolve({ error: 'Parse error' });
                }
            });
        });
    }

    /**
     * @method generate_image
     * @async
     * @param {string} prompt - Image generation prompt
     * @returns {Promise<FunctionsResponse>} Generated image URL or error
     */
    async generate_image(prompt: string): Promise<FunctionsResponse> {
        logger.debug('FirebaseFunctions: generate_image', prompt);
        return this.call_function('generate_image', { prompt }, 'us-central1');
    }

    /**
     * @method prompt_ai
     * @async
     * @param {string} prompt - AI prompt
     * @param {string} context - Game context
     * @returns {FunctionsResponse} AI response text
     */
    async prompt_ai(prompt: string, context = ''): Promise<FunctionsResponse> {
        logger.debug('FirebaseFunctions: prompt_ai', prompt);
        // prompt_ai is an HTTP (onRequest) function, not a callable function
        return this.call_http_function('prompt_ai', { prompt, context }, 'europe-west1');
    }
}
