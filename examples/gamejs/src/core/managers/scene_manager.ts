// apps/frontend/gamejs/src/core/managers/scene_manager.ts
/**
 * Scene transition manager with:
 * - Async scene loading with progress tracking
 * - Transition presets (fade, instant)
 * - Scene stack (push/pop for nested menus)
 * - Type-safe scene registry
 * - Preloading support
 */
import { Node, Color } from 'godot';
import { logger } from '../../utils/logger';

export enum TransitionType {
    INSTANT = 'instant',
    FADE = 'fade',
}

export enum SceneName {
    MAIN_MENU = 'main_menu',
    CHARACTER_CREATION = 'character_creation',
    MAIN_GAME = 'main_game',
    PAUSE_MENU = 'pause_menu',
    SETTINGS = 'settings',
}

export type SceneRegistryEntry = {
    path: string;
    preload?: boolean;
};

export type SceneTransitionOptions = {
    transition?: TransitionType;
    duration?: number;
    pauseGame?: boolean;
    positionOffset?: { x: number; y: number };
};

export type SceneStackEntry = {
    scenePath: string;
    sceneName?: SceneName;
    options: SceneTransitionOptions;
};

const SCENE_REGISTRY: Record<SceneName, SceneRegistryEntry> = {
    [SceneName.MAIN_MENU]: {
        path: 'res://src/interface/menus/main/main_menu.tscn',
    },
    [SceneName.CHARACTER_CREATION]: {
        path: 'res://src/interface/menus/main/character_creation/character_creation.tscn',
    },
    [SceneName.MAIN_GAME]: {
        path: 'res://src/scenes/main/main_game.tscn',
        preload: true,
    },
    [SceneName.PAUSE_MENU]: {
        path: 'res://src/interface/menus/pause/pause_menu.tscn',
    },
    [SceneName.SETTINGS]: {
        path: 'res://src/interface/menus/main/settings/settings.tscn',
    },
};

const DEFAULT_TRANSITION_OPTIONS: SceneTransitionOptions = {
    transition: TransitionType.FADE,
    duration: 0.3,
    pauseGame: false,
    positionOffset: { x: 0, y: 0 },
};

export type SceneLoadListener = (sceneName: SceneName | string) => void;

/**
 * Manages scene transitions, loading, and a navigable scene stack.
 * Implemented as a singleton autoload.
 */
export default class SceneManager extends Node {
    private static _instance: SceneManager | null = null;

    private _sceneStack: SceneStackEntry[] = [];
    private _isTransitioning: boolean = false;
    private _currentSceneName: SceneName | string = '';
    private _currentScenePath: string = '';
    private _tilemapBounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

    private _loadStartListeners: SceneLoadListener[] = [];
    private _loadCompleteListeners: SceneLoadListener[] = [];

    static get instance(): SceneManager | null {
        return SceneManager._instance;
    }

    get currentScenePath(): string {
        return this._currentScenePath;
    }

    get currentSceneName(): string {
        return this._currentSceneName;
    }

    get isTransitioning(): boolean {
        return this._isTransitioning;
    }

    _ready(): void {
        logger.debug('SceneManager._ready');
        SceneManager._instance = this;
        (globalThis as Record<string, unknown>).sceneManagerInstance = this;
    }

    // --- SCENE LOADING ---

    /**
     * Change to a registered scene by name.
     */
    async changeScene(sceneName: SceneName, options?: SceneTransitionOptions): Promise<void> {
        logger.debug('SceneManager.changeScene', sceneName);
        const entry = SCENE_REGISTRY[sceneName];
        if (!entry) {
            logger.error('SceneManager.changeScene', `Unknown scene: ${sceneName}`);
            return;
        }
        await this._changeScene(entry.path, sceneName, options);
    }

    /**
     * Change to a scene by raw file path.
     */
    async changeSceneByPath(scenePath: string, options?: SceneTransitionOptions): Promise<void> {
        logger.debug('SceneManager.changeSceneByPath', scenePath);
        await this._changeScene(scenePath, scenePath, options);
    }

    private async _changeScene(
        scenePath: string,
        sceneName: SceneName | string,
        options?: SceneTransitionOptions,
    ): Promise<void> {
        if (this._isTransitioning) {
            logger.warn('SceneManager._changeScene', 'Transition already in progress');
            return;
        }

        const mergedOptions = { ...DEFAULT_TRANSITION_OPTIONS, ...options };
        this._isTransitioning = true;

        this._emitLoadStart(sceneName);

        if (mergedOptions.pauseGame) {
            this.get_tree().paused = true;
        }

        try {
            // Out transition
            await this._playTransitionOut(mergedOptions);

            // Change scene
            this.get_tree().change_scene_to_file(scenePath);
            this._currentScenePath = scenePath;
            this._currentSceneName = sceneName;

            // Wait a frame for scene to load
            await this._waitFrame();

            // In transition
            await this._playTransitionIn(mergedOptions);

            if (mergedOptions.pauseGame) {
                this.get_tree().paused = false;
            }

            this._emitLoadComplete(sceneName);
        } catch (error) {
            logger.error('SceneManager._changeScene', error);
            this.get_tree().paused = false;
        } finally {
            this._isTransitioning = false;
        }
    }

    // --- SCENE STACK ---

    /**
     * Push a scene onto the stack and navigate to it.
     * Use popScene() to return to the previous scene.
     */
    async pushScene(sceneName: SceneName, options?: SceneTransitionOptions): Promise<void> {
        logger.debug('SceneManager.pushScene', sceneName);
        const entry = SCENE_REGISTRY[sceneName];
        if (!entry) {
            return;
        }

        this._sceneStack.push({
            scenePath: this._currentScenePath,
            sceneName: this._currentSceneName as SceneName,
            options: { ...DEFAULT_TRANSITION_OPTIONS },
        });

        await this._changeScene(entry.path, sceneName, options);
    }

    /**
     * Pop the current scene and return to the previous one.
     */
    async popScene(options?: SceneTransitionOptions): Promise<void> {
        logger.debug('SceneManager.popScene');
        const previous = this._sceneStack.pop();
        if (!previous) {
            logger.warn('SceneManager.popScene', 'Scene stack is empty');
            return;
        }

        await this._changeScene(previous.scenePath, previous.sceneName ?? previous.scenePath, options);
    }

    /**
     * Get the current scene stack depth.
     */
    getStackDepth(): number {
        return this._sceneStack.length;
    }

    /**
     * Clear the scene stack.
     */
    clearStack(): void {
        logger.debug('SceneManager.clearStack');
        this._sceneStack = [];
    }

    // --- TRANSITIONS ---

    private async _playTransitionOut(options: SceneTransitionOptions): Promise<void> {
        switch (options.transition) {
            case TransitionType.FADE:
                await this._fadeOut(options.duration ?? 0.3);
                break;
            case TransitionType.INSTANT:
            default:
                break;
        }
    }

    private async _playTransitionIn(options: SceneTransitionOptions): Promise<void> {
        switch (options.transition) {
            case TransitionType.FADE:
                await this._fadeIn(options.duration ?? 0.3);
                break;
            case TransitionType.INSTANT:
            default:
                break;
        }
    }

    private _fadeOut(duration: number): Promise<void> {
        return new Promise((resolve) => {
            const overlay = this._getOrCreateOverlay();
            overlay.visible = true;
            overlay.modulate = new Color(0, 0, 0, 0);

            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const t = Math.min(1, elapsed / duration);
                overlay.modulate = new Color(0, 0, 0, t);

                if (t >= 1) {
                    clearInterval(interval);
                    resolve();
                }
            }, 16);
        });
    }

    private _fadeIn(duration: number): Promise<void> {
        return new Promise((resolve) => {
            const overlay = this._getOrCreateOverlay();
            overlay.modulate = new Color(0, 0, 0, 1);

            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const t = Math.min(1, elapsed / duration);
                overlay.modulate = new Color(0, 0, 0, 1 - t);

                if (t >= 1) {
                    overlay.visible = false;
                    clearInterval(interval);
                    resolve();
                }
            }, 16);
        });
    }

    private _overlay: { visible: boolean; modulate: Color } | null = null;

    private _getOrCreateOverlay(): { visible: boolean; modulate: Color } {
        if (!this._overlay) {
            this._overlay = { visible: false, modulate: new Color(0, 0, 0, 0) };
        }
        return this._overlay;
    }

    private _waitFrame(): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, 16);
        });
    }

    // --- TILEMAP BOUNDS ---

    setTilemapBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void {
        logger.debug('SceneManager.setTilemapBounds', bounds);
        this._tilemapBounds = bounds;
    }

    getTilemapBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
        return this._tilemapBounds;
    }

    // --- LISTENERS ---

    connectLoadStarted(listener: SceneLoadListener): void {
        this._loadStartListeners.push(listener);
    }

    disconnectLoadStarted(listener: SceneLoadListener): void {
        this._loadStartListeners = this._loadStartListeners.filter((l) => l !== listener);
    }

    connectLoadCompleted(listener: SceneLoadListener): void {
        this._loadCompleteListeners.push(listener);
    }

    disconnectLoadCompleted(listener: SceneLoadListener): void {
        this._loadCompleteListeners = this._loadCompleteListeners.filter((l) => l !== listener);
    }

    private _emitLoadStart(sceneName: SceneName | string): void {
        for (const listener of this._loadStartListeners) {
            listener(sceneName);
        }
    }

    private _emitLoadComplete(sceneName: SceneName | string): void {
        for (const listener of this._loadCompleteListeners) {
            listener(sceneName);
        }
    }

    // --- REGISTRY ---

    /**
     * Get the file path for a registered scene.
     */
    getScenePath(sceneName: SceneName): string | undefined {
        return SCENE_REGISTRY[sceneName]?.path;
    }

    /**
     * Check if a scene should be preloaded.
     */
    shouldPreload(sceneName: SceneName): boolean {
        return SCENE_REGISTRY[sceneName]?.preload ?? false;
    }
}

export { SceneManager };
