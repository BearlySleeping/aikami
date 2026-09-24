// apps/e2e/src/pom/npc_approach.ts
import type { Locator, Page } from '@playwright/test';

type EngineEntityPosition = { x: number; y: number };

type NavigationSnapshot = {
  readonly playerX: number;
  readonly playerY: number;
  readonly playerEid: number;
  readonly npcCount: number;
  readonly npcEntityIds: readonly number[];
  readonly npcPositions: Readonly<Record<string, EngineEntityPosition>>;
};

type NpcTarget = EngineEntityPosition & { entityId: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isEntityId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

const isFinitePosition = (value: unknown): value is EngineEntityPosition =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

/** Parses the dynamic browser diagnostic and rejects incomplete NPC state. */
const parseNavigationSnapshot = (value: unknown): NavigationSnapshot | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { playerX, playerY, playerEid, npcCount, npcEntityIds, entityPositions } = value;
  if (
    !isFiniteNumber(playerX) ||
    !isFiniteNumber(playerY) ||
    !isEntityId(playerEid) ||
    !isEntityId(npcCount) ||
    npcCount <= 0 ||
    !Array.isArray(npcEntityIds) ||
    npcEntityIds.length === 0 ||
    npcCount !== npcEntityIds.length ||
    !isRecord(entityPositions)
  ) {
    return undefined;
  }

  const sanitizedNpcIds: number[] = [];
  const npcPositions: Record<string, EngineEntityPosition> = {};
  for (const rawEntityId of npcEntityIds) {
    if (!isEntityId(rawEntityId)) {
      return undefined;
    }
    const entityId = rawEntityId;
    const position = entityPositions[String(entityId)];
    if (!isFinitePosition(position)) {
      return undefined;
    }
    sanitizedNpcIds.push(entityId);
    npcPositions[String(entityId)] = { x: position.x, y: position.y };
  }

  return {
    playerX,
    playerY,
    playerEid,
    npcCount,
    npcEntityIds: sanitizedNpcIds,
    npcPositions,
  };
};

const DIALOGUE_SELECTOR = '[data-testid="dialogue-overlay"], .dialogue-overlay';
const INTERACTION_DISTANCE = 64;
const MAX_APPROACH_STEPS = 90;
const NAVIGATION_READY_TIMEOUT_MS = 45_000;

const readNavigationSnapshot = async (page: Page): Promise<NavigationSnapshot> => {
  const rawSnapshot = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__,
  );
  const snapshot = parseNavigationSnapshot(rawSnapshot);
  if (!snapshot) {
    throw new Error('Engine navigation diagnostics are incomplete');
  }
  return snapshot;
};

const isMapReady = async (page: Page): Promise<boolean> =>
  await page.evaluate(() => {
    const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
      | { isMapReady?: unknown }
      | undefined;
    return typeof seam?.isMapReady === 'function' && seam.isMapReady() === true;
  });

const waitForNavigationReady = async (page: Page): Promise<void> => {
  const deadline = Date.now() + NAVIGATION_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snapshot = await readNavigationSnapshot(page).catch(() => undefined);
    if (snapshot && (await isMapReady(page))) {
      // MAP_LOADED is the production readiness boundary. A short settle lets
      // idle NPCs start a wander route before the first real WASD step.
      await page.waitForTimeout(300);
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('Timed out waiting for finite production navigation diagnostics');
};

const dismissMovementTutorial = async (page: Page): Promise<void> => {
  const skipTutorial = page.getByRole('button', { name: 'Skip tutorial', exact: true });
  if (await skipTutorial.isVisible().catch(() => false)) {
    await skipTutorial.click();
    await page.waitForTimeout(300);
  }
};

const resetToVillageSpawn = async (page: Page): Promise<void> => {
  const loaded = await page.evaluate(async () => {
    const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
      | {
          loadPackMap(options: { mapId: string }): Promise<boolean>;
        }
      | undefined;
    if (!seam || typeof seam.loadPackMap !== 'function') {
      throw new Error('Production map reset test seam is unavailable');
    }
    return await seam.loadPackMap({ mapId: 'village' });
  });
  if (!loaded) {
    throw new Error('Production map loader rejected the village reset');
  }
  await page.waitForFunction(() => {
    const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
      | {
          isMapReady?: () => boolean;
          getCurrentMapId?: () => string;
        }
      | undefined;
    return seam?.isMapReady?.() === true && seam.getCurrentMapId?.() === 'village';
  });
};

const selectNearestNpc = (snapshot: NavigationSnapshot): NpcTarget => {
  const candidates: NpcTarget[] = [];
  for (const entityId of snapshot.npcEntityIds) {
    const position = snapshot.npcPositions[String(entityId)];
    if (!position) {
      throw new Error(`Production NPC ${entityId} has no finite position`);
    }
    candidates.push({ entityId: String(entityId), ...position });
  }
  candidates.sort(
    (left, right) =>
      Math.hypot(left.x - snapshot.playerX, left.y - snapshot.playerY) -
      Math.hypot(right.x - snapshot.playerX, right.y - snapshot.playerY),
  );
  const target = candidates[0];
  if (!target) {
    throw new Error(
      `No production NPC position found for ${snapshot.npcEntityIds.length} registered NPCs`,
    );
  }
  return target;
};

const tapKey = async (page: Page, key: string): Promise<void> => {
  await page.keyboard.down(key);
  try {
    await page.waitForTimeout(120);
  } finally {
    await page.keyboard.up(key);
  }
  await page.waitForTimeout(80);
};

const directionToTarget = (deltaX: number, deltaY: number): string => {
  if (Math.abs(deltaX) > 40) {
    return deltaX > 0 ? 'd' : 'a';
  }
  return deltaY > 0 ? 's' : 'w';
};

const recoveryKeysFor = (key: string): readonly string[] =>
  ['w', 'a', 's', 'd'].filter((candidate) => candidate !== key);

type InteractionResult = {
  readonly opened: boolean;
};

const isDialogueVisible = async (overlay: Locator): Promise<boolean> =>
  overlay.isVisible().catch(() => false);

const attemptInteraction = async (options: {
  readonly page: Page;
  readonly overlay: Locator;
  readonly snapshot: NavigationSnapshot;
  readonly targetPosition: EngineEntityPosition;
}): Promise<InteractionResult> => {
  const { page, overlay, snapshot, targetPosition } = options;
  const deltaX = targetPosition.x - snapshot.playerX;
  const deltaY = targetPosition.y - snapshot.playerY;
  if (Math.hypot(deltaX, deltaY) > INTERACTION_DISTANCE) {
    return { opened: false };
  }

  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  if (await isDialogueVisible(overlay)) {
    return { opened: true };
  }
  // A failed keypress inside the radius is a mount/timing race, not an
  // obstacle; the next step retries E while continuing the direct approach.
  return { opened: false };
};

type MoveRecoveryResult = {
  readonly recoveryIndex: number;
  readonly moved: boolean;
  readonly movedKey?: string;
};

const moveWithRecovery = async (options: {
  readonly page: Page;
  readonly key: string;
  readonly before: EngineEntityPosition;
  readonly recoveryIndex: number;
}): Promise<MoveRecoveryResult> => {
  const { page, key, before, recoveryIndex } = options;
  await tapKey(page, key);
  const afterMove = await readNavigationSnapshot(page);
  const moved = Math.hypot(afterMove.playerX - before.x, afterMove.playerY - before.y);
  if (moved >= 2) {
    return { recoveryIndex: 0, moved: true, movedKey: key };
  }

  const recoveryKeys = recoveryKeysFor(key);
  for (let offset = 0; offset < recoveryKeys.length; offset += 1) {
    const recoveryKey = recoveryKeys[(recoveryIndex + offset) % recoveryKeys.length] ?? 'd';
    await tapKey(page, recoveryKey);
    const recovered = await readNavigationSnapshot(page);
    if (Math.hypot(recovered.playerX - before.x, recovered.playerY - before.y) >= 2) {
      return {
        recoveryIndex: recoveryIndex + offset + 1,
        moved: true,
        movedKey: recoveryKey,
      };
    }
  }
  return { recoveryIndex: recoveryIndex + recoveryKeys.length, moved: false };
};

type ApproachState = {
  readonly recoveryIndex: number;
  readonly stuckAttempts: number;
  readonly detourKey?: string;
  readonly detourSteps: number;
};

const advanceApproachState = (options: {
  readonly state: ApproachState;
  readonly movement: MoveRecoveryResult;
  readonly directKey: string;
  readonly attemptedKey: string;
}): ApproachState => {
  const { state, movement, directKey, attemptedKey } = options;
  const nextState = { ...state, recoveryIndex: movement.recoveryIndex };
  if (movement.moved) {
    if (movement.movedKey === directKey) {
      return { ...nextState, stuckAttempts: 0, detourKey: undefined, detourSteps: 0 };
    }
    const detourSteps = state.detourSteps + 1;
    if (detourSteps >= 6) {
      return { ...nextState, stuckAttempts: 0, detourKey: undefined, detourSteps: 0 };
    }
    return { ...nextState, stuckAttempts: 0, detourKey: movement.movedKey, detourSteps };
  }

  const stuckAttempts = state.stuckAttempts + 1;
  if (stuckAttempts < 2) {
    return { ...nextState, stuckAttempts };
  }
  const recoveryKeys = recoveryKeysFor(attemptedKey);
  return {
    ...nextState,
    stuckAttempts: 0,
    detourKey: recoveryKeys[state.detourSteps % recoveryKeys.length],
  };
};

/**
 * Approaches the nearest authored production NPC with real WASD input and
 * opens its dialogue through the production interaction key.
 */
export const approachProductionNpc = async (page: Page): Promise<void> => {
  await waitForNavigationReady(page);
  await dismissMovementTutorial(page);
  // A fresh production map load removes persisted player coordinates and NPC
  // wander phase from earlier tests before the real WASD approach begins.
  await resetToVillageSpawn(page);
  await waitForNavigationReady(page);

  const initial = await readNavigationSnapshot(page);
  const target = selectNearestNpc(initial);
  const dialogueOverlay = page.locator(DIALOGUE_SELECTOR);
  let state: ApproachState = {
    recoveryIndex: 0,
    stuckAttempts: 0,
    detourSteps: 0,
  };

  for (let step = 0; step < MAX_APPROACH_STEPS; step += 1) {
    if (await isDialogueVisible(dialogueOverlay)) {
      return;
    }

    const snapshot = await readNavigationSnapshot(page);
    const targetPosition = snapshot.npcPositions[target.entityId];
    if (!targetPosition) {
      throw new Error(`Production NPC ${target.entityId} disappeared during approach`);
    }

    const interaction = await attemptInteraction({
      page,
      overlay: dialogueOverlay,
      snapshot,
      targetPosition,
    });
    if (interaction.opened) {
      return;
    }

    const directKey = directionToTarget(
      targetPosition.x - snapshot.playerX,
      targetPosition.y - snapshot.playerY,
    );
    const key = state.detourKey ?? directKey;
    const movement = await moveWithRecovery({
      page,
      key,
      before: { x: snapshot.playerX, y: snapshot.playerY },
      recoveryIndex: state.recoveryIndex,
    });
    state = advanceApproachState({
      state,
      movement,
      directKey,
      attemptedKey: key,
    });
  }

  throw new Error(`Production NPC ${target.entityId} was not reachable after 90 WASD steps`);
};
