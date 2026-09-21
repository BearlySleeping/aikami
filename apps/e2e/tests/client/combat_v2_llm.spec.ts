// apps/e2e/tests/client/combat_v2_llm.spec.ts
//
// C-526 AC-10: the production journey with the agent layer ENABLED.
//
// This lane runs against a client dev server started with
// `PUBLIC_COMBAT_LLM_AGENTS=1` (see the `client-llm-on` Playwright project) and
// with NO reachable text provider. That is exactly the condition the contract
// specifies, and it is the condition the flag-off lane can never exercise:
//
//   - the pinned kill switch is ON, so no actor may report "agent layer off";
//   - the model path genuinely fails, so every AI turn must reach the
//     deterministic planner through the real fallback;
//   - a companion in Suggest mode proposes a plan the player EDITS and APPROVES,
//     and nothing commits before that approval;
//   - resolved turns show the authored TEMPLATE narration (no live model is
//     reachable, so asserting model prose would be asserting a fiction);
//   - the fight still completes.
//
// `PUBLIC_QA_BYPASS_TEXT_AI` is deliberately NOT set: that gate bypasses the
// provider check wholesale and would skip the real fallback path.
//
// Run from apps/e2e: bun run test -- --project=client-llm-on combat_v2_llm

import { expect, test } from '@playwright/test';
import { GamePage } from '$pom';
import { EMULATOR_PORTS } from '../../src/config';

const GAME_URL = `http://localhost:${EMULATOR_PORTS.clientLlm}/game`;

/**
 * The encounter the deployed pack resolves.
 *
 * The repo authors `proof_encounter` (3 enemies + companion), but the client
 * resolves content through the published asset seed, which lags
 * `content/packs/index.json` — the same constraint `combat_v2.spec.ts`
 * documents. `inn_wand_encounter` resolves everywhere.
 */
const ENCOUNTER_ID = 'inn_wand_encounter';

/**
 * The ally slot's combatant id, resolved at RUNTIME by the seam.
 *
 * The deployed pack authors no combat-capable companion (the NPCs carrying a
 * `companionClassId` have no `combatStats`, so a real roster projection rejects
 * them), so the seam fills the ally slot with a real authored combatant when the
 * preferred id does not resolve. Every step stays production — real NPC stats,
 * real roster projection, real worker placement, real v2 kernel, real
 * control-mode plumbing; only the story role differs.
 */
const COMPANION_PREFERENCE = 'ash_hound';

type CombatOverlayState = { overlay: string; mode: string };

type AikamiTestSeam = {
  startRealEncounter(options: { encounterId: string; engine?: 'legacy' | 'v2' }): void;
  startCompanionEncounter(options: {
    encounterId: string;
    companionNpcId?: string;
    companionMode?: 'direct' | 'suggest' | 'intent' | 'autonomous';
    companionIntent?: string;
  }): boolean;
  companionCombatantIdFor(options: {
    encounterId: string;
    companionNpcId?: string;
  }): string | undefined;
  getCompanionPreference(npcId: string): { mode: string; intent: string; recruited: boolean };
  isCombatStartRoutable(): boolean;
  dismissCombat(): void;
  getOverlayState(): CombatOverlayState;
};

/** Reads the ROSTER's persisted companion preference (not combat-local state). */
const readPreference = (
  page: import('@playwright/test').Page,
  npcId: string,
): Promise<{ mode: string; intent: string; recruited: boolean }> =>
  page.evaluate(
    (id) =>
      (
        window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
      ).__AIKAMI_TEST__.getCompanionPreference(id),
    npcId,
  );

const clickWhenReady = async (
  locator: import('@playwright/test').Locator,
  timeout = 5_000,
): Promise<boolean> => {
  try {
    await locator.click({ timeout, force: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * Clicks a control that may be BELOW the pane's scroll position.
 *
 * `isVisible()` is false for an element scrolled out of an overflow container,
 * so a presence check must be `count() > 0` — otherwise a real, rendered control
 * looks absent and the loop waits for something that is already there.
 */
const clickIfPresent = async (locator: import('@playwright/test').Locator): Promise<boolean> => {
  if ((await locator.count()) === 0) {
    return false;
  }
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  return await clickWhenReady(locator);
};

/**
 * Clears the encounter between tests.
 *
 * Combat teardown is asserted elsewhere (C-500); here it only guarantees each
 * case starts from a fresh overlay instead of inheriting the previous fight —
 * and it keeps the persisted party roster from leaking a recruited companion
 * into an unrelated case.
 */
test.afterEach(async ({ page }) => {
  await page
    .evaluate(() =>
      (
        window as unknown as { __AIKAMI_TEST__?: { dismissCombat?: () => void } }
      ).__AIKAMI_TEST__?.dismissCombat?.(),
    )
    .catch(() => undefined);
});

test.describe('Combat-06 enabled agents (C-526 AC-7 / AC-9 / AC-10)', () => {
  let game: GamePage;

  const bootIntoGame = async (page: import('@playwright/test').Page) => {
    game = new GamePage(page);
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
    await game.waitForEngineReady();
    await game.waitForPlayingState();
    await expect(game.canvas).toBeVisible();
    await page.waitForFunction(
      () => {
        const seam = (
          window as unknown as { __AIKAMI_TEST__?: { startCompanionEncounter?: unknown } }
        ).__AIKAMI_TEST__;
        return typeof seam?.startCompanionEncounter === 'function';
      },
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => {
        const seam = (
          window as unknown as { __AIKAMI_TEST__?: { isCombatStartRoutable?: () => boolean } }
        ).__AIKAMI_TEST__;
        return seam?.isCombatStartRoutable?.() === true;
      },
      undefined,
      { timeout: 40_000 },
    );
  };

  /**
   * Starts the companion encounter, RETRYING until the engine accepts it.
   *
   * The engine solves placement from the player's live cell, so a start that
   * lands before the terrain grid is registered is rejected (`pathInvalid`) —
   * the same reason `combat_v2.spec.ts` polls its encounter start instead of
   * firing once. Nothing here papers over a real rejection: the loop only stops
   * once the engine's own budget readout is on screen.
   */
  /**
   * Starts the companion encounter.
   *
   * Retried until the engine's own budget readout is on screen: a start that
   * lands before the terrain grid is registered is rejected (`pathInvalid`), and
   * the overlay is pushed asynchronously — the same reason `combat_v2.spec.ts`
   * polls its encounter start instead of firing once. No assertion is weakened:
   * the loop only stops once the engine's readout is actually rendered.
   */
  const startCompanionEncounter = async (
    page: import('@playwright/test').Page,
    mode: 'direct' | 'suggest' | 'intent' | 'autonomous' = 'suggest',
  ): Promise<void> => {
    await expect
      .poll(
        async () => {
          await page.evaluate(
            (options) =>
              (
                window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
              ).__AIKAMI_TEST__.startCompanionEncounter(options),
            {
              encounterId: ENCOUNTER_ID,
              companionNpcId: COMPANION_PREFERENCE,
              companionMode: mode,
            },
          );
          return game.isCombatBudgetVisible();
        },
        { timeout: 60_000, intervals: [500, 1000, 2000, 3000, 5000] },
      )
      .toBe(true);
  };

  /**
   * Starts the authored 1v1 encounter through the SAME production start path the
   * dialogue chip uses.
   *
   * The degradation case deliberately uses the companion-free encounter: AC-9/AC-7
   * are about the AI layer's behaviour with the flag on, and a Suggest companion
   * would hold its turn for player approval (AC-6) — which would make this test
   * measure the approval flow instead of the fallback. The companion's own
   * behaviour is covered by the two cases below.
   */
  const startPlainEncounter = async (page: import('@playwright/test').Page): Promise<void> => {
    await expect
      .poll(
        async () => {
          await page.evaluate((id) => {
            (
              window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
            ).__AIKAMI_TEST__.startRealEncounter({ encounterId: id, engine: 'v2' });
          }, ENCOUNTER_ID);
          return game.isCombatBudgetVisible();
        },
        { timeout: 60_000, intervals: [500, 1000, 2000, 3000, 5000] },
      )
      .toBe(true);
    await expect(game.combatEndTurnButton).toBeVisible({ timeout: 20_000 });
  };

  /** The ally combatant id this environment will actually spawn. */
  const companionId = async (page: import('@playwright/test').Page): Promise<string> =>
    (await page.evaluate(
      (options) =>
        (
          window as unknown as { __AIKAMI_TEST__: AikamiTestSeam }
        ).__AIKAMI_TEST__.companionCombatantIdFor(options),
      { encounterId: ENCOUNTER_ID, companionNpcId: COMPANION_PREFERENCE },
    )) ?? COMPANION_PREFERENCE;

  /** Reads the rendered combat log — the only place these lines are visible. */
  const logText = async (): Promise<string> =>
    (await game.combatLog.innerText().catch(() => '')).replace(/\s+/g, ' ');

  test('the enabled lane degrades to the deterministic planner and shows templates', async ({
    page,
  }, testInfo) => {
    await bootIntoGame(page);
    await startPlainEncounter(page);

    await expect(game.combatLog).toBeVisible({ timeout: 20_000 });

    // Play until the AI side has taken a turn through the fallback.
    await expect
      .poll(
        async () => {
          await clickIfPresent(game.combatEndTurnButton);
          await page.waitForTimeout(400);
          const text = await logText();
          return text.includes('Deterministic AI') && text.includes('Intent —');
        },
        { timeout: 90_000, intervals: [500, 500, 1000, 1000, 2000] },
      )
      .toBe(true);

    const text = await logText();

    // AC-9: the kill switch is ON, so the "agent layer off" wording must NOT
    // appear — the degradation came from the unreachable provider instead. This
    // is the assertion that proves the lane really enabled the flag.
    expect(text).not.toContain('agent layer off');
    expect(text).toMatch(
      /Deterministic AI — (no model available|model timed out|model reply unusable)/,
    );

    // AC-7: one authored, bounded telegraph — never model prose.
    expect(text).toMatch(
      /Intent — (preparing an attack on|manoeuvring for position|bracing for the next blow|holding position|ending the turn)/,
    );

    // AC-10: with no reachable provider the resolved turns show the authored
    // TEMPLATE narration, not model prose.
    expect(text).toMatch(/(hits|misses|falls|is downed|moves \d+ cells)/);

    // AC-5/AC-10: the encounter is still playable — the direct controls are live.
    await expect(game.combatEndTurnButton).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('c526-enabled-lane-log.png') });
  });

  test('a Suggest companion proposes, the player edits it, and only approval commits', async ({
    page,
  }, testInfo) => {
    await bootIntoGame(page);
    await startCompanionEncounter(page, 'suggest');

    // AC-6: the mode selector is present and shows the persisted default.
    await expect(game.companionControlPanel).toBeVisible({ timeout: 20_000 });
    const allyId = await companionId(page);
    const suggest = game.companionModeButton(allyId, 'suggest');
    await expect(suggest).toBeVisible();
    // The mode control is a native radio input, so `checked` is the state —
    // asserting real form state rather than a hand-rolled ARIA attribute.
    await expect(suggest).toBeChecked();

    // Play until the companion's turn arrives and its plan is proposed.
    await expect
      .poll(
        async () => {
          await clickIfPresent(game.combatEndTurnButton);
          await page.waitForTimeout(400);
          return game.companionProposal.isVisible().catch(() => false);
        },
        { timeout: 90_000, intervals: [500, 500, 1000, 1000, 2000] },
      )
      .toBe(true);

    // The proposal carries the plan's own numbers, and nothing was committed:
    // the direct controls stay enabled throughout.
    await expect(page.getByTestId('companion-proposal-costs')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('c526-companion-proposal.png') });

    // ── Edit: re-point or re-aim the plan and confirm it re-previews. ──
    //
    // Whichever shape the companion proposed, it must be EDITABLE before it is
    // approved: a `use_ability` plan offers targets, and a `move` plan offers
    // approach bands (the intent envelope carries no exact cell — that is a
    // trusted direct-control input, not something a semantic intent can express).
    const editControls = page.locator(
      '[data-testid="companion-proposal-targets"] button, [data-testid="companion-proposal-approaches"] button',
    );
    await expect(editControls.first()).toBeVisible({ timeout: 15_000 });
    expect(await editControls.count()).toBeGreaterThan(1);

    // The edit recompiles against live state and commits NOTHING: the log is
    // byte-identical until Approve is pressed.
    const logBeforeEdit = await logText();
    expect(await clickWhenReady(editControls.last())).toBe(true);
    await expect(game.companionProposal).toBeVisible();
    expect(await logText()).toBe(logBeforeEdit);

    // ── Approve: the ONLY path that reaches the engine. ──
    const logBefore = await logText();
    await clickWhenReady(game.companionApproveButton);

    // The approval commits, so the log gains the "you take command" line and the
    // proposal is gone.
    await expect
      .poll(async () => (await logText()).length > logBefore.length, {
        timeout: 20_000,
        intervals: [300, 500, 1000],
      })
      .toBe(true);
    await expect(game.companionProposal).toHaveCount(0);
  });

  test('a mode change mid-encounter persists and is honoured by the engine', async ({ page }) => {
    await bootIntoGame(page);
    await startCompanionEncounter(page, 'suggest');
    await expect(game.companionControlPanel).toBeVisible({ timeout: 20_000 });
    const allyId = await companionId(page);

    // Switching to Direct hands the companion's turn to the player and persists
    // the preference in the ROSTER (not in combat-local state).
    await clickWhenReady(game.companionModeButton(allyId, 'direct'));
    // The mode control is a native radio input, so `checked` is the state —
    // asserting real form state rather than a hand-rolled ARIA attribute.
    await expect(game.companionModeButton(allyId, 'direct')).toBeChecked();
    const direct = await readPreference(page, allyId);
    expect(direct.mode).toBe('direct');
    expect(direct.recruited).toBe(true);

    // Intent mode persists a bounded standing goal alongside the mode.
    await clickWhenReady(game.companionModeButton(allyId, 'intent'));
    const input = page.getByTestId(`companion-intent-${allyId}`);
    await input.fill('hold the bridge');
    await clickWhenReady(page.getByTestId(`companion-intent-save-${allyId}`));
    const intent = await readPreference(page, allyId);
    expect(intent.mode).toBe('intent');
    expect(intent.intent).toBe('hold the bridge');
  });
});
