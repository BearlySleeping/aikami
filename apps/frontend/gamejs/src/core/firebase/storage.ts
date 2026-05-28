// apps/frontend/gamejs/src/core/firebase/storage.ts
/**
 * @fileoverview Firebase Storage service for game assets
 * @module firebase_storage
 * @description Manages file storage via Firebase Storage REST API
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import type Env from '../env';
import Firebase from './index';
import FirebaseHttpClient from './http_client';

/**
 * @interface StorageMetadata
 * @description File metadata from storage
 */
export interface StorageMetadata {
    name: string;
    bucket: string;
    contentType: string;
    size: number;
    downloadUrl: string;
}

/**
 * @class FirebaseStorage
 * @extends Node
 * @description Singleton service for storage operations
 */
export default class FirebaseStorage extends Node {
    private static _instance: FirebaseStorage | null = null;

    /**
     * @static
     * @get instance
     * @returns {FirebaseStorage | null}
     */
    static get instance(): FirebaseStorage | null {
        return FirebaseStorage._instance;
    }

    /** @method _ready */
    _ready(): void {
        FirebaseStorage._instance = this;
        (globalThis as Record<string, unknown>).firebaseStorageInstance = this;
        logger.debug('FirebaseStorage: _ready');
    }

    /**
     * @method get_storage_endpoint
     * @private
     * @returns {string} Storage REST API endpoint
     */
    private get_storage_endpoint(): string {
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        if (!firebase) return '';

        const env = (globalThis as Record<string, unknown>).envInstance as Env | null;
        if (env?.is_emulator) {
            // Firebase Storage emulator uses port 9199
            return `http://127.0.0.1:9199/v0/b/${firebase.config.storageBucket}/o`;
        }
        return `https://storage.googleapis.com/storage/v1/b/${firebase.config.storageBucket}/o`;
    }

    /**
     * @method upload_file
     * @async
     * @param {string} path - Storage path (e.g., "screenshots/score.png")
     * @param {string} content - File content as base64
     * @param {string} contentType - MIME type (e.g., "image/png")
     * @returns {Promise<string | null>} Download URL or null on failure
     */
    async upload_file(path: string, content: string, contentType: string): Promise<string | null> {
        logger.debug('FirebaseStorage: upload_file', path);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseStorage: missing dependencies');
            return null;
        }

        const endpoint = this.get_storage_endpoint();
        if (!endpoint) {
            logger.error('FirebaseStorage: no endpoint');
            return null;
        }

        // Build signed URL for emulator or use OAuth for production
        const url = `${endpoint}?name=${encodeURIComponent(path)}&uploadType=media&key=${firebase.config.apiKey}`;

        // For emulator
        const emulatorToken = firebase.config.projectId ? '&fakeToken=1' : '';
        const fullUrl = url + emulatorToken;

        return new Promise((resolve) => {
            http.post_with_content_type(firebase.config.apiKey, fullUrl, content, contentType, (success, response) => {
                if (!success || !response) {
                    logger.error('FirebaseStorage: upload failed');
                    resolve(null);
                    return;
                }

                try {
                    const data = JSON.parse(response.body);
                    // For media uploads, construct download URL
                    const downloadUrl = `${endpoint.replace('/o', `/${path}`)}?alt=media&token=${data.name || ''}`;
                    resolve(downloadUrl);
                } catch {
                    logger.error('FirebaseStorage: parse error');
                    resolve(null);
                }
            });
        });
    }

    /**
     * @method download_file
     * @async
     * @param {string} path - Storage path (e.g., "screenshots/score.png")
     * @returns {Promise<string | null>} File content as base64 or null on failure
     */
    async download_file(path: string): Promise<string | null> {
        logger.debug('FirebaseStorage: download_file', path);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseStorage: missing dependencies');
            return null;
        }

        const endpoint = this.get_storage_endpoint();
        if (!endpoint) {
            logger.error('FirebaseStorage: no endpoint');
            return null;
        }

        const url = `${endpoint}/${encodeURIComponent(path)}?alt=media&key=${firebase.config.apiKey}`;

        // For emulator
        const emulatorToken = firebase.config.projectId ? '&fakeToken=1' : '';
        const fullUrl = url + emulatorToken;

        return new Promise((resolve) => {
            http.get(firebase.config.apiKey, fullUrl, (success, response) => {
                if (!success || !response) {
                    logger.error('FirebaseStorage: download failed');
                    resolve(null);
                    return;
                }
                resolve(response.body);
            });
        });
    }

    /**
     * @method delete_file
     * @async
     * @param {string} path - Storage path to delete
     * @returns {Promise<boolean>} Success status
     */
    async delete_file(path: string): Promise<boolean> {
        logger.debug('FirebaseStorage: delete_file', path);
        const firebase =
            Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
        const http =
            FirebaseHttpClient.instance ??
            ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

        if (!firebase || !http) {
            logger.error('FirebaseStorage: missing dependencies');
            return false;
        }

        const endpoint = this.get_storage_endpoint();
        if (!endpoint) {
            logger.error('FirebaseStorage: no endpoint');
            return false;
        }

        const url = `${endpoint}/${encodeURIComponent(path)}?key=${firebase.config.apiKey}`;

        // For emulator
        const emulatorToken = firebase.config.projectId ? '&fakeToken=1' : '';
        const fullUrl = url + emulatorToken;

        return new Promise((resolve) => {
            // FirebaseStorage uses PATCH or DELETE - use post with empty body for now
            http.post(firebase.config.apiKey, fullUrl, '', (success) => {
                logger.debug('FirebaseStorage: delete result', success);
                resolve(success);
            });
        });
    }
}
