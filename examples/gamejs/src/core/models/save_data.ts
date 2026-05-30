// apps/frontend/gamejs/src/core/models/save_data.ts
/**
 * Pure TypeScript save data model.
 * Represents the entire game state that gets persisted.
 * No Godot imports — safe for unit testing and worker threads.
 */

import type { PlayerSnapshot } from './player';
import type { QuestState } from './quest';

/** Current save format version for migration support. */
export const SAVE_FORMAT_VERSION = 1;

/** Complete game save snapshot. */
export type GameSaveData = {
    version: number;
    timestamp: number;
    totalInGameHours: number;
    currentScene: string;
    player: PlayerSnapshot;
    quests: QuestState[];
    persistence: string[];
    npcDynamicData: Record<string, Record<string, unknown>>;
};

/** Minimal save data for quick metadata display (slot selection screen). */
export type SaveMetadata = {
    timestamp: number;
    totalInGameHours: number;
    playerName: string;
    playerLevel: number;
    currentScene: string;
};

const DEFAULT_SAVE: GameSaveData = {
    version: SAVE_FORMAT_VERSION,
    timestamp: 0,
    totalInGameHours: 0,
    currentScene: '',
    player: {
        static: {
            id: '',
            name: '',
            race: '',
            characterClass: '',
            gender: '',
            age: 0,
            appearance: [],
            avatarPath: '',
            unitSpritePath: '',
        },
        dynamic: {
            level: 1,
            experience: 0,
            hp: 100,
            maxHp: 100,
            mana: 50,
            maxMana: 50,
            posX: 0,
            posY: 0,
            gold: 0,
            inventory: [],
            equipment: {
                head: undefined,
                chest: undefined,
                legs: undefined,
                feet: undefined,
                main_hand: undefined,
                off_hand: undefined,
                ring: undefined,
                necklace: undefined,
            },
            questLog: [],
        },
    },
    quests: [],
    persistence: [],
    npcDynamicData: {},
};

/**
 * Create a fresh save data object.
 */
export const createSaveData = (overrides?: Partial<GameSaveData>): GameSaveData => ({
    ...DEFAULT_SAVE,
    ...overrides,
    player: overrides?.player ?? DEFAULT_SAVE.player,
    quests: overrides?.quests ?? [],
    persistence: overrides?.persistence ?? [],
    npcDynamicData: overrides?.npcDynamicData ?? {},
});

/**
 * Extract metadata from full save data for UI display.
 */
export const extractSaveMetadata = (save: GameSaveData): SaveMetadata => ({
    timestamp: save.timestamp,
    totalInGameHours: save.totalInGameHours,
    playerName: save.player.static.name,
    playerLevel: save.player.dynamic.level,
    currentScene: save.currentScene,
});

/**
 * Migrate save data from an older version to the current format.
 */
export const migrateSaveData = (data: Record<string, unknown>): GameSaveData => {
    const version = (data.version as number) ?? 0;

    if (version >= SAVE_FORMAT_VERSION) {
        return data as GameSaveData;
    }

    // Version 0 → 1: wrap flat player fields into PlayerSnapshot
    if (version === 0) {
        const flatPlayer = data.player as Record<string, unknown> ?? {};
        return createSaveData({
            version: SAVE_FORMAT_VERSION,
            timestamp: Date.now(),
            totalInGameHours: (data.total_in_game_hours as number) ?? 0,
            currentScene: (data.current_scene as string) ?? '',
            player: {
                static: {
                    id: (flatPlayer.id as string) ?? '',
                    name: (flatPlayer.name as string) ?? '',
                    race: (flatPlayer.race as string) ?? '',
                    characterClass: (flatPlayer.character_class as string) ?? '',
                    gender: (flatPlayer.gender as string) ?? '',
                    age: (flatPlayer.age as number) ?? 0,
                    appearance: (flatPlayer.appearance as string[]) ?? [],
                    avatarPath: (flatPlayer.avatar_path as string) ?? '',
                    unitSpritePath: (flatPlayer.unit_sprite_path as string) ?? '',
                },
                dynamic: {
                    level: (flatPlayer.level as number) ?? 1,
                    experience: (flatPlayer.experience as number) ?? 0,
                    hp: (flatPlayer.hp as number) ?? 100,
                    maxHp: (flatPlayer.max_hp as number) ?? 100,
                    mana: (flatPlayer.mana as number) ?? 50,
                    maxMana: (flatPlayer.max_mana as number) ?? 50,
                    posX: (flatPlayer.pos_x as number) ?? 0,
                    posY: (flatPlayer.pos_y as number) ?? 0,
                    gold: (flatPlayer.gold as number) ?? 0,
                    inventory: (flatPlayer.inventory as string[]) ?? [],
                    equipment: (flatPlayer.equipment as Record<string, string | undefined>) ?? {},
                    questLog: (flatPlayer.quest_log as string[]) ?? [],
                },
            },
            quests: (data.quests as QuestState[]) ?? [],
            persistence: (data.persistence as string[]) ?? [],
            npcDynamicData: (data.npc_dynamic_data as Record<string, Record<string, unknown>>) ?? {},
        });
    }

    return createSaveData();
};

/**
 * Serialize save data to a JSON string.
 */
export const saveDataToJson = (save: GameSaveData): string => {
    return JSON.stringify({
        ...save,
        timestamp: Date.now(),
    });
};

/**
 * Deserialize save data from a JSON string.
 */
export const saveDataFromJson = (json: string): GameSaveData => {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return migrateSaveData(parsed);
};
