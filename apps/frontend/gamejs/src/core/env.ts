// apps/frontend/gamejs/src/core/env.ts
import { FileAccess, Node } from 'godot';
import { logger } from '../utils/logger';

interface EnvVars {
    PUBLIC_FIREBASE_API_KEY: string;
    PUBLIC_FIREBASE_AUTH_DOMAIN: string;
    PUBLIC_FIREBASE_PROJECT_ID: string;
    PUBLIC_FIREBASE_STORAGE_BUCKET: string;
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string;
    PUBLIC_FIREBASE_APP_ID: string;
    PUBLIC_LOG_LEVEL: string;
    PUBLIC_FLAVOR: string;
    OPENROUTER_API_KEY: string;
    PIPER_BASE_URL: string;
    [key: string]: string;
}

const DEFAULT_VARS: EnvVars = {
    PUBLIC_FIREBASE_API_KEY: '',
    PUBLIC_FIREBASE_AUTH_DOMAIN: '',
    PUBLIC_FIREBASE_PROJECT_ID: '',
    PUBLIC_FIREBASE_STORAGE_BUCKET: '',
    PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '',
    PUBLIC_FIREBASE_APP_ID: '',
    PUBLIC_LOG_LEVEL: 'INFO',
    PUBLIC_FLAVOR: 'DEVELOPMENT',
    OPENROUTER_API_KEY: '',
    PIPER_BASE_URL: 'http://localhost:5002',
};

export default class Env extends Node {
    private static _instance: Env | null = null;
    private _vars: EnvVars = DEFAULT_VARS;

    static get instance(): Env | null {
        return Env._instance;
    }

    _ready(): void {
        logger.debug('Env: _ready BEFORE setting instance');
        Env._instance = this;
        (globalThis as Record<string, unknown>).envInstance = this;
        logger.debug('Env: _ready AFTER setting instance');
        this.load_env_vars();
        logger.debug('Env: _ready DONE');
    }

    private load_env_vars(): void {
        logger.debug('Env: loading env vars from .env');
        const envFile = FileAccess.open('res://.env', 1);
        if (!envFile) {
            logger.error('Env: failed to open .env file');
            return;
        }
        while (!envFile.eof_reached()) {
            const line = envFile.get_line().trim();
            if (!line || line.startsWith('#')) {
                continue;
            }
            const eqIdx = line.indexOf('=');
            if (eqIdx <= 0) {
                continue;
            }
            const key = line.slice(0, eqIdx).trim();
            const value = line.slice(eqIdx + 1).trim();
            logger.debug(`Env: ${key}=${value}`);
            if (key in this._vars) {
                this._vars[key] = value;
            }
        }
        envFile.close();
        logger.debug('Env: loaded:', JSON.stringify(this._vars));
    }

    get key(): string {
        return this._vars.PUBLIC_FIREBASE_API_KEY;
    }

    get project_id(): string {
        return this._vars.PUBLIC_FIREBASE_PROJECT_ID;
    }

    get auth_domain(): string {
        return this._vars.PUBLIC_FIREBASE_AUTH_DOMAIN;
    }

    get openrouter_api_key(): string {
        return this._vars.OPENROUTER_API_KEY;
    }

    get piper_base_url(): string {
        return this._vars.PIPER_BASE_URL;
    }

    get flavor(): string {
        return this._vars.PUBLIC_FLAVOR;
    }

    get is_emulator(): boolean {
        return this._vars.PUBLIC_FLAVOR === 'EMULATOR';
    }

    get is_development(): boolean {
        return this._vars.PUBLIC_FLAVOR === 'DEVELOPMENT';
    }

    get is_production(): boolean {
        return this._vars.PUBLIC_FLAVOR === 'PRODUCTION';
    }

    get auth_endpoint(): string {
        if (this.is_emulator) {
            return 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
        }
        return `https://identitytoolkit.googleapis.com/v1/projects/${this._vars.PUBLIC_FIREBASE_PROJECT_ID}`;
    }

    get firestore_endpoint(): string {
        if (this.is_emulator) {
            return `http://127.0.0.1:8080/v1/projects/${this._vars.PUBLIC_FIREBASE_PROJECT_ID}/databases/(default)/documents`;
        }
        return `https://firestore.googleapis.com/v1/projects/${this._vars.PUBLIC_FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    }

    get pwa_registration_url(): string {
        // Allow explicit override via env
        const explicitUrl = this._vars.PUBLIC_PWA_URL;
        if (explicitUrl) {
            return explicitUrl;
        }
        if (this.is_emulator || this.is_development) {
            return 'http://localhost:5173';
        }
        return 'https://aikami.app';
    }
}
