// apps/e2e/src/pom/npc_approach.ts
import type { Locator, Page } from '@playwright/test';

type EngineEntityPosition = { x: number; y: number };

type EngineDebugSnapshot = {
  playerX: number;
  playerY: number;
  playerEid: number;
  npcCount: number;
  entityPositions: Record<string, EngineEntityPosition>;
};

type NpcTarget = EngineEntityPosition & { entityId: string };

const DIALOGUE_SELECTOR = '[data-testid="dialogue-overlay"], .dialogue-overlay';
const INTERACTION_DISTANCE = 64;
const MAX_APPROACH_STEPS = 90;

const waitForNavigationReady = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const debug = (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | {
            playerX?: unknown;
            playerY?: unknown;
            playerEid?: unknown;
            npcCount?: unknown;
            entityPositions?: unknown;
          }
        | undefined;
      return (
        typeof debug?.playerX === 'number' &&
        Number.isFinite(debug.playerX) &&
        typeof debug.playerY === 'number' &&
        Number.isFinite(debug.playerY) &&
        typeof debug.playerEid === 'number' &&
        typeof debug.npcCount === 'number' &&
        debug.npcCount > 0 &&
        typeof debug.entityPositions === 'object' &&
        debug.entityPositions !== null
      );
    },
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForFunction(
    () => {
      const seam = (window as unknown as Record<string, unknown>).__AIKAMI_TEST__ as
        | { isMapReady?: unknown }
        | undefined;
      return typeof seam?.isMapReady === 'function' && seam.isMapReady() === true;
    },
    undefined,
    { timeout: 45_000 },
  );
  await page.waitForTimeout(2_500);
};

const dismissMovementTutorial = async (page: Page): Promise<void> => {
  const skipTutorial = page.getByRole('button', { name: 'Skip tutorial', exact: true });
  if (await skipTutorial.isVisible().catch(() => false)) {
    await skipTutorial.click();
    await page.waitForTimeout(300);
  }
};

const readNavigationSnapshot = async (page: Page): Promise<EngineDebugSnapshot> => {
  const snapshot = await page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__AIKAMI_DEBUG__ as
        | Partial<EngineDebugSnapshot>
        | undefined,
  );
  if (
    typeof snapshot?.playerX !== 'number' ||
    typeof snapshot.playerY !== 'number' ||
    typeof snapshot.playerEid !== 'number' ||
    typeof snapshot.npcCount !== 'number' ||
    typeof snapshot.entityPositions !== 'object' ||
    snapshot.entityPositions === null
  ) {
    throw new Error('Engine navigation diagnostics are incomplete');
  }
  return {
    playerX: snapshot.playerX,
    playerY: snapshot.playerY,
    playerEid: snapshot.playerEid,
    npcCount: snapshot.npcCount,
    entityPositions: snapshot.entityPositions,
  };
};

const selectNearestNpc = (snapshot: EngineDebugSnapshot): NpcTarget => {
  const candidates = Object.entries(snapshot.entityPositions)
    .filter(([entityId]) => Number(entityId) !== snapshot.playerEid)
    .sort(([left], [right]) => Number(left) - Number(right))
    .slice(0, snapshot.npcCount)
    .map(([entityId, position]) => ({ entityId, ...position }))
    .sort(
      (left, right) =>
        Math.hypot(left.x - snapshot.playerX, left.y - snapshot.playerY) -
        Math.hypot(right.x - snapshot.playerX, right.y - snapshot.playerY),
    );
  const target = candidates[0];
  if (!target) {
    throw new Error(`No production NPC position found among ${snapshot.npcCount} candidates`);
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
  key === 'w' || key === 's' ? ['d', 'a'] : ['w', 's'];

type RouteState = {
  readonly point?: EngineEntityPosition;
  readonly stage?: 'side' | 'flank';
};

type InteractionResult = {
  readonly opened: boolean;
  readonly route: RouteState;
};

type RouteProgress = {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly route?: RouteState;
};

const isDialogueVisible = async (overlay: Locator): Promise<boolean> =>
  overlay.isVisible().catch(() => false);

const createSideRoute = (
  snapshot: EngineDebugSnapshot,
  targetPosition: EngineEntityPosition,
): RouteState => {
  const sideOffset = targetPosition.x >= snapshot.playerX ? 152 : -152;
  return {
    point: { x: targetPosition.x + sideOffset, y: snapshot.playerY },
    stage: 'side',
  };
};

const attemptInteraction = async (options: {
  readonly page: Page;
  readonly overlay: Locator;
  readonly snapshot: EngineDebugSnapshot;
  readonly targetPosition: EngineEntityPosition;
  readonly route: RouteState;
}): Promise<InteractionResult> => {
  const { page, overlay, snapshot, targetPosition, route } = options;
  const deltaX = targetPosition.x - snapshot.playerX;
  const deltaY = targetPosition.y - snapshot.playerY;
  if (Math.hypot(deltaX, deltaY) > INTERACTION_DISTANCE) {
    return { opened: false, route };
  }

  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  if (await isDialogueVisible(overlay)) {
    return { opened: true, route };
  }
  return {
    opened: false,
    route: route.point === undefined ? createSideRoute(snapshot, targetPosition) : route,
  };
};

const routeProgress = (options: {
  readonly snapshot: EngineDebugSnapshot;
  readonly targetPosition: EngineEntityPosition;
  readonly route: RouteState;
}): RouteProgress => {
  const { snapshot, targetPosition, route } = options;
  const targetDeltaX = targetPosition.x - snapshot.playerX;
  const targetDeltaY = targetPosition.y - snapshot.playerY;
  if (route.point === undefined) {
    return { deltaX: targetDeltaX, deltaY: targetDeltaY };
  }

  const deltaX = route.point.x - snapshot.playerX;
  const deltaY = route.point.y - snapshot.playerY;
  if (Math.hypot(deltaX, deltaY) > 24) {
    return { deltaX, deltaY };
  }
  if (route.stage === 'side') {
    return {
      deltaX: 0,
      deltaY: 0,
      route: { point: { x: route.point.x, y: targetPosition.y }, stage: 'flank' },
    };
  }
  return { deltaX: 0, deltaY: 0, route: {} };
};

const moveWithRecovery = async (options: {
  readonly page: Page;
  readonly key: string;
  readonly before: EngineEntityPosition;
  readonly recoveryIndex: number;
}): Promise<number> => {
  const { page, key, before, recoveryIndex } = options;
  await tapKey(page, key);
  const afterMove = await readNavigationSnapshot(page);
  const moved = Math.hypot(afterMove.playerX - before.x, afterMove.playerY - before.y);
  if (moved >= 2) {
    return 0;
  }

  const recoveryKeys = recoveryKeysFor(key);
  const recoveryKey = recoveryKeys[recoveryIndex % recoveryKeys.length] ?? 'd';
  await tapKey(page, recoveryKey);
  return recoveryIndex + 1;
};

/**
 * Approaches the nearest authored production NPC with real WASD input and
 * opens its dialogue through the production interaction key.
 */
export const approachProductionNpc = async (page: Page): Promise<void> => {
  await waitForNavigationReady(page);
  await dismissMovementTutorial(page);

  const initial = await readNavigationSnapshot(page);
  const target = selectNearestNpc(initial);
  const dialogueOverlay = page.locator(DIALOGUE_SELECTOR);
  let recoveryIndex = 0;
  let route: RouteState = {};

  for (let step = 0; step < MAX_APPROACH_STEPS; step += 1) {
    if (await isDialogueVisible(dialogueOverlay)) {
      return;
    }

    const snapshot = await readNavigationSnapshot(page);
    const targetPosition = snapshot.entityPositions[target.entityId];
    if (!targetPosition) {
      throw new Error(`Production NPC ${target.entityId} disappeared during approach`);
    }

    const interaction = await attemptInteraction({
      page,
      overlay: dialogueOverlay,
      snapshot,
      targetPosition,
      route,
    });
    if (interaction.opened) {
      return;
    }
    route = interaction.route;

    const progress = routeProgress({ snapshot, targetPosition, route });
    if (progress.route !== undefined) {
      route = progress.route;
      continue;
    }

    const key = directionToTarget(progress.deltaX, progress.deltaY);
    recoveryIndex = await moveWithRecovery({
      page,
      key,
      before: { x: snapshot.playerX, y: snapshot.playerY },
      recoveryIndex,
    });
  }

  throw new Error(`Production NPC ${target.entityId} was not reachable after 90 WASD steps`);
};
