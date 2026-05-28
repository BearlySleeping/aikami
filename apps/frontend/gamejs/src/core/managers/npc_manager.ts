// apps/frontend/gamejs/src/core/managers/npc_manager.ts
/**
 * NPC factory and cache manager.
 * Provides predefined NPC templates, dynamic memory (recollections),
 * portrait resolution, and save/load for NPC state.
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import {
    NpcId,
    PREDEFINED_NPCS,
    createNpcDynamicData,
    getPortraitPath,
    npcDynamicDataToJson,
    npcDynamicDataFromJson,
} from '../models/npc';
import type { NpcDynamicData, NpcInstance } from '../models/npc';

export type NpcManagerOptions = {
    savePath?: string;
};

/**
 * Central manager for NPC data and memory.
 * Implemented as a singleton autoload.
 */
export default class NpcManager extends Node {
    private static _instance: NpcManager | null = null;

    private _npcCache: Map<NpcId, NpcInstance> = new Map();
    private _savePath: string = 'user://npc_data/';

    static get instance(): NpcManager | null {
        return NpcManager._instance;
    }

    _ready(): void {
        logger.debug('NpcManager._ready');
        NpcManager._instance = this;
        (globalThis as Record<string, unknown>).npcManagerInstance = this;
    }

    initialize(options?: NpcManagerOptions): void {
        logger.debug('NpcManager.initialize', options);
        if (options?.savePath) {
            this._savePath = options.savePath;
        }
    }

    // --- NPC ACCESS ---

    /**
     * Get or create an NPC instance by ID.
     * Caches the result for subsequent lookups.
     */
    getNpc(npcId: NpcId): NpcInstance | undefined {
        logger.debug('NpcManager.getNpc', npcId);

        if (npcId === NpcId.NONE) {
            return undefined;
        }

        const cached = this._npcCache.get(npcId);
        if (cached) {
            return cached;
        }

        const template = PREDEFINED_NPCS[npcId];
        if (!template) {
            logger.warn('NpcManager.getNpc', `Unknown NPC id: ${npcId}`);
            return undefined;
        }

        const dynamic = this._loadDynamicData(npcId);
        const instance: NpcInstance = {
            template,
            dynamic,
            currentMood: 'neutral',
        };

        this._npcCache.set(npcId, instance);
        return instance;
    }

    /**
     * Get the portrait path for an NPC in a given mood.
     * Falls back to neutral mood if the requested one is missing.
     */
    getPortraitPath(npcId: NpcId, mood?: string): string {
        logger.debug('NpcManager.getPortraitPath', { npcId, mood });
        const npc = this.getNpc(npcId);
        if (!npc) {
            return '';
        }
        const path = getPortraitPath(npc.template, mood ?? npc.currentMood);
        if (!path) {
            logger.warn('NpcManager.getPortraitPath', `Mood ${mood} not found, using neutral`);
            return getPortraitPath(npc.template, 'neutral');
        }
        return path;
    }

    /**
     * Get all available mood keys for an NPC.
     */
    getAvailableMoods(npcId: NpcId): string[] {
        logger.debug('NpcManager.getAvailableMoods', npcId);
        const npc = this.getNpc(npcId);
        if (!npc) {
            return [];
        }
        return Object.keys(npc.template.portraits);
    }

    /**
     * Set the current mood for an NPC.
     */
    setNpcMood(npcId: NpcId, mood: string): void {
        logger.debug('NpcManager.setNpcMood', { npcId, mood });
        const npc = this.getNpc(npcId);
        if (!npc) {
            return;
        }
        npc.currentMood = mood;
    }

    // --- DYNAMIC DATA ---

    /**
     * Get an NPC's dynamic data (memory, relationship, last spoken time).
     */
    getDynamicData(npcId: NpcId): NpcDynamicData | undefined {
        logger.debug('NpcManager.getDynamicData', npcId);
        const npc = this.getNpc(npcId);
        return npc?.dynamic;
    }

    /**
     * Add a recollection to an NPC's memory.
     */
    addRecollection(npcId: NpcId, recollection: string): void {
        logger.debug('NpcManager.addRecollection', { npcId, recollection });
        const npc = this.getNpc(npcId);
        if (!npc) {
            return;
        }
        const trimmed = recollection.trim();
        if (!npc.dynamic.recollections.includes(trimmed)) {
            npc.dynamic.recollections.push(trimmed);
        }
    }

    /**
     * Update the last time an NPC spoke with the player.
     */
    updateLastSpokeAt(npcId: NpcId, inGameMinutes: number): void {
        logger.debug('NpcManager.updateLastSpokeAt', { npcId, inGameMinutes });
        const npc = this.getNpc(npcId);
        if (!npc) {
            return;
        }
        npc.dynamic.lastTimeSpokeAt = inGameMinutes;
    }

    /**
     * Adjust an NPC's relationship level with the player.
     */
    adjustRelationship(npcId: NpcId, delta: number): void {
        logger.debug('NpcManager.adjustRelationship', { npcId, delta });
        const npc = this.getNpc(npcId);
        if (!npc) {
            return;
        }
        npc.dynamic.relationshipLevelWithPlayer += delta;
    }

    // --- PERSISTENCE ---

    /**
     * Save an NPC's dynamic data to disk.
     */
    saveNpcDynamicData(npcId: NpcId): void {
        logger.debug('NpcManager.saveNpcDynamicData', npcId);
        const npc = this.getNpc(npcId);
        if (!npc) {
            return;
        }
        const data = npcDynamicDataToJson(npc.dynamic);
        const path = this._toNpcSavePath(npcId);
        this._saveFile(path, data);
    }

    /**
     * Save all cached NPC dynamic data.
     */
    saveAll(): void {
        logger.debug('NpcManager.saveAll');
        for (const [npcId] of this._npcCache) {
            this.saveNpcDynamicData(npcId);
        }
    }

    private _loadDynamicData(npcId: NpcId): NpcDynamicData {
        const path = this._toNpcSavePath(npcId);
        const data = this._loadFile(path);
        if (data) {
            return npcDynamicDataFromJson(data);
        }
        return createNpcDynamicData();
    }

    private _toNpcSavePath(npcId: NpcId): string {
        return `${this._savePath}${npcId}_dynamic_data.json`;
    }

    private _saveFile(path: string, data: Record<string, unknown>): void {
        const file = this._openFileForWrite(path) as
            | { store_string(text: string): void; close(): void }
            | null;
        if (!file) {
            return;
        }
        file.store_string(JSON.stringify(data));
        file.close();
    }

    private _loadFile(path: string): Record<string, unknown> | null {
        const file = this._openFileForRead(path) as
            | { get_as_text(): string; close(): void }
            | null;
        if (!file) {
            return null;
        }
        const text = file.get_as_text();
        file.close();
        if (!text) {
            return null;
        }
        try {
            return JSON.parse(text) as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    private _openFileForWrite(path: string): unknown {
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (dir) {
            const DirAccess = (globalThis as Record<string, unknown>).DirAccess as
                | { make_dir_recursive_absolute(dir: string): { valueOf(): number } }
                | undefined;
            const error = DirAccess?.make_dir_recursive_absolute(dir);
            if (error && error.valueOf() !== 0) {
                logger.warn('NpcManager._openFileForWrite', `Could not create directory: ${dir}`);
            }
        }
        const FileAccess = (globalThis as Record<string, unknown>).FileAccess as
            | { open(path: string, mode: number): unknown }
            | undefined;
        if (!FileAccess) {
            return null;
        }
        return FileAccess.open(path, 2);
    }

    private _openFileForRead(path: string): unknown {
        const FileAccess = (globalThis as Record<string, unknown>).FileAccess as
            | { open(path: string, mode: number): unknown }
            | undefined;
        if (!FileAccess) {
            return null;
        }
        return FileAccess.open(path, 1);
    }

    /**
     * Clear the NPC cache and reload from templates.
     */
    reset(): void {
        logger.info('NpcManager.reset', 'Clearing NPC cache');
        this._npcCache.clear();
    }
}

export { NpcManager };
