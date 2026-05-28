// apps/frontend/gamejs/src/core/models/player.ts
/**
 * Pure TypeScript player model types.
 * Separates static character creation data from dynamic runtime state.
 * No Godot imports — safe for unit testing and worker threads.
 */

/** Equipment slot types. */
export enum EquippedSlot {
    HEAD = 'head',
    CHEST = 'chest',
    LEGS = 'legs',
    FEET = 'feet',
    MAIN_HAND = 'main_hand',
    OFF_HAND = 'off_hand',
    RING = 'ring',
    NECKLACE = 'necklace',
}

/** Static data set at character creation. */
export type PlayerStaticData = {
    id: string;
    name: string;
    race: string;
    characterClass: string;
    gender: string;
    age: number;
    appearance: string[];
    avatarPath: string;
    unitSpritePath: string;
};

/** Dynamic data that changes during gameplay. */
export type PlayerDynamicData = {
    level: number;
    experience: number;
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    posX: number;
    posY: number;
    gold: number;
    inventory: string[];
    equipment: Record<EquippedSlot, string | undefined>;
    questLog: string[];
};

/** Combined player snapshot. */
export type PlayerSnapshot = {
    static: PlayerStaticData;
    dynamic: PlayerDynamicData;
};

const DEFAULT_DYNAMIC: PlayerDynamicData = {
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
        [EquippedSlot.HEAD]: undefined,
        [EquippedSlot.CHEST]: undefined,
        [EquippedSlot.LEGS]: undefined,
        [EquippedSlot.FEET]: undefined,
        [EquippedSlot.MAIN_HAND]: undefined,
        [EquippedSlot.OFF_HAND]: undefined,
        [EquippedSlot.RING]: undefined,
        [EquippedSlot.NECKLACE]: undefined,
    },
    questLog: [],
};

/**
 * Create default dynamic data for a new player.
 */
export const createPlayerDynamicData = (overrides?: Partial<PlayerDynamicData>): PlayerDynamicData => ({
    ...DEFAULT_DYNAMIC,
    ...overrides,
    equipment: { ...DEFAULT_DYNAMIC.equipment, ...overrides?.equipment },
});

/**
 * Calculate max health based on level and class.
 * Placeholder — replace with real formula.
 */
export const calculateMaxHealth = (level: number, _characterClass: string): number => {
    return 100 + (level - 1) * 10;
};

/**
 * Calculate max mana based on level and class.
 */
export const calculateMaxMana = (level: number, _characterClass: string): number => {
    return 50 + (level - 1) * 5;
};

/**
 * Add experience and return whether a level-up occurred.
 */
export const addExperience = (
    dynamic: PlayerDynamicData,
    amount: number,
): { newDynamic: PlayerDynamicData; leveledUp: boolean } => {
    const newDynamic = { ...dynamic, experience: dynamic.experience + amount };
    const threshold = dynamic.level * 1000;
    let leveledUp = false;

    if (newDynamic.experience >= threshold) {
        newDynamic.level += 1;
        newDynamic.experience -= threshold;
        newDynamic.maxHp = calculateMaxHealth(newDynamic.level, '');
        newDynamic.maxMana = calculateMaxMana(newDynamic.level, '');
        newDynamic.hp = newDynamic.maxHp;
        newDynamic.mana = newDynamic.maxMana;
        leveledUp = true;
    }

    return { newDynamic, leveledUp };
};

/**
 * Update health with clamping.
 */
export const updateHealth = (dynamic: PlayerDynamicData, delta: number): PlayerDynamicData => {
    const hp = Math.max(0, Math.min(dynamic.maxHp, dynamic.hp + delta));
    return { ...dynamic, hp };
};

/**
 * Equip an item to a slot, returning previous item (if any).
 */
export const equipItem = (
    dynamic: PlayerDynamicData,
    slot: EquippedSlot,
    itemId: string,
): { newDynamic: PlayerDynamicData; previousItem: string | undefined } => {
    const previousItem = dynamic.equipment[slot];
    return {
        newDynamic: {
            ...dynamic,
            equipment: { ...dynamic.equipment, [slot]: itemId },
        },
        previousItem,
    };
};

/**
 * Unequip an item from a slot.
 */
export const unequipItem = (
    dynamic: PlayerDynamicData,
    slot: EquippedSlot,
): { newDynamic: PlayerDynamicData; removedItem: string | undefined } => {
    const removedItem = dynamic.equipment[slot];
    return {
        newDynamic: {
            ...dynamic,
            equipment: { ...dynamic.equipment, [slot]: undefined },
        },
        removedItem,
    };
};

/**
 * Serialize player snapshot to JSON.
 */
export const playerSnapshotToJson = (snapshot: PlayerSnapshot): Record<string, unknown> => ({
    static: snapshot.static,
    dynamic: snapshot.dynamic,
});

/**
 * Deserialize player snapshot from JSON.
 */
export const playerSnapshotFromJson = (data: Record<string, unknown>): PlayerSnapshot => ({
    static: data.static as PlayerStaticData,
    dynamic: {
        ...DEFAULT_DYNAMIC,
        ...(data.dynamic as Record<string, unknown> ?? {}),
    } as PlayerDynamicData,
});
