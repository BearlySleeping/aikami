// apps/frontend/gamejs/src/core/managers/save_manager.ts
/**
 * Save game manager with dual persistence:
 * - Primary: Firebase Cloud Save (online)
 * - Fallback: Local JSON backup (offline)
 *
 * Features:
 * - Debounced auto-save (collects dirty flags, saves after delay)
 * - Save versioning with migrations
 * - Batched updates to reduce API calls
 * - Save slot support
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import {
    type GameSaveData,
    type SaveMetadata,
    SAVE_FORMAT_VERSION,
    createSaveData,
    extractSaveMetadata,
    saveDataToJson,
    saveDataFromJson,
    migrateSaveData,
} from '../models/save_data';
import {
    type PlayerSnapshot,
} from '../models/player';

export type SaveManagerOptions = {
    autoSaveIntervalMs?: number;
    gameId?: string;
    useCloudSave?: boolean;
};

export type SaveSlot = {
    slotId: string;
    metadata?: SaveMetadata;
    data?: GameSaveData;
};

export type SaveState = 'idle' | 'saving' | 'error';

/**
 * Central save manager with debounced auto-save and dual persistence.
 * Implemented as a singleton autoload.
 */
export default class SaveManager extends Node {
    private static _instance: SaveManager | null = null;

    private _currentData: GameSaveData = createSaveData();
    private _state: SaveState = 'idle';
    private _dirtyModules: Set<string> = new Set();
    private _autoSaveIntervalMs: number = 30000; // 30 seconds
    private _autoSaveTimer: number = 0;
    private _gameId: string = 'aikami_default';
    private _useCloudSave: boolean = true;


    static get instance(): SaveManager | null {
        return SaveManager._instance;
    }

    get currentData(): GameSaveData {
        return this._currentData;
    }

    get state(): SaveState {
        return this._state;
    }

    _ready(): void {
        logger.debug('SaveManager._ready');
        SaveManager._instance = this;
        (globalThis as Record<string, unknown>).saveManagerInstance = this;
    }

    _process(delta: number): void {
        if (this._dirtyModules.size === 0) {
            return;
        }
        this._autoSaveTimer += delta * 1000;
        if (this._autoSaveTimer >= this._autoSaveIntervalMs) {
            this._autoSaveTimer = 0;
            this.save().catch((error) => {
                logger.error('SaveManager._process auto-save failed', error);
            });
        }
    }

    /**
     * Initialize the save manager.
     */
    initialize(options: SaveManagerOptions = {}): void {
        logger.debug('SaveManager.initialize', options);
        this._autoSaveIntervalMs = options.autoSaveIntervalMs ?? 30000;
        this._gameId = options.gameId ?? 'aikami_default';
        this._useCloudSave = options.useCloudSave ?? true;
    }

    // --- DIRTY TRACKING ---

    /**
     * Mark a module as having unsaved changes.
     * Modules: 'player', 'quests', 'npcs', 'time', 'persistence'
     */
    markDirty(module: string): void {
        logger.debug('SaveManager.markDirty', module);
        this._dirtyModules.add(module);
        this._autoSaveTimer = 0;
    }

    /**
     * Check if any module has unsaved changes.
     */
    isDirty(): boolean {
        return this._dirtyModules.size > 0;
    }

    // --- SAVE OPERATIONS ---

    /**
     * Persist the current game state.
     * Returns true if saved successfully.
     */
    async save(): Promise<boolean> {
        if (this._state === 'saving') {
            logger.warn('SaveManager.save', 'Save already in progress');
            return false;
        }

        logger.info('SaveManager.save', `Saving ${this._dirtyModules.size} dirty modules`);
        this._state = 'saving';
        this._autoSaveTimer = 0;

        this._currentData.timestamp = Date.now();
        this._currentData.version = SAVE_FORMAT_VERSION;

        try {
            // Always save local backup first (fast, reliable)
            this._saveLocalBackup();

            // Then attempt cloud save if enabled
            if (this._useCloudSave) {
                await this._saveToCloud();
            }

            this._dirtyModules.clear();
            this._state = 'idle';
            logger.info('SaveManager.save', 'Save complete');
            return true;
        } catch (error) {
            this._state = 'error';
            logger.error('SaveManager.save', error);
            return false;
        }
    }

    /**
     * Force an immediate save, bypassing debounce.
     */
    async saveNow(): Promise<boolean> {
        logger.debug('SaveManager.saveNow');
        this._autoSaveTimer = Infinity;
        return this.save();
    }

    /**
     * Load the most recent save (cloud preferred, local fallback).
     */
    async load(): Promise<GameSaveData | null> {
        logger.info('SaveManager.load', 'Attempting to load save data');
        this._state = 'saving';

        try {
            let data: GameSaveData | null = null;

            if (this._useCloudSave) {
                data = await this._loadFromCloud();
            }

            if (!data) {
                data = this._loadLocalBackup();
            }

            if (data) {
                this._currentData = data;
                this._dirtyModules.clear();
                logger.info('SaveManager.load', `Loaded save from ${new Date(data.timestamp).toISOString()}`);
            }

            this._state = 'idle';
            return data;
        } catch (error) {
            this._state = 'error';
            logger.error('SaveManager.load', error);
            return null;
        }
    }

    // --- DATA MUTATORS ---

    setPlayerSnapshot(snapshot: PlayerSnapshot): void {
        this._currentData.player = snapshot;
        this.markDirty('player');
    }

    setCurrentScene(scenePath: string): void {
        if (this._currentData.currentScene === scenePath) {
            return;
        }
        this._currentData.currentScene = scenePath;
        this.markDirty('scene');
    }

    setTotalInGameHours(hours: number): void {
        if (this._currentData.totalInGameHours === hours) {
            return;
        }
        this._currentData.totalInGameHours = hours;
        this.markDirty('time');
    }

    setQuests(quests: GameSaveData['quests']): void {
        this._currentData.quests = quests;
        this.markDirty('quests');
    }

    addPersistentValue(value: string): void {
        if (this._currentData.persistence.includes(value)) {
            return;
        }
        this._currentData.persistence.push(value);
        this.markDirty('persistence');
    }

    hasPersistentValue(value: string): boolean {
        return this._currentData.persistence.includes(value);
    }

    setNpcDynamicData(npcId: string, data: Record<string, unknown>): void {
        this._currentData.npcDynamicData[npcId] = data;
        this.markDirty('npcs');
    }

    // --- LOCAL BACKUP ---

    private _getLocalPath(): string {
        return `user://saves/${this._gameId}.json`;
    }

    private _saveLocalBackup(): void {
        const path = this._getLocalPath();
        const json = saveDataToJson(this._currentData);
        const FileAccess = (globalThis as Record<string, unknown>).FileAccess as
            | { open(p: string, m: number): { store_string(t: string): void; close(): void } | null }
            | undefined;

        if (!FileAccess) {
            logger.warn('SaveManager._saveLocalBackup', 'FileAccess not available');
            return;
        }

        const file = FileAccess.open(path, 2); // WRITE = 2
        if (!file) {
            logger.warn('SaveManager._saveLocalBackup', `Could not open ${path} for writing`);
            return;
        }
        file.store_string(json);
        file.close();
        logger.debug('SaveManager._saveLocalBackup', `Saved to ${path}`);
    }

    private _loadLocalBackup(): GameSaveData | null {
        const path = this._getLocalPath();
        const FileAccess = (globalThis as Record<string, unknown>).FileAccess as
            | { open(p: string, m: number): { get_as_text(): string; close(): void } | null }
            | undefined;

        if (!FileAccess) {
            return null;
        }

        const file = FileAccess.open(path, 1); // READ = 1
        if (!file) {
            return null;
        }
        const text = file.get_as_text();
        file.close();

        if (!text) {
            return null;
        }

        try {
            return saveDataFromJson(text);
        } catch {
            return null;
        }
    }

    // --- CLOUD SAVE (FIREBASE) ---

    private async _saveToCloud(): Promise<void> {
        const firebaseManager = this._getFirebaseManager();
        if (!firebaseManager) {
            logger.warn('SaveManager._saveToCloud', 'FirebaseManager not available');
            return;
        }

        const success = await firebaseManager.saveGame(
            this._gameId,
            this._currentData.player.dynamic.level,
            this._currentData.player.dynamic.experience,
            this._currentData as unknown as Record<string, unknown>,
        );

        if (!success) {
            throw new Error('Cloud save failed');
        }

        logger.debug('SaveManager._saveToCloud', 'Cloud save successful');
    }

    private async _loadFromCloud(): Promise<GameSaveData | null> {
        const firebaseManager = this._getFirebaseManager();
        if (!firebaseManager) {
            return null;
        }

        const result = await firebaseManager.loadGame(this._gameId);
        if (result.error || !result.data) {
            return null;
        }

        const data = result.data as unknown as Record<string, unknown>;
        return migrateSaveData(data);
    }

    private _getFirebaseManager() {
        return (
            ((globalThis as Record<string, unknown>).firebaseManagerInstance as
                | { saveGame: (...args: unknown[]) => Promise<boolean>; loadGame: (...args: unknown[]) => Promise<{ error?: string; data?: unknown }> }
                | null)
            ?? null
        );
    }

    // --- RESET ---

    /**
     * Reset all save data to defaults.
     */
    reset(): void {
        logger.info('SaveManager.reset', 'Clearing all save data');
        this._currentData = createSaveData();
        this._dirtyModules.clear();
        this._autoSaveTimer = 0;
    }

    /**
     * Get metadata for the current save (for slot selection UI).
     */
    getMetadata(): SaveMetadata {
        return extractSaveMetadata(this._currentData);
    }
}

export { SaveManager };
