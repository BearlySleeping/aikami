// apps/e2e/src/fixtures/engine_replay.ts
//
// Engine Replay Fixture — records command logs during the release gate
// E2E run and replays them in a Bun test runtime with seeded RNG for
// deterministic mechanical outcome assertion.
//
// Contract: C-335 AC-8 — Engine Replay Determinism
// Dependency: C-336 — Deterministic Rules Kernel (not yet implemented)
//
// Until C-336 is implemented, this fixture records commands but cannot
// assert mechanical equality. The assertion is marked test.skip with a
// reference to C-336.

import type { Page } from '@playwright/test';

// ── Type Definitions ─────────────────────────────────────────

/** A single engine command recorded during the gate run. */
export type EngineCommand = {
  /** Command type (e.g., 'move', 'interact', 'attack', 'defend', 'useItem') */
  type: string;
  /** Command payload (e.g., { direction: 'right' }, { itemId: 'abc' }) */
  payload: Record<string, unknown>;
  /** Timestamp in ms since epoch */
  timestamp: number;
};

/** A recorded engine replay snapshot. */
export type EngineReplaySnapshot = {
  /** Seed used for the RNG during the recorded run */
  seed: number;
  /** Ordered command log from the production gate run */
  commands: EngineCommand[];
  /** Final mechanical snapshot (positions, HP, inventory, quest flags) */
  finalSnapshot: Record<string, unknown>;
  /** Contract version for compatibility */
  contractVersion: string;
  /** Timestamp of the recording */
  recordedAt: string;
};

// ── Recording Fixture ────────────────────────────────────────

/**
 * Engine command recorder — injected into a Playwright page to collect
 * engine commands during the release gate run. Commands are pushed by
 * the game engine via window.__ENGINE_COMMANDS__.
 */
export class EngineReplayRecorder {
  private readonly _commands: EngineCommand[] = [];
  private _seed: number = 0;
  private _page: Page;

  constructor(page: Page) {
    this._page = page;
  }

  /** Begin recording. Exposes a command collector on the page. */
  async startRecording(): Promise<void> {
    // Clear any previous commands
    this._commands.length = 0;

    // Expose a function to forward commands from browser to Node context
    await this._page.exposeFunction('__ENGINE_RECORD_COMMAND__', (cmd: EngineCommand) => {
      this._commands.push(cmd);
    });

    // Install recording proxy on every page load (survives reloads)
    await this._page.addInitScript(() => {
      // @ts-expect-error — window augmentation for engine commands
      window.__ENGINE_COMMANDS__ = [];
      // Override push to forward to Node-side collector
      const originalPush = window.__ENGINE_COMMANDS__.push;
      // @ts-expect-error — window augmentation
      window.__ENGINE_COMMANDS__.push = function (...cmds: EngineCommand[]) {
        for (const cmd of cmds) {
          // @ts-expect-error — window augmentation (exposed function)
          if (typeof window.__ENGINE_RECORD_COMMAND__ === 'function') {
            // @ts-expect-error — window augmentation
            window.__ENGINE_RECORD_COMMAND__(cmd);
          }
        }
        return originalPush.apply(this, cmds);
      };
    });
  }

  /** Stop recording and return the snapshot. */
  async stopRecording(): Promise<EngineReplaySnapshot> {
    // Commands are already in this._commands via exposeFunction
    // No need to extract from page context

    // Extract seed from campaign state
    const seed = await this._page.evaluate(() => {
      // @ts-expect-error — window augmentation for engine seed
      return window.__ENGINE_SEED__ ?? Date.now();
    });
    this._seed = seed;

    // Capture final mechanical snapshot
    const finalSnapshot = await this._page.evaluate(() => {
      // @ts-expect-error — window augmentation for game state
      return window.__ENGINE_SNAPSHOT__ ?? {};
    });

    return {
      seed: this._seed,
      commands: [...this._commands],
      finalSnapshot,
      contractVersion: 'C-335',
      recordedAt: new Date().toISOString(),
    };
  }

  /** Get the number of commands recorded so far. */
  get commandCount(): number {
    return this._commands.length;
  }
}

// ── Replay Runner (Bun Test Runtime) ─────────────────────────

/**
 * Replay a recorded engine command log with a seeded RNG.
 * Asserts that the final mechanical snapshot matches the original.
 *
 * This function is designed to run in Bun test, not Playwright.
 * It imports the game engine directly and runs commands through it.
 *
 * @remarks
 * Marked as async placeholder until C-336 provides the deterministic rules kernel.
 */
export const replayEngineCommands = async (
  _snapshot: EngineReplaySnapshot,
): Promise<{
  matches: boolean;
  finalSnapshot: Record<string, unknown>;
}> => {
  // TODO(C-336): Replace with deterministic rules kernel replay
  // Once C-336 implements the deterministic rules kernel, this function will:
  // 1. Seed the RNG with snapshot.seed
  // 2. Create a fresh game world
  // 3. Replay each command through the engine
  // 4. Compare the final mechanical snapshot with snapshot.finalSnapshot
  //
  // For now, we validate the snapshot structure only.
  return {
    matches: false,
    finalSnapshot: {},
  };
};

// ── Snapshot Persistence ─────────────────────────────────────

/**
 * Save a recorded snapshot to a JSON file for later replay.
 * Used during the AC-1 gate run to produce test artifacts.
 */
export const saveReplaySnapshot = (snapshot: EngineReplaySnapshot): string => {
  // In Bun test context, write to a test artifacts directory
  const fs = require('node:fs');
  const path = require('node:path');

  const artifactsDir = path.resolve(process.cwd(), '.e2e-artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const filename = `engine-replay-${snapshot.seed}-${Date.now()}.json`;
  const filePath = path.join(artifactsDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
};

/**
 * Load a replay snapshot from a JSON file.
 */
export const loadReplaySnapshot = (filePath: string): EngineReplaySnapshot => {
  const fs = require('node:fs');
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as EngineReplaySnapshot;
};
