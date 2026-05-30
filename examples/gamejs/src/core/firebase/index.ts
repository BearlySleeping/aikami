// apps/frontend/gamejs/src/core/firebase/index.ts
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import Env from '../env';

export interface FirebaseConfig {
    apiKey: string;
    projectId: string;
    authDomain: string;
    firestoreDomain: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
}

export default class Firebase extends Node {
    private static _instance: Firebase | null = null;
    private _config: FirebaseConfig = {
        apiKey: '',
        projectId: '',
        authDomain: '',
        firestoreDomain: '',
        storageBucket: '',
        messagingSenderId: '',
        appId: '',
    };

    static get instance(): Firebase | null {
        return Firebase._instance;
    }

    _ready(): void {
        Firebase._instance = this;
        (globalThis as Record<string, unknown>).firebaseInstance = this;
        logger.debug('Firebase: _ready, checking Env.instance...');
        const envCheck = this._get_env();
        logger.debug('Firebase: envCheck:', envCheck ? 'exists' : 'null');
        this._load_config();
    }

    private _get_env(): Env | null {
        return Env.instance ?? ((globalThis as Record<string, unknown>).envInstance as Env | null);
    }

    private _load_config(): void {
        logger.debug('Firebase: loading config');
        const env = this._get_env();
        logger.debug('Firebase: Env.instance:', env ? 'exists' : 'null');
        if (env) {
            this._config = {
                apiKey: env.key,
                projectId: env.project_id,
                authDomain: env.auth_domain,
                firestoreDomain: `${env.project_id}.firebaseio.com`,
                storageBucket: `${env.project_id}.firebasestorage.app`,
                messagingSenderId: '',
                appId: '',
            };
        }
    }

    get config(): FirebaseConfig {
        return this._config;
    }

    get authEndpoint(): string {
        const env = this._get_env();
        logger.debug('Firebase: authEndpoint, env:', env ? 'exists' : 'null');
        if (env) {
            const endpoint = env.auth_endpoint;
            logger.debug('Firebase: authEndpoint:', endpoint);
            return endpoint;
        }
        const endpoint = `https://identitytoolkit.googleapis.com/v1/projects/${this._config.projectId}`;
        logger.debug('Firebase: authEndpoint fallback:', endpoint);
        return endpoint;
    }

    get firestoreEndpoint(): string {
        const env = this._get_env();
        if (env) {
            return env.firestore_endpoint;
        }
        return `https://firestore.googleapis.com/v1/projects/${this._config.projectId}/databases/(default)/documents`;
    }
}
