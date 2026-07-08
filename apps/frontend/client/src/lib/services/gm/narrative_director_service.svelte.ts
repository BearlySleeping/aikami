// apps/frontend/client/src/lib/services/gm/narrative_director_service.svelte.ts
//
// Background LLM agent that generates SceneDirection objects at
// configurable intervals. Persists ArcMemory via gameSaveService
// serialization and injects narrative guidance into GM prompts.
//
// Contract: C-235 GM Narrative Director

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { textGenerationService } from '$services';
import { registerSerializable, type SerializableService } from '../game/serializable_service';
import type { ArcMemory, SceneDirection } from './gm_types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NarrativeDirectorServiceOptions = BaseFrontendClassOptions;

export type NarrativeDirectorServiceInterface = BaseFrontendClassInterface & {
  /** Whether the background interval is currently active. */
  readonly isRunning: boolean;

  /** The current arc memory, or null if no arc has been generated. */
  readonly currentArc: ArcMemory | null;

  /** All generated scene directions in the current session. */
  readonly sceneDirections: ReadonlyArray<SceneDirection>;

  /** Count of scene directions generated in this arc. */
  readonly sceneDirectionCount: number;

  /**
   * Starts the background narrative generation interval.
   * Generates a new SceneDirection every `intervalMs` milliseconds.
   *
   * @param intervalMs - Interval between generations (default: 120000 = 2 min).
   */
  start(intervalMs?: number): void;

  /**
   * Stops the background generation interval.
   */
  stop(): void;

  /**
   * Manually generates a new scene direction on demand.
   * Called by the Push Story UI button.
   */
  pushStory(): Promise<void>;

  /**
   * Loads arc memory from a previously serialized snapshot.
   *
   * @param arc - The arc memory to restore.
   */
  loadArc(arc: ArcMemory): void;

  /**
   * Marks the current arc as completed.
   */
  completeArc(): void;

  /** Serialized state for save/load. */
  readonly serializableState: ArcMemory | null;
};

// ---------------------------------------------------------------------------
// Arc memory serialization state
// ---------------------------------------------------------------------------

type ArcMemorySnapshot = {
  arcMemory: ArcMemory | null;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class NarrativeDirectorService
  extends BaseFrontendClass<NarrativeDirectorServiceOptions>
  implements NarrativeDirectorServiceInterface, SerializableService<ArcMemorySnapshot>
{
  private _isRunning = $state(false);
  private _currentArc = $state<ArcMemory | null>(null);
  private _sceneDirections = $state<SceneDirection[]>([]);
  private _intervalId: ReturnType<typeof setInterval> | undefined = undefined;
  private _intervalMs = 120_000;

  constructor(options: NarrativeDirectorServiceOptions) {
    super(options);
    registerSerializable('narrativeDirector', this as unknown as SerializableService<unknown>);
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get currentArc(): ArcMemory | null {
    return this._currentArc;
  }

  get sceneDirections(): ReadonlyArray<SceneDirection> {
    return this._sceneDirections;
  }

  get sceneDirectionCount(): number {
    return this._sceneDirections.length;
  }

  /** @inheritdoc */
  get serializableState(): ArcMemory | null {
    return this._currentArc;
  }

  // ── Public methods ──────────────────────────────────────────────────

  /** @inheritdoc */
  start(intervalMs: number = 120_000): void {
    if (this._isRunning) {
      this.debug('start:already-running');
      return;
    }

    this._isRunning = true;
    this._intervalMs = intervalMs;

    // Initialize a new arc if none exists
    if (!this._currentArc) {
      this._currentArc = {
        arcId: crypto.randomUUID(),
        arcName: `Arc ${new Date().toLocaleDateString()}`,
        description: 'Current narrative arc',
        sceneDirections: [],
        isCompleted: false,
        updatedAt: Date.now(),
      };
    }

    this._intervalId = setInterval(() => {
      void this._generateSceneDirection();
    }, this._intervalMs);

    this.debug('start', { intervalMs });
  }

  /** @inheritdoc */
  stop(): void {
    if (!this._isRunning) {
      return;
    }

    this._isRunning = false;

    if (this._intervalId !== undefined) {
      clearInterval(this._intervalId);
      this._intervalId = undefined;
    }

    this.debug('stop');
  }

  /** @inheritdoc */
  async pushStory(): Promise<void> {
    this.debug('pushStory:manual-trigger');
    await this._generateSceneDirection();
  }

  /** @inheritdoc */
  loadArc(arc: ArcMemory): void {
    this._currentArc = arc;
    this._sceneDirections = [...arc.sceneDirections];
    this.debug('loadArc', { arcId: arc.arcId, directionCount: arc.sceneDirections.length });
  }

  /** @inheritdoc */
  completeArc(): void {
    if (!this._currentArc) {
      return;
    }

    this._currentArc = {
      ...this._currentArc,
      isCompleted: true,
      updatedAt: Date.now(),
    };

    this.debug('completeArc', { arcId: this._currentArc.arcId });
  }

  // ── SerializableService ─────────────────────────────────────────────

  serialize(): ArcMemorySnapshot {
    return {
      arcMemory: this._currentArc,
    };
  }

  hydrate(data: ArcMemorySnapshot): void {
    if (data.arcMemory) {
      this.loadArc(data.arcMemory);
    }
  }

  // ── Private: Scene direction generation ─────────────────────────────

  /**
   * Generates a new scene direction via a low-temperature LLM call.
   * Appends the result to the current arc memory.
   */
  private async _generateSceneDirection(): Promise<void> {
    if (!this._currentArc) {
      this.debug('_generateSceneDirection:no-arc');
      return;
    }

    this.debug('_generateSceneDirection');

    try {
      const prompt = [
        'You are a Game Master generating a brief narrative scene direction for a fantasy RPG.',
        '',
        'Current arc:',
        `  Name: ${this._currentArc.arcName}`,
        `  Description: ${this._currentArc.description}`,
        '',
        this._sceneDirections.length > 0
          ? `There are ${this._sceneDirections.length} prior scene directions in this arc.`
          : 'This is the first scene direction in this arc.',
        '',
        'Respond with a JSON object:',
        '{',
        '  "description": "A 2-4 sentence scene description setting the mood and environment.",',
        '  "playerGuidance": "Optional 1-2 sentence hint about what the player might do next."',
        '}',
        '',
        'Keep the description vivid but concise. Do not resolve player actions — just set the scene.',
      ].join('\n');

      const result = (await textGenerationService.extractStructure({
        schema: {
          type: 'object',
          properties: {
            description: { type: 'string', minLength: 1 },
            playerGuidance: { type: 'string' },
          },
          required: ['description'],
          additionalProperties: false,
        },
        schemaName: 'SceneDirection',
        prompt,
        systemPrompt:
          'Generate concise fantasy RPG scene directions. JSON only. No markdown, no explanations.',
      })) as { description: string; playerGuidance?: string };

      const direction: SceneDirection = {
        id: crypto.randomUUID(),
        description: result.description,
        playerGuidance: result.playerGuidance,
        createdAt: Date.now(),
        acknowledged: false,
      };

      this._sceneDirections = [...this._sceneDirections, direction];
      this._currentArc = {
        ...this._currentArc,
        sceneDirections: this._sceneDirections,
        updatedAt: Date.now(),
      };

      this.debug('_generateSceneDirection:complete', {
        directionId: direction.id,
        descriptionLength: direction.description.length,
        totalDirections: this._sceneDirections.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn('_generateSceneDirection:failed', { message });
    }
  }
}

export { NarrativeDirectorService };

/**
 * Shared singleton instance of the narrative director service.
 */
export const narrativeDirectorService: NarrativeDirectorServiceInterface =
  NarrativeDirectorService.create({
    className: 'NarrativeDirectorService',
  }) as NarrativeDirectorServiceInterface;
