# Aikami TODO

Look at https://github.com/BearlySleeping/aikami/issues?q=is%3Aissue%20state%3Aopen%20label%3Afeature
for TODO items

This file is for draft/messy notes and ideas, grouped into contract-sized units of work.

## Prompt backlog (from tmp/TODO.md)

Scratch backlog converted to executable prompts for a fresh pi session. Five
contract-sized items are already drafted in `docs/contracts/` (do NOT re-derive
them here): `C-499` — Dialogue intent-envelope extraction resilience,
`C-500` — Combat overlay rendering + engine stall, `C-501` — Dialogue slash
commands (`/generate`, `/tree`, `/action`), `C-502` — Minimap HUD, `C-503` —
Quest marker HUD.

Each prompt below is a **direct prompt** — small, self-contained fix. Execute
each in isolation; one prompt = one commit-worth of change.

### Prompt 1 — Dialogue: allow typing while the NPC is streaming

**Problem**: the input box is disabled while the NPC response streams, so the
player cannot type until the suggested-action chips appear.

**Files**:
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` — `disabled={viewModel.isStreaming || viewModel.isResolvingSkillCheck}` on the textarea (~L440)
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` — `sendMessage` (~L1128) early-returns on `isStreaming`

**Task**: remove `isStreaming` from the textarea `disabled` binding so the
player can type during streaming. When the player presses Enter mid-stream,
queue the message and send it once the current turn completes (do not silently
drop it). Keep `isResolvingSkillCheck` gating.

**Check**: during an NPC reply, type a message and press Enter — it sends after
the NPC finishes; the player can type before the chips appear.

### Prompt 2 — Player sprite is occluded by the HP bar

**Problem**: "Player Kaelen Thistlewalker is behind the ui healthbar" — the
player sprite renders underneath the HP bar HUD when walking to the top-left.

**Files**:
- `apps/frontend/client/src/lib/views/game/ui/hud/hp_bar.svelte` — `absolute top-3 left-3 z-50`
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte`

**Task**: make the HP bar not occlude the player sprite. Reposition it, shrink
its footprint, or make it non-blocking (pointer-events already pass through HUD
elements; the issue is visual occlusion).

**Check**: walk the player into the top-left region of the viewport — the HP bar
does not cover the player sprite.

### Prompt 3 — Ember Watch quest must start with "Talk to the Elder"

**Problem**: the Ember Watch quest does not begin with the "talk to the Elder"
objective.

**Files**:
- `content/packs/emberwatch/manifest.json` — quest + objective definitions
- `content/packs/emberwatch/maps/village.json` — Elder NPC placement

**Task**: locate the Ember Watch quest in the manifest and ensure its first
active objective targets the Elder NPC (`npcId` completion), with no earlier
objective preceding it.

**Check**: start a new Ember Watch campaign — the quest tracker shows
"Talk to the Elder" as the current objective.

### Prompt 4 — TTS in dialogue: toggle, latency, and `stop()` error

**Problem**: TTS does not play in dialogue unless the explicit "speak" button is
clicked; the toggle does nothing; first speech is ~10s late; console shows
`stop() called before synthesis completed`.

**Files**:
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` — `streamingTtsEnabled`, `toggleStreamingTts` (~L1469), init (~L803–822), `speakMessage`
- `apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts` — `speak` (~L358) calls `stop` (~L405); `stop` (~L433) rejects the pending request with `'stop() called before synthesis completed'` (~L445)

**Task**:
1. Wire `toggleStreamingTts` so enabling it auto-speaks each NPC message as it completes (not just on explicit speak-click).
2. Initialize TTS eagerly when the dialogue overlay opens to remove the ~10s first-speak latency.
3. Fix the spurious `stop() called before synthesis completed` error — a superseding `speak()` should cancel the prior request silently, not reject it as an error.

**Check**: open a dialogue, toggle TTS on — NPC replies speak automatically,
without a 10s delay and without the `stop()` error in the console.

### Prompt 5 — `/setup` auto-toggle voice & art; disable without connection

**Problem**: after `/setup` establishes a connection, voice and art should be
auto-enabled (and re-enabled on load); they must not be toggleable when there is
no connection.

**Files**:
- `apps/frontend/client/src/lib/views/setup/setup_view_model.svelte.ts`
- `apps/frontend/client/src/lib/views/setup/setup_view.svelte`
- `apps/frontend/client/src/lib/views/setup_subflow/*`

**Task**: on successful connection setup, enable voice and art. Persist the
state and re-apply on load. When no connection exists, disable the voice/art
toggles and prevent enabling them.

**Check**: run `/setup` to completion — voice + art toggles are on; reload the
app — still on; remove the connection — toggles disabled and cannot be flipped on.

### Prompt 6 — LPC renders multiple bodies/arms when looking up or down

**Problem**: the LPC character draws multiple bodies and arms when facing up or
down.

**Files**:
- `packages/frontend/engine/src/__tests__/lpc_appearance_resolver.test.ts`
- LPC appearance resolver + direction/frame mapping in `packages/frontend/engine`
- `apps/frontend/client/src/lib/components/game/lpc_animation_debug_controller.ts`

**Task**: investigate and fix the up/down direction rendering. Likely a
direction-frame index mismatch where up/down select the wrong body/arm layers or
draw every variant instead of one.

**Check**: rotate the LPC character through up/down/left/right — exactly one body
and one pair of arms render in each direction.

### Prompt 7 — Emoji over LPC based on response mood

**Problem**: NPC mood is detected but not surfaced visually on the sprite.

**Files**:
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` — `_detectExpression` (~L167)
- Expression service — currently falls back to keyword mood when the agent returns an unrecognized mood

**Task**: when an NPC response carries a mood (happy/sad/angry/…), show a small
emoji over the NPC's LPC sprite for a short duration. Reuse the existing
expression detection; map mood → emoji (e.g. angry → 😠).

**Check**: NPC gives an angry response — an 😠 (or equivalent) appears over the
sprite briefly, then fades.

### Prompt 8 — `zoning.position` log spam

**Problem**: `[spam:zoning.position] (suppressed 601 repeats in 10s)` floods the
console every frame.

**Files**:
- `packages/frontend/engine/src/systems/zoning_system.ts` — `logger.spam('zoning.position', …)` (~L58–60)

**Task**: remove the per-frame `zoning.position` debug log, or raise its interval
to something negligible (it is already deduped but still fires ~2×/sec).

**Check**: run the game — the console no longer floods with `zoning.position`
lines.

### Prompt 9 — Persona avatars: webp conversion + R2 upload + defaults

**Problem**: default personas (Lyra, Zeph, Thaldrin) have placeholder
`illustrationAsset` values and no real avatars.

**Files**:
- `tmp/lyra.jpg`, `tmp/zeph.jpg`, `tmp/thaldrin.jpg` — source images
- `packages/shared/constants/src/lib/characters.ts` — `STARTER_HEROES` (`illustrationAsset: 'starter_lyra' | 'starter_zeph' | 'starter_thaldrin'`)
- `apps/frontend/client/src/lib/services/storage/emulator_seed_service.svelte.ts`
- `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts` + persona creation service (`avatarUrl`)

**Task**: convert the three tmp jpgs to optimized webp, upload them to the R2
bucket via the existing storage service, and wire them as the avatar for the
default personas so they appear in persona creation and starter cards.

**Check**: create/open a starter persona — the correct webp avatar shows for
Lyra, Zeph, and Thaldrin (no placeholder).

### Prompt 10 — Dialogue memory survives exit → re-enter

**Problem**: talking to an NPC, exiting dialogue, then talking again loses the
conversation.

**Files**:
- `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` — `memory`, `startSession` (~L224), `endSession` (~L244), bounded window `.slice(-20)` (~L915)

**Task**: keep the dialogue history/memory alive across `endSession` →
`startSession` for the same NPC, so re-entering dialogue resumes the
conversation. At minimum in-session; persist only if it falls out trivially.

**Check**: talk to an NPC → exit dialogue → talk to the same NPC again; the NPC
remembers the prior exchange.

## Resolved / already implemented

- ~~Contract pipeline worktree creation should use herdr's built-in worktree extension instead of a custom implementation.~~ Already done: `scripts/src/lib/herdr/worktree.ts` is documented as "THE single source of truth for task/contract worktree provisioning" and is consumed by `herdr_adapter.ts`/`orchestrator.ts` (contract pipeline), `herdr/task.ts` (`bun herdr:task` CLI), and pi extension tools. Low-level git primitives stay separate in `scripts/src/lib/agents/git_worktree.ts` by design. No action needed — verify nothing still calls a non-herdr worktree path before closing out any related issue.

## Contract candidates

### 1. Re-enable Tauri updater artifact signing
Trivial flip: `bundle.createUpdaterArtifacts: false` → `true` in `apps/frontend/client/src-tauri/tauri.conf.json`. CI (`release.yml`) already has the signing secrets wired up. Gated on "real users + stable release cadence" — a readiness decision, not a code blocker.

### 2. Herdr Windows output-capture investigation
`bun herdr:start tauri` launches the Tauri binary fine on Windows, but its stdout/webview console never reaches the herdr pane's captured output. Suspected cause: Tauri release builds are `IMAGE_SUBSYSTEM_WINDOWS_GUI` PE binaries, which don't reliably inherit a parent console/pty — herdr's ConPTY implementation likely doesn't handle that. Needs verification on Linux/NixOS to confirm capture works there (no GUI/console subsystem distinction on ELF/Mach-O). Outcome is either "Windows-only, tracked upstream" (doc update) or "bug is elsewhere" (reopen investigation).

### 3. Distribution & onboarding rollout
Larger initiative, already scoped in [`strategy/distribution-and-onboarding-2026-08-19.md`](strategy/distribution-and-onboarding-2026-08-19.md) — 5 contract-ready seeds + 3 open questions. Read that doc before writing any of these contracts. Recommended order: BYOK polish → release-trigger hygiene → Docker-free local install → managed trial.
- Quick win called out separately: `publish-local-stack.yml` is `workflow_dispatch:`-only (the `push:` trigger is commented out, lines 32-36 of the workflow). `aikami-model-fetcher` and `aikami-client` images have shipped stale to users as a result (~14h and ~39h behind their Dockerfiles respectively at time of writing). Cheapest high-value fix in the strategy doc — do this first.

### 4. Fix `bun run test:unit` failures (client + hub)
Pre-existing, unrelated to the SvelteKit 3 migration (confirmed identical failure counts at pre-merge branch tip: client 381 failures/1287 tests, hub 17/34 failures).
- **4a. Dynamic import path resolution**: dynamic `import('$lib/...ts')` calls with an explicit `.ts` extension (used to re-import after `mock.module()`) don't resolve through `bun test --tsconfig tsconfig.test.json`'s path mapping the way extensionless static imports do. Examples: `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.test.ts:770`, `apps/frontend/hub/src/lib/views/catalog/__tests__/category_load.test.ts`. Related cleanup: `client/tsconfig.test.json` is a hand-maintained, incomplete duplicate of `vite.config.ts`'s alias list — worth unifying once the `#`-subpath-imports migration (item 6 below) lands, since Node subpath imports would give tests and Vite the same resolution source for free.
- **4b. `hub` health check test**: `hub/src/lib/server/api/tests/health_db.test.ts` fails with `setHealthDbEnv is not a function` — looks unrelated to 4a, not yet investigated.

### 5. Resolve `check_bundle.ts` facade-getter suppression
`scripts/check_bundle.ts` carries a 7-name suppression list (`KNOWN_UNREACHABLE_FACADE_GETTERS`) for a rolldown bug surfaced by merging C-443 into `chore/sveltekit3-migration`. `packages/frontend/engine/src/index.ts`'s `export * from './sim.ts'` / `'./render.ts'` leaves a dangling namespace-facade getter for 7 constants (`KEYBINDING_STORAGE_KEY`, `MAX_ENTITIES`, `MIN_ENTITY_Y`, 4x `TILED_FLIP_*`) that are always fully inlined at their usage sites — dangling getter, not a live crash, so the suppression is safe for now. Ruled out: reverting the `/sim` subpath static import from C-443, disabling rolldown's `minifyInternalExports`. Needs a decision before scoping:
- (a) Curate `index.ts`'s `export *` into explicit named lists (value + type, ~200 exports to enumerate correctly — no "barrel completeness" test coverage exists yet, so do this carefully), or
- (b) Find and fix/report the actual rolldown defect upstream (likely cross-chunk star-re-export facade generation when a module is reachable both as its own subpath entrypoint and transitively via the barrel).
Revisit urgently if `findUnboundNamespaceGetters` ever flags a *different* name — that would mean the bug class is spreading.

### 6. Migrate `client` + `hub` off deprecated `kit.alias` to Node subpath imports (`#foo`)
Largest, most fully-specified item — do as its own PR, not bundled with other work. Full recipe, alias inventory, and search/replace commands are preserved below in [Migration recipe: `#`-prefixed subpath imports](#migration-recipe-prefixed-subpath-imports). Suggested split:
- **6a. Decision (blocking)**: pick (a) minimal-risk — rename `@aikami/*`-style aliases to `#`-prefixed (e.g. `@aikami/frontend/theme` → `#aikami/frontend/theme`), same `src/`-pointing behavior, loses the "looks like a real npm package" convention — or (b) correct-but-bigger — add real `"exports"` subpaths to each aliased package's `package.json` (e.g. `packages/frontend/theme`) and drop the vite alias entirely, consuming as `@aikami/frontend-theme/...`.
- **6b. Mechanical `$`-style → `#`-style migration, client** (`$appCss`, `$components(/*)`, `$i18n`, `$lib(/*)`, `$logger`, `$router`, `$routes`, `$services(/*)`, `$types`, `$utils(/*)`, `$views/*`).
- **6c. Mechanical `$`-style → `#`-style migration, hub** (same list plus hub-only `$loggerServer`, `$logger/*`).
- **6d. `@aikami/*`-style migration** once 6a is decided (full inventory in the recipe section below) — both apps.
- **6e. Cleanup + verification**: delete dead `@aikami/frontend/svelte-kit` + `@aikami/frontend-svelte-kit/*` aliases (point at a nonexistent `packages/frontend/svelte-kit/src`; nothing imports them), delete the `alias: {...}` block (and `toSrcPath`/`toPackagesPath` helpers if unused) from both `vite.config.ts` files, update `.pi/skills/svelte-conventions/SKILL.md` and any other doc referencing the old `$lib`/`@aikami/*` convention, run `moon check` + `bun test` for both apps, build + preview both and confirm the deprecation warning is gone and nothing 404s.

Also related build-noise cleanup that surfaced alongside this (fold into 6e or file separately, low priority): 7 `INEFFECTIVE_DYNAMIC_IMPORT` warnings (real, but pure bundle-splitting hygiene — modules are statically imported elsewhere too), Firebase keys still present in `.env.production` despite the Firebase removal, `tsconfig.json` "paths" being overwritten during validation, and an adapter warning that reading `config.kit` inside adapters is deprecated (should read `config` directly).

---

## Migration recipe: `#`-prefixed subpath imports

Reference material for item 6. SvelteKit 3 (`chore/sveltekit3-migration`) prints `The \`config.alias\` option is deprecated ... Use subpath imports instead: https://svelte.dev/docs/kit/$lib` on every dev/build/preview run for both apps. `alias` still works today, it's just deprecated — the fix touches ~480 files in `client` and ~60 in `hub`.

**Why this is bigger than a find/replace:** Node's `imports` field (the replacement mechanism) *requires every key to start with `#`* — a hard Node spec rule, not a SvelteKit choice. The `$foo` style aliases map cleanly (`$lib` → `#lib`), but the `@aikami/frontend/theme`-style aliases are a problem: those are **not** real npm/workspace package names (the real workspace package is `@aikami/frontend-theme` with a dash, declared in `dependencies`/`workspace:*` — the vite alias fakes a slash-namespaced name that bypasses the package's own `main`/`exports` and points straight at its `src/`, presumably to skip a build step). `#`-prefixed subpath imports can't preserve that exact `@aikami/...` spelling — see the 6a decision above.

**Current alias inventory** (from `apps/frontend/client/vite.config.ts` and `apps/frontend/hub/vite.config.ts`, `kit.alias` block):
- `$`-style (local to the app, safe to do as `#`-prefixed subpath imports): `$appCss`, `$components`/`$components/*`, `$i18n`, `$lib`/`$lib/*`, `$logger`, `$loggerServer` (hub only), `$logger/*` (hub only), `$router`, `$routes`, `$services`/`$services/*`, `$types`, `$utils`/`$utils/*`, `$views/*`.
- `@aikami/*`-style (needs the 6a decision): `@aikami/backend/svelte-kit/*`, `@aikami/backend/auth`(`/*`), `@aikami/backend/onboarding`, `@aikami/backend/agent`, `@aikami/backend/knowledge`, `@aikami/backend/team`, `@aikami/backend/admin`, `@aikami/backend/utils/*`, `@aikami/backend/configs/*`, `@aikami/constants`, `@aikami/frontend/services`(`/*`), `@aikami/frontend/components`(`/*`), `@aikami/frontend/configs`(`/*`), `@aikami/frontend/theme`(`/*`), `@aikami/frontend/ai-gateway/*`, `@aikami/frontend/local-runtime`(`/*`), `@aikami/frontend/engine`(`/*`), `@aikami/frontend/test`, `@aikami/frontend/utils`(`/*`), `@aikami/frontend/storage`(`/*`), `@aikami/lpc`, `@aikami/logger` (hub only), `@aikami/mocks`, `@aikami/schemas`, `@aikami/table`, `@aikami/types`, `@aikami/utils`.
- Also delete the two dead/broken lines while in there: client's `@aikami/frontend/svelte-kit` + `@aikami/frontend-svelte-kit/*` point at `packages/frontend/svelte-kit/src`, which doesn't exist (the real package is `packages/backend/svelte-kit`, hub-only, SSR-only helpers) — nothing in `client/src` imports either alias.

**Search-and-replace recipe per app** (repeat per alias, longest/most-specific first so e.g. `$services/*` doesn't get clobbered by a broader `$services` pass):

1. Add a package.json `imports` map for the app (client or hub), one entry per alias, `#`-prefixed, same target as the current `toSrcPath`/`toPackagesPath` value:
    ```json
    "imports": {
      "#lib": "./src/lib/index.ts",
      "#lib/*": "./src/lib/*",
      "#components/*": "./src/lib/components/*",
      "#services": "./src/lib/services/index.ts",
      "#services/*": "./src/lib/services/*"
      // ... one line per remaining $-style alias, same target paths as vite.config.ts today
    }
    ```
2. For each alias, from the app's root (`apps/frontend/client` or `apps/frontend/hub`), rewrite import specifiers with ripgrep + sed (dry-run with `rg` first, then apply):
    ```bash
    # dry run — see every hit before touching anything
    rg -n "from '\\\$services" src

    # apply (macOS/BSD sed needs `sed -i ''`; GNU sed — what this repo's Linux/Nix
    # shell uses — is `sed -i` with no argument)
    rg -l "from '\\\$services/" src | xargs sed -i "s/from '\\\$services\\//from '#services\\//g"
    rg -l "from '\\\$services'" src | xargs sed -i "s/from '\\\$services'/from '#services'/g"
    ```
    Do the `/*`-suffixed (subpath) variant of each alias *before* the bare variant, since the bare pattern is a prefix of the subpath one and a careless single pass will double-rewrite (`#services` inside `#services/foo`). Also check for dynamic `import('$services')` call sites (there's at least one intentional one in `client/src/lib/services/index.ts` — see the comment in `vite.config.ts` about the 150+ static importers) and `vi.mock('$lib/...')`/`bun:test` mock paths in `*.test.ts`, which `rg -n "from '\\\$"` won't catch.
3. Repeat step 2 for every alias in the inventory above, app by app.
4. Delete the `alias: { ... }` block from `apps/frontend/client/vite.config.ts` and `apps/frontend/hub/vite.config.ts` (the whole block, including `toSrcPath`/`toPackagesPath` if nothing else uses them).
5. Run `moon check` (typecheck + lint) and `bun test` for both apps — TypeScript resolves `imports` field subpaths automatically under `moduleResolution: "bundler"`, which this repo already uses, so no `tsconfig.json` changes should be needed, but verify `apps/frontend/client/tsconfig.json` / `apps/frontend/hub/tsconfig.json` after.
6. Update `.pi/skills/svelte-conventions/SKILL.md` (and anywhere else in `.pi/skills` that documents the `$lib`/`@aikami/*` import convention) to describe the new `#`-prefixed convention — otherwise every future contract will regenerate the old aliases from muscle memory.
7. Build + preview both apps (`bun run build && bun run preview` in each) and confirm the `config.alias` deprecation warning is gone and nothing 404s.

## Other
- Have .pi/extensions all execute bun run instead of importing from scripts directly, that way we can use bun utilities and use path alias in scripts, then we can implement $logger inside scripts as well. (right we run a test to check if any code in .pi uses bun utilities, so we can update the test to check for any imports from scripts, createa a common wrapper to execute scripts from .pi in .pi/extensions/lib)
- add Bun.spawn({
  cmd: ["your-command"],
  windowsHide: true, // Hides the console window on Windows
});
 for scripts in .pi/extensions to avoid console window popups, so first make .pi/extensions use bun run and then have bun.spawn as test wrapper for bun run autofix
