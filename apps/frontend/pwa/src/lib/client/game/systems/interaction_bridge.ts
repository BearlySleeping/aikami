// apps/frontend/pwa/src/lib/client/game/systems/interaction_bridge.ts

import type { InteractableNpcEntry } from './interaction_system.ts';

// ---------------------------------------------------------------------------
// InteractionBridge — ECS → Stream Orchestrator adapter
//
// Intercepts ECS interaction events (via GameWorld.onInteractRequest) and
// translates them into Stream Orchestrator `generateDialogue` calls.
// Manages input locking via GameWorld.setInputLocked() and guards against
// rapid re-triggering when a generation is already in progress.
//
// Dependency-injected: receives the dialogue generator (orchestrator) and
// an input-lock setter from the consuming application (PWA or game shell).
// The game package defines the interface; the PWA provides the concrete
// orchestrator.
// ---------------------------------------------------------------------------

/** Options passed to {@link DialogueGenerator.generateDialogue}. */
export type DialogueGeneratorOptions = {
  prompt: string;
  npcId: string;
  personaId: string;
};

/**
 * Minimal contract that the Stream Orchestrator (or any text-generation
 * backend) must satisfy for the bridge to control it.
 *
 * Lives in the game package so the bridge can depend on it without
 * importing Svelte/PWA internals.
 */
export type DialogueGeneratorInterface = {
  /** Whether a generation is currently in progress. */
  readonly isGenerating: boolean;

  /** Accumulated progressive text from the active generation. */
  readonly currentText: string;

  /** Initiates a dialogue generation cycle for the given NPC. */
  generateDialogue(options: DialogueGeneratorOptions): Promise<void>;

  /** Cancels the active generation and tears down streams. */
  cancelGeneration(): void;
};

/** Minimal input-lock contract exposed by GameWorld. */
export type InputLockTarget = {
  setInputLocked(locked: boolean): void;
};

export type InteractionBridgeOptions = {
  /** The dialogue generator (StreamOrchestrator or compatible mock). */
  generator: DialogueGeneratorInterface;
  /** Target for locking/unlocking player input during dialogue. */
  inputLock: InputLockTarget;
};

/**
 * Bridges the ECS interaction system with the streaming dialogue generator.
 *
 * Register `bridge.handleInteractStart` as the `onInteractRequest` callback
 * on `GameWorld`. The bridge will then:
 *
 * 1. Lock player input.
 * 2. Call `generator.generateDialogue()` with NPC metadata.
 * 3. Ignore subsequent interaction keypresses while `isGenerating` is true.
 *
 * The consumer (PWA/game shell) is responsible for subscribing to
 * `generator.currentText` and updating the dialogue UI, and for wiring
 * the abort/close button to `generator.cancelGeneration()`.
 */
export class InteractionBridge {
  private readonly _generator: DialogueGeneratorInterface;
  private readonly _inputLock: InputLockTarget;

  constructor(options: InteractionBridgeOptions) {
    this._generator = options.generator;
    this._inputLock = options.inputLock;
  }

  /**
   * Handles an interaction start triggered by the player pressing the
   * interact key near an NPC.
   *
   * Guards against rapid re-triggering: if a generation is already in
   * progress, the interaction is silently ignored.
   *
   * @param npc - The interactable NPC metadata from the interaction system.
   * @returns `true` if the generation was started, `false` if ignored.
   */
  handleInteractStart(npc: InteractableNpcEntry): boolean {
    // Rapid re-trigger guard — ignore when already generating
    if (this._generator.isGenerating) {
      return false;
    }

    // Lock player input while dialogue is active
    this._inputLock.setInputLocked(true);

    // Initiate streaming dialogue generation
    void this._generator.generateDialogue({
      prompt: `Player interacts with ${npc.npcName}`,
      npcId: npc.npcId,
      personaId: npc.personaId,
    });

    return true;
  }

  /**
   * Called when the dialogue ends (via abort, close, or completion).
   *
   * Cancels any active generation and unlocks player input.
   */
  handleInteractEnd(): void {
    this._generator.cancelGeneration();
    this._inputLock.setInputLocked(false);
  }
}
