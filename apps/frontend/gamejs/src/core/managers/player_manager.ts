// apps/frontend/gamejs/src/core/managers/player_manager.ts
/**
 * Player entity manager.
 * Manages the player data snapshot, equipment, and node instance.
 * Uses dirty tracking to optimize save operations.
 */
import { Node, Node2D } from 'godot';
import { logger } from '../../utils/logger';
import {
    type PlayerSnapshot,
    type EquippedSlot,
    createPlayerDynamicData,
    updateHealth,
    equipItem,
    unequipItem,
    addExperience,
    playerSnapshotToJson,
    playerSnapshotFromJson,
} from '../models/player';

export type PlayerManagerOptions = {
    snapshot?: PlayerSnapshot;
};

export type PlayerHealthListener = (hp: number, maxHp: number) => void;
export type PlayerPositionListener = (x: number, y: number) => void;
export type PlayerLevelUpListener = (level: number) => void;

/**
 * Central manager for the player entity.
 * Tracks data, equipment, and the optional scene node instance.
 */
export default class PlayerManager extends Node {
    private static _instance: PlayerManager | null = null;

    private _snapshot: PlayerSnapshot = {
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
        dynamic: createPlayerDynamicData(),
    };
    private _dirty: boolean = false;
    private _playerNode: Node2D | null = null;

    private _healthListeners: PlayerHealthListener[] = [];
    private _positionListeners: PlayerPositionListener[] = [];
    private _levelUpListeners: PlayerLevelUpListener[] = [];

    static get instance(): PlayerManager | null {
        return PlayerManager._instance;
    }

    get snapshot(): PlayerSnapshot {
        return this._snapshot;
    }

    get isDirty(): boolean {
        return this._dirty;
    }

    _ready(): void {
        logger.debug('PlayerManager._ready');
        PlayerManager._instance = this;
        (globalThis as Record<string, unknown>).playerManagerInstance = this;
    }

    /**
     * Initialize the player with a snapshot.
     */
    initialize(options: PlayerManagerOptions): void {
        logger.debug('PlayerManager.initialize');
        if (options.snapshot) {
            this._snapshot = options.snapshot;
        }
        this._dirty = false;
    }

    // --- DATA ACCESSORS ---

    getName(): string {
        return this._snapshot.static.name;
    }

    getLevel(): number {
        return this._snapshot.dynamic.level;
    }

    getHp(): number {
        return this._snapshot.dynamic.hp;
    }

    getMaxHp(): number {
        return this._snapshot.dynamic.maxHp;
    }

    getPosition(): { x: number; y: number } {
        return { x: this._snapshot.dynamic.posX, y: this._snapshot.dynamic.posY };
    }

    getEquipment(): Record<EquippedSlot, string | undefined> {
        return { ...this._snapshot.dynamic.equipment };
    }

    getInventory(): string[] {
        return [...this._snapshot.dynamic.inventory];
    }

    // --- MUTATIONS ---

    setSnapshot(snapshot: PlayerSnapshot): void {
        logger.debug('PlayerManager.setSnapshot', { name: snapshot.static.name });
        this._snapshot = snapshot;
        this._dirty = true;
    }

    updatePosition(x: number, y: number): void {
        if (this._snapshot.dynamic.posX === x && this._snapshot.dynamic.posY === y) {
            return;
        }
        this._snapshot.dynamic.posX = x;
        this._snapshot.dynamic.posY = y;
        this._dirty = true;
        for (const listener of this._positionListeners) {
            listener(x, y);
        }
    }

    heal(amount: number): void {
        logger.debug('PlayerManager.heal', amount);
        const oldHp = this._snapshot.dynamic.hp;
        this._snapshot.dynamic = updateHealth(this._snapshot.dynamic, amount);
        if (oldHp !== this._snapshot.dynamic.hp) {
            this._dirty = true;
            this._emitHealthChanged();
        }
    }

    takeDamage(amount: number): void {
        logger.debug('PlayerManager.takeDamage', amount);
        const oldHp = this._snapshot.dynamic.hp;
        this._snapshot.dynamic = updateHealth(this._snapshot.dynamic, -amount);
        if (oldHp !== this._snapshot.dynamic.hp) {
            this._dirty = true;
            this._emitHealthChanged();
        }
    }

    addExperiencePoints(amount: number): void {
        logger.debug('PlayerManager.addExperiencePoints', amount);
        const result = addExperience(this._snapshot.dynamic, amount);
        this._snapshot.dynamic = result.newDynamic;
        this._dirty = true;
        if (result.leveledUp) {
            logger.info('PlayerManager.addExperiencePoints', `Level up! Now level ${result.newDynamic.level}`);
            for (const listener of this._levelUpListeners) {
                listener(result.newDynamic.level);
            }
            this._emitHealthChanged();
        }
    }

    equip(slot: EquippedSlot, itemId: string): string | undefined {
        logger.debug('PlayerManager.equip', { slot, itemId });
        const result = equipItem(this._snapshot.dynamic, slot, itemId);
        this._snapshot.dynamic = result.newDynamic;
        this._dirty = true;
        return result.previousItem;
    }

    unequip(slot: EquippedSlot): string | undefined {
        logger.debug('PlayerManager.unequip', slot);
        const result = unequipItem(this._snapshot.dynamic, slot);
        this._snapshot.dynamic = result.newDynamic;
        this._dirty = true;
        return result.removedItem;
    }

    addToInventory(itemId: string): void {
        logger.debug('PlayerManager.addToInventory', itemId);
        this._snapshot.dynamic.inventory.push(itemId);
        this._dirty = true;
    }

    removeFromInventory(itemId: string): boolean {
        logger.debug('PlayerManager.removeFromInventory', itemId);
        const index = this._snapshot.dynamic.inventory.indexOf(itemId);
        if (index === -1) {
            return false;
        }
        this._snapshot.dynamic.inventory.splice(index, 1);
        this._dirty = true;
        return true;
    }

    addGold(amount: number): void {
        logger.debug('PlayerManager.addGold', amount);
        this._snapshot.dynamic.gold += amount;
        this._dirty = true;
    }

    // --- NODE INSTANCE ---

    setPlayerNode(node: Node2D | null): void {
        logger.debug('PlayerManager.setPlayerNode', node ? 'set' : 'cleared');
        this._playerNode = node;
    }

    getPlayerNode(): Node2D | null {
        return this._playerNode;
    }

    updateNodePosition(): void {
        if (!this._playerNode) {
            return;
        }
        this._playerNode.position.x = this._snapshot.dynamic.posX;
        this._playerNode.position.y = this._snapshot.dynamic.posY;
    }

    // --- LISTENERS ---

    connectHealthChanged(listener: PlayerHealthListener): void {
        this._healthListeners.push(listener);
    }

    disconnectHealthChanged(listener: PlayerHealthListener): void {
        this._healthListeners = this._healthListeners.filter((l) => l !== listener);
    }

    connectPositionChanged(listener: PlayerPositionListener): void {
        this._positionListeners.push(listener);
    }

    disconnectPositionChanged(listener: PlayerPositionListener): void {
        this._positionListeners = this._positionListeners.filter((l) => l !== listener);
    }

    connectLevelUp(listener: PlayerLevelUpListener): void {
        this._levelUpListeners.push(listener);
    }

    disconnectLevelUp(listener: PlayerLevelUpListener): void {
        this._levelUpListeners = this._levelUpListeners.filter((l) => l !== listener);
    }

    private _emitHealthChanged(): void {
        for (const listener of this._healthListeners) {
            listener(this._snapshot.dynamic.hp, this._snapshot.dynamic.maxHp);
        }
    }

    // --- SERIALIZATION ---

    toJson(): Record<string, unknown> {
        return playerSnapshotToJson(this._snapshot);
    }

    fromJson(data: Record<string, unknown>): void {
        this._snapshot = playerSnapshotFromJson(data);
        this._dirty = true;
    }

    /**
     * Mark the player data as clean (recently saved).
     */
    markClean(): void {
        this._dirty = false;
    }

    /**
     * Reset player to default state.
     */
    reset(): void {
        logger.info('PlayerManager.reset', 'Resetting player data');
        this._snapshot = {
            static: this._snapshot.static,
            dynamic: createPlayerDynamicData(),
        };
        this._dirty = true;
    }
}

export { PlayerManager };
