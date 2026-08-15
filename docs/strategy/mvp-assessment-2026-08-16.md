# MVP Assessment — 2026-08-16

> **Type:** strategic assessment, not a contract. Do not "implement" this file.
> **Companion:** `docs/contracts/MVP_BACKLOG.md` turns the findings here into a
> sequenced contract backlog (C-400 … C-415).
> **Supersedes nothing.** `docs/architecture/data-layer-target-architecture.md`
> remains the authority on the data layer; §2 of this document proposes one
> amendment to it (the inference-hosting reversal) and endorses the rest.

**Author:** assessment session, 2026-08-16
**Trigger:** "we are a bit all over the place" — a review of vendor sprawl,
distribution, UI consistency, and go-to-market readiness, plus a walkthrough of
the actual MVP as it plays today.

---

## 1. Headline

Four questions were asked: consolidate infrastructure? change the Docker
distribution model? drop daisyUI? market on Reddit?

**All four are infrastructure and packaging questions. None of them is what
stands between Aikami and its first users.**

The measurements that frame everything below:

| Metric | Value |
|---|---|
| Client LOC (ts + svelte) | ~154,000 |
| Dev / sandbox routes | 47 |
| Player-facing routes | 6 (`/`, `/capability`, `/setup`, `/personas`, `/game`, `/settings`) |
| Contract files | 174 active, 121 archived |
| `scripts/` LOC | ~41,000 |
| Human contributors | 1 |
| GitHub stars / forks | 2 / 1 |

`docs/strategy/vision-and-directives.md:87` states the Honest Recommendation:

> *"Freeze feature expansion and build one authored, offline-capable (local-AI),
> 10–20 minute vertical slice."*

Since that was written the project has shipped a Neon data plane (C-394), an R2
publish pipeline (C-395), a hub catalog (C-396), an STT service (C-393), a
hardware-detection wizard (C-391), and an 8-file Docker backend matrix (C-390).
Each is competently built. None is the vertical slice.

**The pattern to name: the process is excellent at producing well-specified
infrastructure work, and has repeatedly deferred the thing its own strategy
document calls the priority.** The infrastructure was not wasted — local-stack
v2 plus signed v0.1.0 desktop binaries is a real distribution story most
projects at this stage lack — but the ratio is wrong, and the four questions
that opened this review were requests for more of it.

This is a stated preference, not an accident: the maintainer enjoys
infrastructure more than polish and bugfixing. The backlog in
`MVP_BACKLOG.md` is therefore deliberately structured so that the polish work
is specified as concretely as infrastructure work usually is — with file
paths, line numbers, and reproduction steps — because under-specified polish
work is what loses to well-specified infrastructure work every time.

---

## 2. Infrastructure and vendor sprawl

### 2.1 The vendor count is lower than assumed

The stated concern was five vendors: Firebase, Cloud Run, R2, Neon, Turso.

**Turso is not a vendor here.** `packages/frontend/storage/package.json:19` and
`packages/frontend/engine/package.json:13` depend on
`@tursodatabase/database` — an *embedded libSQL library*. There is no Turso
account, no Turso bill, no Turso service dependency. It is SQLite with a brand
name on the package.

The real list is four: **Firebase** (Auth, Storage, Hosting, Functions),
**GCP** (Cloud Run, Cloud Build), **Cloudflare** (R2 + DNS), **Neon**
(Postgres). Cloudflare DNS would be wanted regardless.

### 2.2 Supabase — no

`data-layer-target-architecture.md:102` already rejected it and the reasoning
holds. Reinforcing it:

- Supabase's value *is* its Auth + RLS + PostgREST stack. D-12 (keep Firebase
  Auth) and I-9 (no vendor-proprietary surfaces) forbid adopting exactly that.
  You would take the lock-in and use none of the benefit.
- Migrating auth means rewriting the Tauri desktop flow, the device-handoff
  callable, and the COOP popup handling documented at
  `docs/architecture/limitations.md:108-115` — all of which currently work.
  Weeks of work, zero user-visible change.
- Supabase Free **pauses projects after 7 days of inactivity**. For a
  pre-launch project that is strictly worse than Neon's 5-minute
  scale-to-zero.

### 2.3 "Go full Turso Cloud" — no

Already rejected at `data-layer-target-architecture.md:104`, correctly:
per-database sync granularity would require N databases for N users, which
makes the cross-user catalog queries the hub exists for impossible. It would
also replicate chat transcripts to the cloud, silently changing the BYOK
privacy posture.

### 2.4 🔴 The GCP inference endgame — reverse this

**This is the one infrastructure decision in the current plan that is wrong,
and it is not yet written as an ADR, so it is still cheap to change.**

The plan is Cloud Run for image / text / TTS / STT once pay-as-you-go users
appear. Against that:

| Factor | Cloud Run GPU (L4) | Frontier API (Haiku 4.5 class) |
|---|---|---|
| Cost | ~$0.71/hr, billed while warm | fractions of a cent per call |
| Cold start | 20–30 s (model weight load) | none |
| Quality | limited by what fits on one L4 | strictly better |
| Ops burden | image builds, weight storage, autoscaling, GPU quota | none |

The player waits on that cold start for their **first line of dialogue**.
Self-hosted inference only wins at sustained high utilization — precisely the
condition a pre-revenue project does not have and will not have for a long
time.

**Recommendation:** the `service` mode of `AiProviderGateway` should be a thin
**metered proxy over Anthropic / OpenAI / Gemini**, not GCP-hosted GPUs.
Directive #10 already guarantees this is a swap at one layer, and
`docs/strategy/deferred.md` already lists "Cloud Run cold-start optimization
(model weights in Storage instead of the Docker image)" as Phase 5 work —
this recommendation deletes that line item rather than scheduling it.

Doing this removes the entire Cloud Run inference plan and, with it, most of
the original motive for consolidating vendors at all. Tracked as **C-413**.

### 2.5 The one consolidation worth doing

`apps/backend/firebase/src/controllers/` is four files:

| File | Lines | Content |
|---|---|---|
| `callable/auth.ts` | 39 | routes to shared `handleAuthEndpoint` |
| `callable/poll_device_handoff.ts` | 63 | rate-limited poll |
| `auth/created.ts` | 21 | `logger.log()` + `{success:true}` |
| `auth/deleted.ts` | ~21 | same |
| `scheduler/daily.ts` | 21 | logs a hardcoded summary object, does nothing |

Roughly **150 lines of real logic** supporting an entire deploy target,
emulator surface, IAM configuration, and secret pipeline. The hub is already an
Elysia server on Cloud Run. Move the two real endpoints there and delete the
rest. Auth and Storage are untouched. Tracked as **C-412**.

### 2.6 Verdict on sprawl

**Leave the rest alone.** The bill is ~$0, each vendor does one job it is good
at, and I-9 already keeps Neon a connection-string away from Cloud SQL. The
data-layer ADR was written on 2026-08-15 with actual cost tables (§4.1) —
reopening it before any of it has met a user is the expensive mistake, not the
sprawl itself.

---

## 3. Distribution — the Docker question

### 3.1 The no-clone path already exists

`apps/backend/local-stack/README.md:17-24` and root `README.md:83` both state
that `model-fetcher`, `voice`, and `web` pull from GHCR by default and that
standalone compose works with no checkout.

**The problem is ordering, not architecture.** The Quick Start's step 1 is
"Clone the repo" (`local-stack/README.md:35`), and the no-clone path is a
paragraph buried below a hardware matrix. Everybody will clone.

### 3.2 But the standalone path is genuinely worse than cloning

"Grab just the `compose*.yaml` files and a hand-written `.env`" means fetching
**9 compose files** and authoring env vars by hand. That is a worse experience
than `git clone`, which is why nobody will choose it.

### 3.3 Recommendation: install script

```
curl -fsSL https://aikami.sh/install | sh
```

Fetches the compose files and runs the existing hardware wizard. Ship
`stack init` as a **Bun-compiled single-file binary** so it has no
prerequisites.

Explicitly **not** a containerized wizard: GPU detection from inside a
container without the NVIDIA toolkit present is unreliable, and hardware
detection is the wizard's entire reason to exist.

**Priority: low.** Nobody is failing to install Aikami because of a clone step.
Tracked as **C-414**.

---

## 4. UI — the daisyUI question

### 4.1 Keep daisyUI

| Measurement | Value |
|---|---|
| Client `.svelte` files using daisy classes | 135 of 227 |
| Daisy class occurrences in client | ~4,700 |
| Hub `.svelte` files | 25, also on daisyUI |

Removing it is a restyle of ~160 files for zero user-visible improvement.

### 4.2 The real problem is missing design tokens

`apps/frontend/client/src/app.css` and `apps/frontend/hub/src/app.css` are
**byte-for-byte identical**, both configured with stock daisyUI `light` /
`dark`:

```css
@plugin "daisyui" {
  themes:
    light --default,
    dark --prefersdark;
}
```

Site and docs are plain Tailwind with **no shared tokens at all**. So all four
properties look like default daisyUI, which is exactly why none of them feels
like a brand. That is the thing being noticed — not the framework.

**Fix, roughly 50 lines and one day:**

1. One custom theme via `@plugin "daisyui/theme"` with the brand palette, in a
   shared file under `packages/frontend/configs`.
2. Client and hub import it instead of duplicating stock config.
3. Export the same values as plain `@theme` custom properties so site and docs
   consume an identical palette without needing daisyUI.

Tracked as **C-409**.

### 4.3 Separately: the component library is two components

`packages/frontend/components/src/lib` contains exactly `modal` and `select`.
*That* is the design-system gap, not the CSS framework.

---

## 5. Marketing readiness

### 5.1 Not yet — and here is the specific reason

`apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:795`
carries this comment:

> *"The gateway streams onChunk for narrative, then returns the full text +
> parsed structured object."*

**It does not.** The `NpcDialogueTextGenerator` type at line 96 has no
`onChunk` parameter, and the call site at line 797 passes only `messages`,
`schema`, `schemaName`, `signal`. The comment is aspirational.

Streaming exists and works — `packages/frontend/ai-gateway/src/lib/sse.ts`,
the OpenAI-compatible adapter, `stream_orchestrator_service` — but its
consumers are `chat_view_model.dev.svelte.ts` and the sandboxes. **The dev
routes stream; the game does not.**

On the default local model (Qwen2.5-1.5B per the README) every conversation
turn is a frozen dialogue box for several seconds while a full structured JSON
envelope generates. Skill checks are worse: line 1373 shows the roll is a
**second** LLM call, so a dice prompt costs two full non-streamed round trips.
That is the reported "stuck when I get dice roll prompt".

This is a design problem, not a wiring oversight: a `{narrative, command,
choices}` envelope cannot be naively streamed. It needs either partial-JSON
parsing of the `narrative` field or a two-call split (narrative first, envelope
second). Tracked as **C-401**.

### 5.2 On Reddit specifically

r/LocalLLaMA, r/SillyTavernAI, and r/rpg_gamers are the right audiences —
r/LocalLLaMA in particular is exactly the person who wants a BYOK/local-model
AI RPG. It is also unforgiving toward projects that are an announcement rather
than software. What works there is a **60-second gameplay video**.

That video cannot currently be shot convincingly. **That inability is the
answer to the question.**

### 5.3 The test that decides it

> Can a stranger get from download to finishing Emberwatch without the
> maintainer in the room?

Not "does it work when driven by its author." Emberwatch is genuinely there —
3 maps, 3 NPCs, 18 dialogues, 1 quest, 1 encounter, and a shipped v0.1.0 with
signed desktop binaries for Windows / macOS / Linux. That is a slice.

Get three people from Discord to cold-run it on their own machines while
watching in silence. If they finish and enjoyed it, post that week. If they
stall at provider setup or the AI returns garbage, that cost one day instead
of burning a first impression that is only available once.

---

## 6. MVP walkthrough — observed defects

Recorded from a live playthrough on 2026-08-16. Each maps to a contract in
`MVP_BACKLOG.md`.

### 6.1 Flow: `/capability` → `/setup` → persona → `/game`

| # | Observation | Severity | Contract |
|---|---|---|---|
| 1 | `/capability` reports providers as `detected` when they are not | P0 — misleads at the first screen | C-406 |
| 2 | `/setup` collects genre, tone, setting, difficulty, goals — **and the output is discarded**; the MVP loads Emberwatch regardless | P0 — the front door is a dead end | C-405 |
| 3 | World generation is slow on OpenRouter free models; runs sequentially | P1 | C-405 |
| 4 | Persona creation redirects to `/dev` for LPC preview | P1 — leaks the workbench into the player flow | C-408 |

**On `/setup`:** the wizard produces genuinely good output (the "Duskhollow"
sample — coherent setting, 6 NPCs, 7 locations, 3 story arcs with objectives
and quest-giver bindings, HUD widget config). It is not bad work. But
`vision-and-directives.md:88` is explicit: *"Do not make AI world generation
the front door."* Right now it **is** the front door, and it feeds nothing.

The recommendation is not to delete it. It is to **cut it from the critical
path**: Emberwatch becomes the default "Start campaign" destination, and world
generation moves behind an Advanced entry point where its output is actually
compiled into a content pack (directive #4 — "every generative feature must
compile into the same versioned content/state contracts used by authored
content"). Until that compiler exists, a wizard whose output is thrown away is
worse than no wizard.

### 6.2 In-game rendering

| # | Observation | Severity | Contract |
|---|---|---|---|
| 5 | **Flying heads** — NPCs render as a disembodied head with no body, torso, legs, or feet | P0 — the single most damaging visual defect | C-400 |
| 6 | Every NPC head is the **same bald pale male head** regardless of `appearanceLayers` | P0 | C-400 |
| 7 | "Invalid NPC" entities appear in the world | P0 | C-400 |
| 8 | Maps are near-unreadable at default night ambient | P1 | C-404 |
| 9 | Inventory / equipment changes do not update the player's LPC sprite | P1 | C-403 |
| 10 | Player becomes **stuck when an NPC walks toward them** | P0 — soft-locks play | C-402 |

#### Root-cause analysis for #5 / #6 / #7

There are **two divergent recipe resolvers** for the same data:

**Worker path** — `packages/frontend/engine/src/worker/ecs_worker.ts:628`:

```ts
recipes.push({
  slot: WORKER_SLOT_NAMES[i] ?? `layer_${i}`,
  assetId: String(effectiveId),      // ← numeric index stringified: "23"
  hexPalette: new Uint8Array(1024),
});
```

**Main-thread path** —
`apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:921`:
resolves the numeric index against `generatedLpcSlots` into a real asset id
(e.g. `torso/clothes/chainmail_male`).

Three specific defects follow:

1. **Silent slot drops.** In the main-thread resolver, when
   `slotDef?.variants[effectiveIdx]` is `undefined` the loop `continue`s with
   no log and no fallback — for `hair`, `torso`, `legs`, and `feet`. Only
   `body` (via `LPC_DEFAULT_BODY_ASSET_ID`) and `head` have guaranteed
   fallbacks. A head with every other slot dropped **is** a flying head.
2. **Forced head fallback.** The same resolver hard-codes index 94 whenever
   the computed variant does not start with `head/heads/`. Elder Thalia's
   head index is 97 → 96, which fails the prefix test → falls back to 94.
   Every NPC therefore gets the identical `heads/human_male`. This is the
   observed uniform bald head.
3. **Two sources of truth for NPC appearance.** The content pack manifest
   declares `appearanceLayers` per NPC
   (`static/content-packs/emberwatch/manifest.json`), but
   `packages/frontend/engine/src/systems/entity_spawner.ts:174` reads them
   from the **Tiled spawn-point properties** instead, falling back to
   `NPC_APPEARANCE_LAYERS = [3,3,23,22,7,95]` (line 164) whenever the property
   is missing, short, or contains any value `< 1`. Any map object that omits
   the property silently gets the default body — and any drift between
   manifest and map is invisible.

C-400 must unify the two resolvers behind one implementation, replace every
silent `continue` with a logged per-slot fallback, and make the content pack
manifest the single source of NPC appearance.

### 6.3 Dialogue UI (`Elder Thalia` screen)

| # | Observation | Severity | Contract |
|---|---|---|---|
| 11 | Portrait strip at top is clipped and overflows the viewport | P1 | C-407 |
| 12 | Portrait art direction is incoherent — AI-generated painterly portraits (Gandalf-like, Aragorn-like) sit beside raw LPC sprite crops | P1 — reads as placeholder | C-407 |
| 13 | Choice buttons overflow into a **horizontal scrollbar**; choices past the third are invisible | P0 — hides valid actions | C-407 |
| 14 | Emoji prefixes on choices are inconsistent (🕯️ 🤝 🪄 ⚔️ 🎲 💬 📋) | P2 | C-407 |
| 15 | Message area is ~70% dead space for a single message | P1 | C-407 |
| 16 | `TTS` toggle is unlabelled and unstyled, bottom-left | P2 | C-407 |
| 17 | No streaming — box is frozen during generation | P0 | C-401 |

### 6.4 Merchant UI

The strongest screen in the build. Remaining issues:

| # | Observation | Severity | Contract |
|---|---|---|---|
| 18 | Left half is an empty haggle panel ("Start a conversation to haggle with the vendor") occupying 50% of the screen | P1 | C-416 |
| 19 | Every item uses the same generic 📦 emoji instead of item art | P2 | C-416 |

Affordances that already work well and should be preserved: gold display,
`Need 50 more` on unaffordable items, stat deltas (`+5`, `+8`, `+2`), keyboard
hints (`Esc close`, `Enter send`).

---

## 7. Cleanup inventory

Small, unambiguous, and safe. Bundled as **C-411**.

| Item | Evidence |
|---|---|
| `packages/frontend/dataconnect` — **0 `.ts` files**, empty directory | D-1 says delete it |
| `packages/frontend/firestore` — **0 `.ts` files**, empty directory | D-2 says delete it |
| Both still referenced from 5 `tsconfig.json` files | `apps/frontend/client/tsconfig.test.json`, `apps/frontend/client/.fast-check/tsconfig.json`, `apps/frontend/hub/.fast-check/tsconfig.json`, `packages/frontend/storage/tsconfig.json`, `packages/frontend/services/tsconfig.json` |
| `docs/contracts/PROGRESS.md` is stale | Auto-generated 2026-08-15, lists C-394 / C-395 / C-396 as `📝 draft` when all three are merged to `main` |
| Duplicated `appearanceLayers` builder | `game_boot_service.svelte.ts:1327-1362` and `game_engine_service.svelte.ts:840-875` are the same ~25-line block, including the identical magic `appearanceLayers[2] = 0; appearanceLayers[4] = 0` |
| Dev routes ship to production | `apps/frontend/client/src/routes/(dev)/+layout.svelte` has no guard — only an `isScreenshot` branch. 47 sandbox routes are reachable on `aikami.bearlysleeping.com` (→ C-410) |
| `scheduler/daily.ts` is a no-op | Logs a hardcoded object and returns; deleted by C-412 |

---

## 8. Borrowing from Marinara-Engine

`examples/Marinara-Engine/packages/client/` is a chat-first engine with a
mature feature surface. The highest-value borrow is **not** a UI pattern:

**Character card import (V2/V3 PNG cards).** Marinara has
`lib/character-import.ts`, `card-asset-links.ts`, `card-version-history.ts`,
`character-token-count.ts`. Supporting the SillyTavern character-card format
plugs Aikami into an existing library of tens of thousands of community
characters on day one. That is a distribution lever, not a feature — it is the
single cheapest way to make the world feel populated without authoring
content. Tracked as **C-415**.

Secondary borrows worth reading before building the equivalents:
`achievement-toast.tsx`, `features/tracker-panel/` (state surfaced beside the
chat), `browser-speech-recognition.ts`, `character-greetings.ts`.

What **not** to borrow: the chat-first shell. Aikami's stated differentiator
(`vision-and-directives.md:95`) is launching into a spatial world instead of a
chat dashboard. Copying Marinara's information architecture would delete the
one thing that distinguishes the product.

---

## 9. Recommended sequence

1. **Cold-start playtest** — three strangers, their own machines, silent
   observation. One day. It will reorder everything below and is the only item
   here that generates new information.
2. **C-400** NPC appearance resolution — the flying heads are the most
   damaging thing in the build.
3. **C-401** dialogue streaming + skill-check latency — highest perceived
   quality per hour in the repo.
4. **C-402** movement deadlock — soft-locks are unshippable.
5. **C-405** cut world-gen from the critical path; Emberwatch is the front
   door.
6. **C-403 / C-404 / C-406 / C-407** polish pass.
7. **C-409 / C-410 / C-411** consistency and cleanup.
8. **C-412 / C-413 / C-414** infrastructure simplification — deliberately
   *after* the game works.
9. **Then** market.

Items 2–7 are the vertical-slice work that `vision-and-directives.md` called
for in July. Items 8 and the questions that opened this review are the
comfortable work. The ordering above exists to keep them in that order.
