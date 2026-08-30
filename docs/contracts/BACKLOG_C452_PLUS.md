# Contract Backlog — C-452 onward

> **Purpose**: a hand-off doc. Each seed below has enough (title, problem,
> target files, priority, dependencies, acceptance gate) for another
> drafting agent (DeepSeek V4 or otherwise) to expand into a full contract
> via `bun run contract C-XXX --root --critique`, without re-deriving the
> "why" from scratch. Same pattern as [`MVP_BACKLOG.md`](MVP_BACKLOG.md).
>
> **Sources**: `docs/TODO.md` (retiring — items preserved here before
> deletion), `docs/strategy/distribution-and-onboarding-2026-08-19.md`
> (already has its own contract-ready seeds — referenced, not duplicated),
> [`C-450`](C-450-contract-pipeline-reconciliation-and-drift-guard.md)'s
> OQ-1 (missing Execution Reports), and the memory/GM-depth roadmap
> discussed 2026-08-30.
>
> 🔴 **ID allocation caveat** (same one `MVP_BACKLOG.md` documents):
> `prepareDirectSource` computes the next ID as `maxId + 1` from contract
> filenames **on disk**, not from this doc. Treat every `C-4xx` below as
> indicative — re-check `ls docs/contracts/ | grep -E '^C-4[5-9]'` before
> authoring each one, since earlier seeds in this list will already have
> claimed IDs by the time later ones are drafted.

## Ordering

```
C-452 ─ missing Execution Reports (17 contracts, doc-only, unblocks nothing else but is overdue)

C-453 ─┐
C-454 ─┼─ toolchain/build hygiene, independently mergeable
C-455 ─┘

C-456 ─ misc small bugs (8 independent sub-items, good filler)

C-457 ─┐
C-458 ─┼─ distribution & onboarding, strict order — see strategy doc §2
C-459 ─┤   (do not start C-459/C-460 before OQ-1/OQ-2/OQ-3 in that doc are answered)
C-460 ─┘

C-317, C-380, C-381 ─ resume existing drafts/approvals, no new IDs

amend C-340 ─ party orders (wait/guard/scavenge) — amendment, not new contract

C-461 ─┐
C-462 ─┼─ RPG depth, in this order (each builds on the last's data model)
C-463 ─┤
C-464 ─┤
C-465 ─┘
```

---

## C-452 — Backfill missing Execution Reports on 17 already-implemented contracts

| Field | Value |
|---|---|
| **Priority** | P1 — these contracts are stuck at `approved`/`in_progress` in `PROGRESS.md` and can never auto-advance without this (see [C-450](C-450-contract-pipeline-reconciliation-and-drift-guard.md) OQ-1) |
| **Target** | `docs/contracts/C-{329,330,331,332,333,334,335,336,337,338,340,341,342,343,345,370,422}-*.md` |
| **Depends on** | [C-450](C-450-contract-pipeline-reconciliation-and-drift-guard.md) (confirms these are the correct 17; do not start until C-450's Feature A/B sweep is executed, in case the sweep finds more) |
| **Docs impact** | internal |

### Problem & baseline evidence

`mark_contract_implemented.ts`'s `--dry-run` against all 22 originally-flagged
contracts (run during C-450 drafting, 2026-08-30) confirmed these 17 already
have real merged code behind them but were never advanced past `approved`
because `hasExecutionReport` requires an `## Execution Report` heading the
original PRs never added. `lint_contracts.ts` refuses `implemented` status
without one — this is a real gate, not a formality, so the fix is writing the
missing reports against the actual shipped code, not just flipping status.

### Acceptance gate

Given each of the 17 contracts, when its actual merged implementation is
verified against its own Acceptance Criteria and an `## Execution Report`
section is added documenting what shipped/what deviated, then
`mark_contract_implemented.ts --dry-run` reports `advance` for it and a real
(non-dry-run) run moves it to `implemented`.

### Notes

C-329–338 + C-340–343 (14 contracts) are the "Phase 2 RPG depth" cluster from
the old `INDEX.md` phase tables — likely share enough context to batch as one
authoring pass even though they stay 14 separate contract files (one
Execution Report each; do not merge the contracts themselves, only the
research/verification pass). C-345, C-370, C-422 are unrelated to that
cluster and to each other — verify independently.

---

## C-453 — Migrate `client` + `hub` off deprecated `kit.alias` to `#`-prefixed subpath imports

| Field | Value |
|---|---|
| **Priority** | P2 — deprecation warning today, not a break; becomes urgent whenever SvelteKit removes `kit.alias` entirely |
| **Target** | `apps/frontend/client/vite.config.ts`, `apps/frontend/hub/vite.config.ts`, both apps' `package.json` (`imports` field), ~480 files in `client/src`, ~60 in `hub/src` |
| **Depends on** | None, but the 6a decision (below) blocks 6d — resolve as an Open Question in the contract itself, don't pre-decide here |
| **Docs impact** | internal — also update `.pi/skills/svelte-conventions/SKILL.md` |

### Problem & baseline evidence

Every dev/build/preview run for both apps prints: `The \`config.alias\`
option is deprecated ... Use subpath imports instead`. `alias` still works,
it's just deprecated. Full inventory, the `$`-style vs. `@aikami/*`-style
distinction, the 6a decision (rename aliases 1:1 vs. add real `package.json`
`exports` subpaths), and the exact `rg`/`sed` migration recipe are preserved
verbatim in `docs/TODO.md` §6 as of 2026-08-30 — **copy that section into the
contract's Design Reference / Architecture Directives before TODO.md is
retired**, do not re-derive it.

### Acceptance gate

Given the full alias inventory, when every `$foo`/`@aikami/*` import
specifier is rewritten to its `#foo` equivalent and the `alias` block is
deleted from both `vite.config.ts` files, then `moon check` and `bun test`
pass for both apps, and neither dev/build/preview run prints the deprecation
warning.

### Notes

Largest, most mechanical item in this backlog — good candidate to hand to a
drafting agent as-is since the recipe is already fully specified; the only
real judgment call is the 6a decision (frame as an Open Question, not a
blocker to drafting).

---

## C-454 — Fix pre-existing `bun run test:unit` failures + resolve `check_bundle.ts` facade-getter suppression

| Field | Value |
|---|---|
| **Priority** | P2 — pre-existing failures (not regressions), but block trusting the test suite as a merge gate |
| **Target** | `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.test.ts`, `apps/frontend/hub/src/lib/views/catalog/__tests__/category_load.test.ts`, `apps/frontend/hub/src/lib/server/api/tests/health_db.test.ts`, `apps/frontend/client/tsconfig.test.json`, `scripts/check_bundle.ts`, `packages/frontend/engine/src/index.ts` |
| **Depends on** | Loosely related to [C-453](#c-453--migrate-client--hub-off-deprecated-kitalias-to--prefixed-subpath-imports) (item 4a's `tsconfig.test.json` duplication is naturally resolved once the alias migration lands) — sequence after it, not blocking |
| **Docs impact** | internal |

### Problem & baseline evidence

Two independent pre-existing gaps, confirmed identical failure counts at
pre-merge branch tip (client 381 failures/1287 tests, hub 17/34 failures):
- **4a**: dynamic `import('$lib/...ts')` with an explicit `.ts` extension
  (used to re-import after `mock.module()`) doesn't resolve through `bun test
  --tsconfig tsconfig.test.json`'s path mapping the way extensionless static
  imports do.
- **4b**: `hub/src/lib/server/api/tests/health_db.test.ts` fails with
  `setHealthDbEnv is not a function` — not yet investigated, may be unrelated
  to 4a.
- **Item 5**: `scripts/check_bundle.ts` carries a 7-name suppression list
  (`KNOWN_UNREACHABLE_FACADE_GETTERS`) for a rolldown bug — `index.ts`'s
  `export * from './sim.ts'`/`'./render.ts'` leaves a dangling
  namespace-facade getter for 7 constants that are always fully inlined at
  usage sites. Not a live crash today. Needs a decision before scoping: (a)
  curate `index.ts`'s `export *` into explicit named lists, or (b) find/fix
  the actual rolldown defect upstream. Revisit urgently if
  `findUnboundNamespaceGetters` ever flags a *different* name.

### Acceptance gate

Given the current failing suites, when 4a/4b are root-caused and fixed, then
`bun test` is green for both apps with no new suppressions added; given the
`check_bundle.ts` decision, when it's applied, then
`KNOWN_UNREACHABLE_FACADE_GETTERS` either shrinks to zero (option a) or is
replaced by a linked upstream issue reference (option b).

### Notes

Also fold in the related build-noise cleanup from `docs/TODO.md`'s tail of
item 6: 7 `INEFFECTIVE_DYNAMIC_IMPORT` warnings, stale Firebase keys in
`.env.production`, `tsconfig.json` `"paths"` being overwritten during
validation, and the deprecated `config.kit`-in-adapters read. All low-risk,
good to sweep in the same PR as 4a/4b/5 since they're all "toolchain warning
noise," not runtime bugs.

---

## C-455 — Enable Tauri OPFS `sqlite3_vfs` persistence via COOP/COEP headers

| Field | Value |
|---|---|
| **Priority** | P2 — real persistence gap (falls back to in-memory DB snapshotted to IndexedDB instead of true OPFS), but has a working fallback today |
| **Target** | `apps/frontend/client/src-tauri/tauri.conf.json` (`app.security.headers`), every cross-origin fetch path (`assets.bearlysleeping.com`, hub `internal_logging` endpoint, provider API calls) |
| **Depends on** | None |
| **Docs impact** | internal |

### Problem & baseline evidence

Every boot logs `Ignoring inability to install OPFS sqlite3_vfs: ... Missing
SharedArrayBuffer and/or Atomics. The server must emit the COOP/COEP response
headers...`. Root cause: `tauri.conf.json`'s `app.security.headers` is `{}`.
Tauri v2 supports setting `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp` there — the missing piece. Not
flipped yet because COEP `require-corp` requires every cross-origin
subresource to carry `Cross-Origin-Resource-Policy` or be fetched in CORS
mode — untested, could silently break asset/texture loading.

**Not a blank-canvas fix** — read
[`guides/TAURI_BOOT_HANDOFF.md`](../guides/TAURI_BOOT_HANDOFF.md#3-ruled-out--do-not-re-investigate)
before touching this; something here has already been ruled out once.

### Acceptance gate

Given the headers are set, when the app boots and every network path (R2
assets, hub logging, provider APIs) is exercised, then `SharedArrayBuffer`/
`Atomics` are available, the OPFS warning is gone, and no asset/texture fails
to load due to CORP/CORS.

---

## C-456 — Misc small bugs / polish batch

| Field | Value |
|---|---|
| **Priority** | P2/P3 — independent, low-effort, good filler when other work is blocked |
| **Target** | See sub-items — spans settings, capability dialog, CI caching, Cloudflare/SOPS onboarding, Discord bot, device-link sign-in, hub favicon, LPC/map preview |
| **Depends on** | None — each sub-item is independently mergeable; consider splitting per the contract's own Size & Split Rule if any one turns out bigger than expected |
| **Docs impact** | mixed — 8f (device-link) and 8h (preview) are user-facing bugs |

### Sub-items (verbatim from `docs/TODO.md` item 8)

- **8a.** "Download kororo" button in settings does not work.
- **8b.** Capability dialog is not persistent; needs a different UX for voice
  vs. image.
- **8c.** Add build caching for Tauri (and web, hub, site, docs) that reuses
  the same cache mechanics as the CI/deploy pipeline, so local `build` calls
  get the same caching as CI.
- **8d.** Set up Cloudflare, SOPS, and CI onboarding/setup stage.
- **8e.** Update Discord bot to role-sync third-party tool access based on
  which channels a user wants to join.
- **8f.** Device-link sign-in flow bug: signing in via the device-link page
  (opened from Tauri's "sign in" when not signed in on browser) redirects to
  the start page and forgets the device link.
- **8g.** Hub favicon 404s (`https://hub.bearlysleeping.com/favicon.png` →
  404). Fix in `apps/frontend/hub/src/app.html`, reusing the client's
  `app.html` setup.
- **8h.** LPC preview (hub) and map preview not working: `WebGL context was
  lost` + `JSON.parse: unexpected character at line 2 column 1`.

### Acceptance gate

Given each sub-item, when fixed, then its own specific repro no longer
reproduces — write one AC per sub-item rather than one broad AC for the
batch, since they're unrelated failures.

---

## C-457 — Publish local-stack images on every merge, not by hand

| Field | Value |
|---|---|
| **Priority** | P1 — actively shipping broken images to users today |
| **Target** | `.github/workflows/publish-local-stack.yml` |
| **Depends on** | None — do this first per the strategy doc's own ordering |
| **Docs impact** | internal |

Full seed (problem evidence, acceptance gate) already written — see
[`distribution-and-onboarding-2026-08-19.md`](../strategy/distribution-and-onboarding-2026-08-19.md#c-42x--publish-local-stack-images-on-release-not-by-hand).
Copy it in verbatim; do not re-derive.

---

## C-458 — BYOK onboarding: key to playing in 60 seconds

| Field | Value |
|---|---|
| **Priority** | P1 — highest impact per unit of effort in the strategy doc |
| **Target** | `apps/frontend/client/src/lib/views/capability/`, `.../settings/connection/` |
| **Depends on** | None |
| **Docs impact** | user-facing |

Seed already written in the strategy doc (same section header pattern) —
continue reading past the C-42x #1 seed for the BYOK entry and copy it in.

---

## C-459 — Docker-free local install path

| Field | Value |
|---|---|
| **Priority** | P2 — serves the audience the codebase already targets (C-419 SillyTavern/chub crowd runs one-click local runners, not `docker compose`) |
| **Target** | Onboarding/capability detection flow; see strategy doc for the specific reframe |
| **Depends on** | [C-457](#c-457--publish-local-stack-images-on-every-merge-not-by-hand), [C-458](#c-458--byok-onboarding-key-to-playing-in-60-seconds) per the strategy doc's explicit ordering |
| **Docs impact** | user-facing |

Read the strategy doc's §1 reframe (web vs. desktop × BYOK vs. local-engines
matrix) before drafting — this contract only makes sense in that framing.

---

## C-460 — Managed trial (demo-scoped hosted inference)

| Field | Value |
|---|---|
| **Priority** | P3 — costs real money per user, needs evidence it converts before building |
| **Target** | TBD — blocked on open questions below |
| **Depends on** | [C-458](#c-458--byok-onboarding-key-to-playing-in-60-seconds), [C-459](#c-459--docker-free-local-install-path) |
| **Docs impact** | user-facing |

**Do not draft this one until the strategy doc's OQ-1/OQ-2/OQ-3 are
answered** (uncensored-model policy, willingness to pay for inference,
measured BYOK drop-off) — they're product decisions, not implementation
details, and drafting against an unanswered OQ-1 in particular (content
policy) risks scoping a feature that gets vetoed at review.

---

## Resume as-is (no new IDs)

- **C-317** — `status: approved`, rebuild start menu around campaigns. Ready
  to run: `bun run contract C-317 --root --critique`.
- **C-380** — `status: draft`, frame pacing and click-to-move. Resolve its
  own Open Questions first (see file).
- **C-381** — `status: draft`, content pipeline hardening. Resolve its own
  Open Questions first (see file).

## Amend, don't re-contract

- **C-340** (party & companion gameplay, `status: approved`) — has
  recruit+follow+formation but no wait/guard/scavenge party orders. Bump its
  version and add the missing orders as new ACs rather than opening a
  sibling contract; the existing `PartyRosterEntrySchema`/`PartyStateSchema`
  data model already fits.

---

## RPG-depth batch (C-461 … C-465)

Sequenced — each builds on the previous one's data model, so draft and land
in order even though they're separate contracts.

### C-461 — Group chat + systemic NPC interactions

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Target** | `apps/frontend/client/src/lib/services/game/party_roster_service.svelte.ts`, GM prompt assembler, autonomous NPC idle-chat system (`packages/shared/constants/src/lib/autonomous_npc.ts`) |
| **Depends on** | C-340 amendment above (party orders) |
| **Docs impact** | user-facing |

Multiple party/NPC members participating in one conversation turn, not just
1:1 player↔NPC. Builds on the existing address-mode scoping in
`gm_prompt_service.svelte.ts` (C-235) and the idle-chat cooldown/talkativeness
system (C-248) — reuse both rather than building a parallel system.

### C-462 — GM prompt assembly upgrade

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Target** | `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` |
| **Depends on** | C-461 (needs the group-chat context shape to assemble against) |
| **Docs impact** | internal (prompt quality, not new UI) |

Current assembler is 6KB-budgeted, address-mode scoped (C-235). Scope this
against whatever the memory/lore retrieval contract (C-463) below produces,
since prompt assembly and retrieval are the same budget problem from two
sides — draft C-463 first if possible, or keep both Open Questions in sync.

### C-463 — In-house memory & lore retrieval system

| Field | Value |
|---|---|
| **Priority** | P1 — the single highest-leverage gap identified in the 2026-08-30 roadmap review |
| **Target** | New service, likely `packages/frontend/services/memory/` or similar; touches `lorebook_store.svelte.ts`, `keyword_scanner.ts`, `session_summary_service.svelte.ts`, `compacted_campaign_summary.ts` (C-344), `relationship_state.ts`/`faction_standing.ts`/`faction_member.ts` (C-341) |
| **Depends on** | None structurally, but sequence before C-462 if possible |
| **Docs impact** | user-facing (memory quality is directly felt) |

**Build in-house, do not adopt VoiceMem or another third-party memory system
directly** — VoiceMem is architectural inspiration only (confirmed
2026-08-30), not a dependency. The deciding factor: Aikami-specific context
(factions, relationships, party state) needs to feed retrieval, which a
generic third-party memory system can't do without heavy adaptation anyway —
at that point building it in-house, informed by VoiceMem's retrieval
approach, costs about the same as adapting VoiceMem and avoids the dependency.
Consider a pluggable backend interface (as raised 2026-08-30) so a
third-party or user-swappable backend remains possible later without a
rewrite — but don't over-build that abstraction for a single initial backend;
one clean interface boundary is enough, not a full plugin system.

### C-464 — AI GM / narrative director enhancements

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Target** | `gm_prompt_service.svelte.ts` and whatever director-level logic exists above it |
| **Depends on** | C-462, C-463 |
| **Docs impact** | user-facing |

Scope against directive #2 ("AI proposes; the rules engine decides") and
directive #4 (hand-authored baseline before generation) — do not let this
contract erode either guarantee.

### C-465 — NPC behavioral autonomy layer

| Field | Value |
|---|---|
| **Priority** | P3 |
| **Target** | ECS offscreen macro simulation (`MacroSimulationSystem`, C-194), autonomous NPC idle-chat (C-248) |
| **Depends on** | C-461, C-463 |
| **Docs impact** | user-facing (indirect — NPCs feel more alive) |

Both C-194 (offscreen GOAP stepping) and C-248 (idle-chat cooldowns) already
exist and are lightweight by design — check whether this contract is
actually "wire memory/relationships into decisions these systems already
make" rather than a new simulation layer, per directive #7 (progressive
disclosure) and the general bias in this codebase against feature-bloat
copied from reference tools (Marinara-Engine/SillyTavern/RisuAI) that don't
share Aikami's directives.

---

## Not included here

- **GitHub issue → contract conversion** (34 open issues) — in scope for
  [C-450](C-450-contract-pipeline-reconciliation-and-drift-guard.md) Feature
  A, not this doc. Do not draft separate contracts for them until C-450's
  triage pass identifies which survive as real work.
- **Media director** — mentioned in earlier roadmap discussion but not yet
  scoped enough to seed here; needs its own follow-up conversation before a
  seed can be written.
