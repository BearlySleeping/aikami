# Playable UX + Production Acceptance

Branch: `task/sa-polish-playable-ux-98a3` · base: `main` @ `67ff50f5d23766176614e2766bc4d4b4c13c1971`

Scope is deliberately narrow: the game HUD/overlay **views** under
`apps/frontend/client/src/lib/views/game/ui/**`, the one theme stylesheet that
lays those views out, and the E2E POM/specs that drive the production `/game`
route. No engine changes, no shared type/schema/barrel changes, no new stores.

---

## 1. Stale selector contracts (the failing save/offline case)

**Source-confirmed.** Production renders
`overlays/pause_menu/pause_menu_view.svelte` (`game_ui_view.svelte:195`), whose
buttons are **Resume / Save now / Settings / Customize HUD / End Session /
Quit to Main Menu** plus a `role="status"` save line
(`Not saved yet` → `Game Saved! · Last saved <timestamp>`).

`GamePage.openPauseMenu()` asserted `getByText('Resume Game')`, so it failed
*before* the save step ever ran. Same stale label lived in
`inventory_page.ts`, `hud_customization_page.ts`, `game_page.spec.ts` (×3) and
`release_gate.spec.ts`.

### Changes

- **New** `apps/e2e/src/pom/pause_menu.ts` — one source of truth for the
  Pause Menu contract: `pauseMenuDialog`, `pauseMenuResumeButton`,
  `pauseMenuSaveButton`, `pauseMenuSaveStatus`, `pauseMenuCustomizeHudButton`,
  `isFocusInsidePauseMenu`. Every locator is scoped to
  `getByRole('dialog', { name: 'Pause Menu' })`, because the HUD renders its own
  save-adjacent copy and an unscoped text match binds to whichever node is first
  in the DOM. Re-exported from the POM barrel.
- `game_page.ts` — `openPauseMenu` waits for the dialog **and** its primary
  action; `closePauseMenu` asserts the dialog is hidden (no fixed sleeps);
  `saveGame` still waits for the **real** completion signal and additionally
  requires the completion to carry a **timestamp** (`Last saved …`), not just the
  outcome word. No test seam was introduced.
- `inventory_page.ts`, `hud_customization_page.ts`, `game_page.spec.ts`,
  `release_gate.spec.ts` — stale `Resume Game` selectors replaced with the
  dialog-scoped locator.
- **Deleted** `overlays/pause_menu_overlay.svelte`. It was dead (no importer
  anywhere in the repo), imported `$services` directly — which the C-314 split
  explicitly forbids — and was the reason the stale `Resume Game` / `Save Game`
  labels still existed in the tree.
- `release_gate.spec.ts` — the four hardcoded `http://localhost:5274…` URLs now
  come from `EMULATOR_PORTS.client` (`src/config.ts`), so a linked-worktree run
  targets its own checkout instead of whatever owns 5274. The keyboard journey
  additionally asserts the pause open lands focus on Resume and that Shift+Tab
  stays contained.

Product labels were **not** changed to satisfy a test.

## 2. Quest objective progressbar has no accessible name

`hud/quest_overlay.svelte` rendered `role="progressbar"` with only
valuenow/min/max — announced as "progress bar, 50%", never naming the step.

- `QuestOverlayViewModel.currentObjectiveProgressLabel` derives the name from the
  same objective the bar visualises (`Objective progress: <label>, <n> of <max>`;
  the step clause is omitted for single-step objectives; `undefined` when no
  objective is in flight). The View binds it as `aria-label`.
- Covered by `quest_overlay_view_model.test.ts` (Bun) and by a **compiled
  browser** test that mounts the real View and queries
  `getByRole('progressbar', { name: … })`.

## 3. Pause Menu keyboard/focus

`pause_menu_view.svelte` had an inline Tab trap that could never be proven,
never moved focus on open, and dropped focus to `<body>` when the content
branch swapped (menu → quit confirmation).

- **New** `pause_menu/pause_menu_focus.ts`: pure helpers (`nextFocusIndex`,
  `cycleFocus`, `focusInitial`, `captureRestoreTarget`, `restoreFocus`) plus the
  `pauseDialogFocus` Svelte action — initial focus, closed Tab/Shift+Tab cycle,
  focus re-anchoring on content change, and focus restoration on destroy.
  Dismissal semantics stay in the View/ViewModel.
- The View uses `use:pauseDialogFocus={{ focusKey: viewModel.confirmingQuit }}`
  and marks Resume with `data-pause-menu-initial-focus`.
- Restoration prefers the element that owned focus when the menu opened and
  falls back to the game surface (`#game-canvas-container`), which is not a
  native tab stop — a transient `tabindex="-1"` is used and removed immediately,
  so no tab order changes.
- Proof: `pause_menu_focus.test.ts` (arithmetic) and
  `src/browser_tests/pause_menu_focus.browser.test.ts`, which mounts the real
  compiled View in Chromium with a feature-owned ViewModel and asserts initial
  focus, Tab/Shift+Tab wrapping in both directions, Escape→resumeGame, and focus
  restoration in both the owned-focus and fallback cases.

## 4. Target interaction prompt clipping (reproduced, then fixed)

Reproduced in Chromium at **800×600 with 200% text** (root `font-size: 32px`),
mounting the real `interaction_prompt.svelte` inside the shipped
`aikami_game_ui.css` with a production-shaped label
(`E — Speak with Archmagus Lysanthius Moonveil, Warden of the Eastern Reaches`).

Measured **before** the fix (`getBoundingClientRect`, viewport 800×600):

| target (x, y) | rect | defect |
|---|---|---|
| (400, 580) | 200…600 × **452…612** | 12 px below the viewport bottom |
| (4, 300) | 32…**828** | 28 px past the right edge |
| (796, 590) | 570…768 × 462…**758** | 158 px below the bottom, 296 px tall |

Two evidenced causes, both in `packages/frontend/theme/src/lib/aikami_game_ui.css`:

1. `.hud-prompt` was `content-box`, so `max-inline-size: calc(100vw - 2rem)`
   bounded the *content* (736 px) while the border box reached 796 px — wider
   than the `translateX` clamp assumed, so both edges could not fit.
2. The vertical clamp (`100dvh - 1rem`) never considered the prompt's own
   height, so any prompt taller than the gap under its target fell off-screen.

Fix: `box-sizing: border-box` on `.hud-prompt`, plus a `translateY` correction
that uses the self-referential `100%` trick (same idea as the existing
horizontal clamp) and is floored at the top margin.

Measured **after** the fix — all five probed cases fully on screen, and the
normal placement (target mid-screen, short label, 100% text) is byte-identical to
before: only oversized prompts move.

Semantic tokens, night contrast, reduced-motion policy and HUD layout policy are
untouched; no re-theme.

## 5. Production appearance/identity parity through save + offline reload

`npc_identity_persistence.spec.ts` previously covered only elder startup and a
plain reload — reload-only parity can pass on a session that never persisted.
Added two production-route cases:

- identity parity across **a real Pause Menu save** and a **network-isolated
  reload** (`localhost`/`127.0.0.1` allowed, everything else aborted with
  `internetdisconnected` — same isolation contract as `emberwatch_journey.spec.ts`);
- the persisted timestamp is still reported by the dialog after a reload, i.e.
  the save outcome survives the menu close.

`equipment_visual.spec.ts` (dev sandbox) was deliberately left alone: it tests
equipment stat maths, not identity restoration, and its route is not the
production path this acceptance is about.

## 6. New bounded acceptance spec

`apps/e2e/tests/client/playable_ux_acceptance.spec.ts` — production `/game`
route only: keyboard-only open → primary focus → Tab/Shift+Tab containment →
close restores focus to the game surface; manual save reports outcome **and**
timestamp (including the honest `Not saved yet` state before it); HUD
customization opens from the Pause Menu and returns to it.

## 7. Movement acceptance (production route)

`apps/e2e/tests/game/click_to_move.spec.ts` asserted click-to-move against
`/dev/sandbox/map` and treated a published `__AIKAMI_DEBUG__.playerX/playerY` as
"map loaded". That state is reached **with a blank world** when the sandbox's
`debug_tiles.png` 404s, so the assertion could pass against nothing — and it
hardcoded an 800x600 / scale-4 / centre mapping the sandbox does not guarantee.

- Both suites now gate on a loaded world. The sandbox `beforeEach` asserts
  `__AIKAMI_ENGINE_STATE__.entityCount > 0` and fails with the real reason
  ("debug atlas/tiles did not load") instead of clicking at a blank map.
- New production suite on `/game`:
  - **the world is loaded** — `entityCount > 0`, `npcCount > 0`, and
    `__AIKAMI_DEBUG__.npcAppearance.village_elder` resolves. That last one only
    populates once real entity textures pass the shared named-appearance
    normalization, so it is an identity-level proof of a populated world rather
    than a pixel-count guess.
  - **a click to the right moves the player and the camera follows** — the click
    target comes from the live canvas box (right of centre, where the camera
    already places the player), so no tile coordinates are invented. It asserts
    a real displacement (>= 8 world px), that the player **comes to rest** away
    from spawn (no drift-back), and that `cameraX` advanced — i.e. the
    world-to-screen transform the player sees tracked the movement.

Timeout failures throw with the last observed snapshot attached. No fixture was
invented, no timeout widened, no skip added.

## 8. Tutorial dismissal selector scoping (POM defect from the native-map probe)

`EmberwatchHousePage.dismissTutorial()` used
`getByRole('button', { name: /skip/i }).first()`. That pattern is **not scoped to
the tutorial**:

- the onboarding hint (the "tutorial") renders `aria-label="Skip tutorial"` in
  `hud/onboarding_hint.svelte`;
- the music player in the **same overlay layer** renders
  `aria-label="Skip to similar song"` (`hud/music_player_overlay.svelte:97`),
  and it is normally **disabled** because no track is playing.

Once the first-run hint is gone, the loose match binds to the disabled music
button, the click waits on a permanently disabled control, and the run dies on a
30 s timeout unrelated to the tutorial (captured in
`.evidence/engine-polish/baseline/map-probe.log`).

Fix:

- `onboarding_hint.svelte` gains `data-testid="onboarding-hint"` (additive DOM
  hook, in scope).
- `dismissTutorial()` now resolves
  `getByTestId('onboarding-hint').getByRole('button', { name: 'Skip tutorial', exact: true })`.
  An absent hint makes the scoped locator resolve immediately, so "later run"
  stays a cheap no-op instead of a probe that waits.
- New regression `apps/e2e/tests/game/emberwatch_house_pom.spec.ts` drives the
  POM against HUD markup that contains **both** controls: with the hint absent
  it must return `false` and leave the music control at zero clicks; with the
  hint present it must click the tutorial skip exactly once and still never
  touch the music control. The regression asserts on click counters, so it
  fails if the selector ever widens again — no timeout is involved.

Product labels were not changed to make the selector work.

---

## Execution report

Environment: Herdr worktree `task-sa-polish-playable-ux-98a3`, bootstrapped,
Bun/Moon.

| Command | Result |
|---|---|
| `bun moon run client:test-browser --force` | **28 files / 65 tests passed** (baseline before this change: 26 / 54) |
| `bun moon run client:test-unit` | **4712 pass / 0 fail** (7 skip, 2 todo — all pre-existing) |
| `bun moon run e2e:typecheck --force` | green |
| `validate` (fix + typecheck + 10 structural guards) | green; `client:typecheck` svelte-check 0 errors |
| `bun moon run e2e:test-game --force -- tests/game/emberwatch_house_pom.spec.ts` | **not run here** — DOM-only, but the lane's preflight would still start/purge services while another agent's capture is in flight. Ready for your run. |
| cognitive-complexity guard | my release-gate edit first **grew** the worst function 36->39; extracting `assertPauseMenuKeyboardJourney` dropped it to **33**, locked via the sanctioned reduction-only `--update-baseline` |
| `e2e:test-client` / `e2e:test-game` on the production route | **not run in this worktree** — see "Limitations" |

### Captain baseline packet caveat (`.evidence/engine-polish/baseline`)

The 15/15 WebGL/entity-guarded screenshots and the identity probe (24 visible
entity textures, no `pageerror`) were captured against **Emberwatch 5.0.0,
release `2026-09-27T13:34:17.944Z`, digest `a595c51a...`**, resolved from relative
`/game-data` atlases plus `assets.bearlysleeping.com`. That packet is **not**
proof that the latest candidate maps loaded: it is a floor, not a ceiling.

Root guards initially tripped on a stale ignored Paraglide generated directory
left behind by removed #427; it was quarantined outside `src` with no tracked
diff, and this worktree never contained it.

### Not duplicated

`exploration_hud` + `pause_settings` were fresh-green on this baseline (9/9 with
setup, including save timestamp and 200% pause scrolling). Those shipped fixes
were left alone — this diff adds no overlapping styling or behaviour.

### Limitations / honest gaps

- The Playwright production-route specs were **not executed** in this worktree.
  While this work was finishing, ports `5274`/`5276` were live with another
  agent's capture in flight, so no E2E stack was launched here rather than
  contend for shared listeners. Moon's E2E/visual tasks also cache despite
  absent `test-results` output — use `--force` for fresh evidence, copy
  artifacts to `.evidence` immediately (a later lane overwrites same-checkout
  output), and serialize visual vs E2E per checkout. Fresh commands:

  ```
  bun moon run e2e:test-client --force -- tests/client/emberwatch_journey.spec.ts \
                                        tests/client/playable_ux_acceptance.spec.ts \
                                        tests/client/npc_identity_persistence.spec.ts \
                                        tests/client/game_page.spec.ts \
                                        tests/client/release_gate.spec.ts
  bun moon run e2e:test-game   --force -- tests/game/click_to_move.spec.ts \
                                         tests/game/emberwatch_house_pom.spec.ts
  ```

  The POM/spec changes are therefore verified by typecheck + lint only; the
  compiled-DOM behaviour they assert is independently covered by the Chromium
  browser-lane tests.
- `modern-web-guidance` search tooling was not available in this environment, so
  the CSS change was driven purely by measured Chromium evidence rather than by
  a guideline lookup.
- `#game-canvas-container` has no `tabindex`, and `views/game/canvas/**` is
  outside this task's scope. Focus restoration therefore sets a **transient**
  `tabindex="-1"` rather than relying on the surface being natively focusable.
  Making that surface permanently focusable is a one-line follow-up for whoever
  owns the canvas view.
- If the production `/game` route cannot obtain a WebGL context in the runner's
  browser, these specs **fail**. They were not made to skip.
- The sandbox click-to-move `beforeEach` now requires `entityCount > 0`. Where
  `/dev/sandbox/map` still 404s its debug atlas, AC-4/AC-7 fail at setup with an
  explicit "debug atlas/tiles did not load" message instead of clicking at a
  blank world. That is intended: the sandbox 404 is a sandbox fixture problem,
  **not** evidence that production movement is broken.
- The browser-lane `$services` stub was renamed
  `browser_tests/browser_services_stub.ts` (was `hotbar_services_stub.ts`) so
  its name matches its actual role, with a stated rule: add a binding only for
  the specific view a browser test mounts, keep it inert, and never let it grow
  into a service inventory.

## Captain integration report — 2026-10-03

The isolated-slice limitations above describe the earlier agent run; the
consolidated checkout now has fresh production evidence:

| Check | Result |
|---|---|
| Emberwatch journey, playable UX, NPC identity, HUD, pause/settings | **19/19 passed**, four Playwright workers |
| Interactive click-to-move | **4/4 passed**; camera/canvas-derived targets |
| Saved timestamp after ready reload | **passed**; real SQL retains metadata |
| Five-map and NPC network-isolated reload | **passed**; remote origins blocked after the initial download |

Root causes fixed during integration:

- The real published catalog uses an empty seed origin; the validated snapshot
  now accepts that legitimate shape and awaits the existing database flush.
- Core-prefetch registry batches flush once at completion. The composition root
  waits for local registry rehydration before resolving cached content-pack URLs.
- Durable campaign publication survives snapshot hydration: a slot's older
  embedded campaign cannot overwrite the authoritative stored campaign.
- Manual save reports success only after both slot and resume metadata are
  durable; a metadata failure is not swallowed as "Game Saved".
- The canvas is a permanent named, programmatically focusable region. Focus
  restoration and Escape ownership have compiled-browser regression coverage.
- WalkSandbox's registered debug tiles were not missing: its nested-path
  resolver injection was absent. The preview now passes normalized tag and
  release bindings; movement tests read live diagnostics rather than a
  frozen-visual-only global. A deliberately offset click conversion fails the
  regression, then passes when restored.

Evidence remains gitignored under `.evidence/engine-polish/`; the latest logs
are `resume-final-client.log`, `resume-movement.log` and the database diagnostic
logs. Baseline manifest identity matched current source authoring; map/atlas
byte identity was not observed. Downscaled 672×378 PNGs are not viewport-scale
measurements. Technical captures are not a substitute for human art acceptance.

Final consolidated validation, fresh visual capture and CodeRabbit review are
recorded in the PR; none of the historical unit-only claims above establishes
that those separate gates passed.
