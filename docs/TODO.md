# Aikami TODO

> **One intake location for outstanding, contract-sized work.** This file is the
> structured seed backlog parsed by
> [`scripts/src/lib/ops/parse_backlog.ts`](../scripts/src/lib/ops/parse_backlog.ts)
> and read by the contract pipeline (`bun run contract --source todo C-533`).
>
> Field syntax and status vocabulary: [`reference/backlog-format.md`](reference/backlog-format.md).
> File a small bug or idea at
> [GitHub issues](https://github.com/BearlySleeping/aikami/issues) instead, and
> keep unscoped ideas in [Unscoped ideas](#unscoped-ideas) below.
>
> **IDs below (C-533 … C-542) were allocated 2026-09-16**, after checking every
> used and reserved ID through C-532. Never reuse a historical ID. When a seed
> gets a contract file, the contract becomes the authority and the seed should be
> removed from the `##` sections here.
>
> Premises were verified against `main` at allocation time; re-verify against the
> current checkout before drafting, as the pipeline requires.

## Client and dialogue polish

### C-533 — Show NPC mood on the LPC sprite

- **Status:** not_started
- **Priority:** P1
- **Target:** dialogue overlay view model + expression service + LPC renderer
- **Outcome:** When an NPC response carries a mood (happy/sad/angry/…), a small
  emoji indicator appears over that NPC's sprite briefly, then fades.
- **Scope:** Reuse `_detectExpression` in
  `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`
  and the expression service's existing mood fallback; map mood → emoji; render
  through the existing engine/UI seam (no per-frame work in the view model).
- **Dependencies:** none
- **Acceptance gate:** An angry NPC response shows 😠 (or mapped equivalent)
  over the sprite and it fades without leaking a timer; a neutral response shows
  nothing; covered by a unit test for the mood→emoji mapping.
- **References:** verified 2026-09-16 — `_detectExpression` exists, no sprite
  indicator is wired.

### C-535 — Ship real default persona avatars

- **Status:** not_started
- **Priority:** P1
- **Target:** starter constants + persona creation + storage/emulator seed
- **Outcome:** Lyra, Zeph, and Thaldrin show real avatars in persona creation and
  on starter cards instead of `starter_*` placeholder keys.
- **Scope:** Convert source images to optimized webp, publish them to the asset
  origin/bucket through the existing storage service, and bind them as
  `illustrationAsset` for `STARTER_HEROES` in
  `packages/shared/constants/src/lib/characters.ts` and the persona creation
  service (`avatarUrl`).
- **Dependencies:** asset publication authorization (R2 publish is a separate
  approval)
- **Acceptance gate:** Opening/creating a starter persona shows the correct webp
  for each of the three heroes, with no placeholder; an offline/registry-failure
  path still renders a safe fallback rather than a broken image.
- **References:** verified 2026-09-16 — `illustrationAsset: 'starter_thaldrin' |
  'starter_lyra' | 'starter_zeph'` are still unresolved keys.

### C-536 — Keep NPC dialogue memory across session exit and re-enter

- **Status:** not_started
- **Priority:** P1
- **Target:** NPC dialogue service memory lifecycle
- **Outcome:** Talking to an NPC, leaving dialogue, then talking to the same NPC
  again resumes the prior conversation instead of starting blank.
- **Scope:** Keep the per-NPC dialogue history/memory alive across the
  end-session → start-session boundary in
  `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts`
  (bounded window). Persist across app restart only if it falls out of the
  existing campaign/save path without new storage.
- **Dependencies:** none
- **Acceptance gate:** Scripted test: converse → exit → re-enter with the same
  NPC and observe the prior exchange still in context; memory remains bounded.
- **References:** premise unverified beyond the file's bounded window; confirm
  the current session lifecycle before drafting.

## Engine and toolchain

### C-534 — Stop per-frame `zoning.position` logging

- **Status:** not_started
- **Priority:** P2
- **Target:** `packages/frontend/engine/src/systems/zoning_system.ts`
- **Outcome:** The console no longer floods with
  `[spam:zoning.position] (suppressed N repeats in 10s)`.
- **Scope:** Remove the per-frame `logger.spam('zoning.position', …)` call or
  raise its interval to something negligible.
- **Dependencies:** none
- **Acceptance gate:** Running the game produces no recurring `zoning.position`
  lines; a test or manual check confirms the zone system still logs genuine
  transitions where useful.
- **References:** verified 2026-09-16 — `logger.spam('zoning.position', …)`
  remains at `zoning_system.ts:60`.

### C-539 — Restore `bun run test:unit` for client and hub

- **Status:** not_started
- **Priority:** P1
- **Target:** client + hub test harness and tsconfig path mapping
- **Outcome:** The documented per-app unit suite passes or has a small,
  documented set of intentional skips — not a large pre-existing failure count.
- **Scope:** Investigate the two failure classes previously recorded: dynamic
  `import('$lib/...ts')` paths not resolving under `tsconfig.test.json`, and the
  hub health-check `setHealthDbEnv is not a function`. Reconcile
  `client/tsconfig.test.json` with the real alias configuration.
- **Dependencies:** C-541 (a subpath-imports move gives tests and Vite one
  resolution source)
- **Acceptance gate:** `bun moon run client:test` and `bun moon run hub:test`
  run through Moon (not a bare `bun test`) with a recorded, explained baseline;
  no silent skips.
- **References:** premise unverified since the SvelteKit 3 upgrade; re-confirm
  the current failure counts and note they may already be fixed.

### C-541 — Migrate client and hub off deprecated `kit.alias`

- **Status:** not_started
- **Priority:** P1
- **Target:** `apps/frontend/client` + `apps/frontend/hub` configs and imports
- **Outcome:** Both apps build, test, and preview with no SvelteKit
  `config.alias` deprecation warning, resolving imports through Node subpath
  imports (`#foo`).
- **Scope:** Decide the `@aikami/*` mapping strategy, add `imports` maps, migrate
  `$`-style and `@aikami/*` specifiers, remove dead aliases and the `alias`
  blocks, and update the convention docs.
- **Dependencies:** none
- **Acceptance gate:** `moon check` + app tests pass; both apps build and
  preview; the deprecation warning is gone; full recipe in
  [`reference/kit-alias-migration.md`](reference/kit-alias-migration.md).
- **References:** verified 2026-09-16 — `kit.alias` is still used in both
  `vite.config.ts` files and SvelteKit is `3.0.0-next.27`.

## Release and agent-platform platform work

### C-537 — Re-enable Tauri updater artifact signing

- **Status:** not_started
- **Priority:** P2
- **Target:** `apps/frontend/client/src-tauri/tauri.conf.json`
- **Outcome:** Desktop builds emit signed updater artifacts.
- **Scope:** Flip `bundle.createUpdaterArtifacts` to `true`; CI already holds the
  signing secrets.
- **Dependencies:** a release-cadence/readiness decision (must not ship updater
  artifacts before there are real users to update)
- **Acceptance gate:** A packaged release produces signed updater artifacts and
  an installed build updates cleanly from a prior version.
- **References:** verified 2026-09-16 — `createUpdaterArtifacts: false`.

### C-538 — Investigate herdr Windows output capture

- **Status:** not_started
- **Priority:** P2
- **Target:** `.pi/` herdr integration + Tauri process/console behavior
- **Outcome:** Either a documented "Windows-only, tracked upstream" limitation or
  a located bug — not an open-ended investigation.
- **Scope:** `bun herdr:start tauri` launches the Windows binary but its
  stdout/webview console never reaches the herdr pane. Confirm on Linux/NixOS
  whether ELF/Mach-O capture works; if so the cause is the Windows GUI subsystem
  and ConPTY.
- **Dependencies:** a Windows and a Linux/NixOS verification environment
- **Acceptance gate:** Written conclusion with the reproduction on each platform;
  if unresolved, a doc note and an upstream reference.
- **References:** current TODO premise; herdr is tier-2 optional tooling.

### C-542 — Tauri OPFS `sqlite3_vfs` persistence

- **Status:** not_started
- **Priority:** P2
- **Target:** client storage + Tauri webview configuration
- **Outcome:** The desktop/native storage path has a durable, documented local
  persistence story, or an explicit decision not to pursue OPFS.
- **Scope:** Evaluate OPFS `sqlite3_vfs` for the Tauri path, including the
  cross-origin-isolation constraints that removed the SharedArrayBuffer path
  (see [`guides/cross-origin-isolation.md`](guides/cross-origin-isolation.md)).
  Do **not** re-enable COOP/COEP as a shortcut.
- **Dependencies:** none
- **Acceptance gate:** A recorded decision with measured evidence; if adopted, an
  offline restart test proving persistence; if not, the limitation is documented
  and the `guides/TAURI_BOOT_HANDOFF.md` pointer is resolved.
- **References:** `guides/TAURI_BOOT_HANDOFF.md` points here for the OPFS task.

### C-540 — Resolve the `check_bundle.ts` facade-getter suppression

- **Status:** not_started
- **Priority:** P2
- **Target:** `apps/frontend/client/scripts/check_bundle.ts` + engine barrel
- **Outcome:** The 7-name `KNOWN_UNREACHABLE_FACADE_GETTERS` suppression is gone
  because the dangling facade getters are gone (or the upstream defect is
  filed/fixed).
- **Scope:** Choose between curating the engine barrel's `export *` into explicit
  named exports, or finding/fixing/reporting the rolldown star-re-export facade
  defect. Add barrel-completeness coverage before curating.
- **Dependencies:** none
- **Acceptance gate:** Suppression removed and the bundle check passes; a test
  guards barrel completeness; revisit immediately if a different name is flagged.
- **References:** verified 2026-09-16 — the suppression list remains.

## Unscoped ideas

Draft notes and ideas that are not yet contract-sized. They are **not** parsed by
the backlog parser; promote one into a `### C-xxx` seed above (with the next free
ID) when it is ready.

- **`.pi` extension execution model:** have every `.pi/extensions` entry execute
  through `bun run` instead of importing from `scripts/` directly, so extensions
  can use Bun utilities and path aliases and `$logger` inside scripts. A common
  wrapper would live in `.pi/extensions/lib/`. Update the existing test that
  asserts extensions do not import Bun utilities, and add tests for the wrapper.
- **Windows console popups:** use `Bun.spawn({ cmd, windowsHide: true })` for
  `.pi/extensions` after they move to the `bun run` model, to stop console
  windows appearing during autofix.

## Tracked elsewhere (do not duplicate here)

These are already owned by a contract file, a backlog seed document, or an
issue. Link them; do not restate them.

- **Distribution and onboarding rollout** — seed questions and ordering live in
  [`reference/distribution-and-onboarding-2026-08-19.md`](reference/distribution-and-onboarding-2026-08-19.md).
  Prioritise the `publish-local-stack.yml` release trigger.
- **C-452 onward backlog seeds** —
  [`contracts/BACKLOG_C452_PLUS.md`](contracts/BACKLOG_C452_PLUS.md). ⚠️ That
  document's IDs after C-452 were provisional and were later reallocated to
  different contracts; treat its headings as historical titles, not current IDs.
- **C-485 onward backlog seeds** —
  [`contracts/BACKLOG_C485_PLUS.md`](contracts/BACKLOG_C485_PLUS.md).
- **Active combat work** — [`contracts/INDEX.md`](contracts/INDEX.md) and
  [`architecture/combat_2.md`](architecture/combat_2.md).
- **Small bugs and ideas not yet sized** — the
  [`feature` label](https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue%20state%3Aopen%20label%3Afeature).
