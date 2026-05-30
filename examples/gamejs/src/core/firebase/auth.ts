// apps/frontend/gamejs/src/core/firebase/auth.ts
import { FileAccess, Node } from 'godot';
import { logger } from '../../utils/logger';
import Firebase from './index';
import FirebaseHttpClient from './http_client';

const SESSION_FILE = 'user://firebase_auth_session.json';

interface AuthResponse {
    idToken?: string;
    email?: string;
    localId?: string;
    refreshToken?: string;
    expiresIn?: string;
    error?: {
        message: string;
    };
}

export interface FirebaseUser {
    uid: string;
    email: string | null;
    idToken: string;
    refreshToken: string;
}

export default class FirebaseAuth extends Node {
    private static _instance: FirebaseAuth | null = null;
    private _currentUser: FirebaseUser | null = null;

    static get instance(): FirebaseAuth | null {
        return FirebaseAuth._instance;
    }

    get currentUser(): FirebaseUser | null {
        return this._currentUser;
    }

    get isAuthenticated(): boolean {
        return this._currentUser !== null;
    }

    _ready(): void {
        FirebaseAuth._instance = this;
        (globalThis as Record<string, unknown>).firebaseAuthInstance = this;
        logger.debug('FirebaseAuth: _ready');
        this.restore_session();
    }

    // ==================== SESSION MANAGEMENT ====================

    restore_session(): void {
        logger.debug('FirebaseAuth: restore_session');
        if (!FileAccess.file_exists(SESSION_FILE)) {
            logger.debug('FirebaseAuth: no session file found');
            return;
        }

        const file = FileAccess.open(SESSION_FILE, 1); // FileAccess.READ = 1
        if (!file) {
            logger.error('FirebaseAuth: failed to open session file');
            return;
        }

        const content = file.get_as_text();
        file.close();

        if (!content || content.trim() === '') {
            logger.debug('FirebaseAuth: session file is empty');
            return;
        }

        try {
            const data = JSON.parse(content) as FirebaseUser;
            if (data.uid && data.idToken) {
                this._currentUser = data;
                logger.debug('FirebaseAuth: session restored for', data.uid);
            } else {
                logger.debug('FirebaseAuth: session file missing required fields');
            }
        } catch (e) {
            logger.error('FirebaseAuth: failed to parse session file', e);
        }
    }

    private save_session(): void {
        if (!this._currentUser) {
            logger.debug('FirebaseAuth: no user to save');
            return;
        }

        const file = FileAccess.open(SESSION_FILE, 2); // FileAccess.WRITE = 2
        if (!file) {
            logger.error('FirebaseAuth: failed to open session file for writing');
            return;
        }

        file.store_string(JSON.stringify(this._currentUser));
        file.close();
        logger.debug('FirebaseAuth: session saved');
    }

    clear_session(): void {
        this._currentUser = null;
        if (FileAccess.file_exists(SESSION_FILE)) {
            // Godot doesn't have a direct delete, but we can truncate by writing empty
            const file = FileAccess.open(SESSION_FILE, 2);
            if (file) {
                file.store_string('');
                file.close();
            }
        }
        logger.debug('FirebaseAuth: session cleared');
    }

    // ==================== AUTHENTICATION METHODS ====================

    async sign_in_anonymous(): Promise<FirebaseUser | null> {
        logger.debug('FirebaseAuth: sign_in_anonymous called');
        return new Promise((resolve) => {
            const firebase =
                Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
            const http =
                FirebaseHttpClient.instance ??
                ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);
            logger.debug('FirebaseAuth: firebase:', firebase ? 'exists' : 'null');
            logger.debug('FirebaseAuth: http:', http ? 'exists' : 'null');
            if (!firebase || !http) {
                logger.error('FirebaseAuth: firebase or http not available for anonymous sign-in');
                resolve(null);
                return;
            }

            const url = `${firebase.authEndpoint}/accounts:signUp?key=${firebase.config.apiKey}`;
            logger.debug('FirebaseAuth: anonymous url:', url);
            const body = JSON.stringify({ returnSecureToken: true });
            logger.debug('FirebaseAuth: anonymous body:', body);

            http.post(firebase.config.apiKey, url, body, (success, response) => {
                logger.debug('FirebaseAuth: anonymous callback, success:', success);
                if (!success || !response) {
                    logger.error('FirebaseAuth: anonymous HTTP request failed');
                    resolve(null);
                    return;
                }

                logger.debug('FirebaseAuth: anonymous response code:', response.response_code);
                logger.debug('FirebaseAuth: anonymous response body:', response.body);

                if (!response.body || response.body.trim() === '') {
                    logger.error('FirebaseAuth: anonymous empty response body');
                    resolve(null);
                    return;
                }

                let data: AuthResponse;
                try {
                    data = JSON.parse(response.body) as AuthResponse;
                } catch (e) {
                    logger.error('FirebaseAuth: anonymous JSON parse error', e);
                    resolve(null);
                    return;
                }

                if (data.error) {
                    logger.error('FirebaseAuth: anonymous auth error', data.error);
                    resolve(null);
                    return;
                }

                this._currentUser = {
                    uid: data.localId || '',
                    email: null,
                    idToken: data.idToken || '',
                    refreshToken: data.refreshToken || '',
                };
                this.save_session();
                logger.debug('FirebaseAuth: anonymous sign-in success, uid:', this._currentUser.uid);
                resolve(this._currentUser);
            });
        });
    }

    async sign_up_with_email(email: string, password: string): Promise<FirebaseUser | null> {
        return new Promise((resolve) => {
            const firebase = Firebase.instance;
            const http = FirebaseHttpClient.instance;
            if (!firebase || !http) {
                resolve(null);
                return;
            }

            const url = `${firebase.authEndpoint}/accounts:signUp?key=${firebase.config.apiKey}`;
            const body = JSON.stringify({
                email,
                password,
                returnSecureToken: true,
            });

            http.post(firebase.config.apiKey, url, body, (success, response) => {
                if (!success || !response) {
                    resolve(null);
                    return;
                }

                const data = JSON.parse(response.body) as AuthResponse;
                if (data.error) {
                    resolve(null);
                    return;
                }

                this._currentUser = {
                    uid: data.localId || '',
                    email: data.email || email,
                    idToken: data.idToken || '',
                    refreshToken: data.refreshToken || '',
                };
                this.save_session();
                resolve(this._currentUser);
            });
        });
    }

    async sign_in_with_email(email: string, password: string): Promise<FirebaseUser | null> {
        logger.debug('FirebaseAuth: sign_in_with_email:', email);
        return new Promise((resolve) => {
            const firebase =
                Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
            const http =
                FirebaseHttpClient.instance ??
                ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);
            logger.debug('FirebaseAuth: firebase:', firebase ? 'exists' : 'null');
            logger.debug('FirebaseAuth: http:', http ? 'exists' : 'null');
            if (!firebase || !http) {
                logger.error('FirebaseAuth: firebase or http not available');
                resolve(null);
                return;
            }

            const url = `${firebase.authEndpoint}/accounts:signInWithPassword?key=${firebase.config.apiKey}`;
            logger.debug('FirebaseAuth: url:', url);
            const body = JSON.stringify({
                email,
                password,
                returnSecureToken: true,
            });
            logger.debug('FirebaseAuth: body:', body);

            http.post(firebase.config.apiKey, url, body, (success, response) => {
                logger.debug('FirebaseAuth: http callback, success:', success, 'response:', response);
                if (!success || !response) {
                    logger.error('FirebaseAuth: HTTP request failed');
                    resolve(null);
                    return;
                }

                logger.debug('FirebaseAuth: response code:', response.response_code, 'body:', response.body);

                if (!response.body || response.body.trim() === '') {
                    logger.error('FirebaseAuth: empty response body, code:', response.response_code);
                    resolve(null);
                    return;
                }

                let data: AuthResponse;
                try {
                    data = JSON.parse(response.body) as AuthResponse;
                } catch (e) {
                    logger.error('FirebaseAuth: JSON parse error', e);
                    resolve(null);
                    return;
                }

                if (data.error) {
                    logger.error('FirebaseAuth: auth error', data.error);
                    resolve(null);
                    return;
                }

                this._currentUser = {
                    uid: data.localId || '',
                    email: data.email || email,
                    idToken: data.idToken || '',
                    refreshToken: data.refreshToken || '',
                };
                this.save_session();
                resolve(this._currentUser);
            });
        });
    }

    async sign_in_with_google(idToken: string): Promise<FirebaseUser | null> {
        logger.debug('FirebaseAuth: sign_in_with_google');
        return new Promise((resolve) => {
            const firebase =
                Firebase.instance ?? ((globalThis as Record<string, unknown>).firebaseInstance as Firebase | null);
            const http =
                FirebaseHttpClient.instance ??
                ((globalThis as Record<string, unknown>).firebaseHttpInstance as FirebaseHttpClient | null);

            if (!firebase || !http) {
                logger.error('FirebaseAuth: firebase or http not available');
                resolve(null);
                return;
            }

            const url = `${firebase.authEndpoint}/accounts:signInWithIdp?key=${firebase.config.apiKey}`;
            const body = JSON.stringify({
                postBody: `id_token=${idToken}&providerId=google.com`,
                requestUri: 'http://localhost',
                returnIdpCredential: true,
                returnSecureToken: true,
            });

            http.post(firebase.config.apiKey, url, body, (success, response) => {
                if (!success || !response) {
                    logger.error('FirebaseAuth: Google sign-in HTTP request failed');
                    resolve(null);
                    return;
                }

                let data: AuthResponse;
                try {
                    data = JSON.parse(response.body) as AuthResponse;
                } catch (e) {
                    logger.error('FirebaseAuth: Google sign-in JSON parse error', e);
                    resolve(null);
                    return;
                }

                if (data.error) {
                    logger.error('FirebaseAuth: Google sign-in auth error', data.error);
                    resolve(null);
                    return;
                }

                this._currentUser = {
                    uid: data.localId || '',
                    email: data.email || null,
                    idToken: data.idToken || '',
                    refreshToken: data.refreshToken || '',
                };
                this.save_session();
                resolve(this._currentUser);
            });
        });
    }

    sign_out(): void {
        this.clear_session();
    }
}
