# #382 — Request identity and deferred NPC memory: lane plan and findings

Lane: `fix/382-request-identity-background-lifecycle`
Reviewed snapshot named in the brief: main `6325e9bc5bd959dceef180de2a73827707c25054`
(2026-10-01, with #417 merged).

Refs #382, Refs #381. This is one slice of a program, not its closure.

## 1. Verification against today's main

`origin/main` was fetched before the worktree was cut. At branch time
`origin/main` == `6325e9bc5bd959dceef180de2a73827707c25054` — the reviewed
snapshot is still current, so nothing in the snapshot had been superseded. Every
finding below was then re-derived from the files in the lane worktree rather
than taken from the snapshot; each one names the code that still exhibits it.

No open PR existed at branch time (`gh pr list --state open` returned `[]`), so
this lane stacks on nothing.

## 2. Confirmed defects

### D1 — the coalescer's schema fingerprint erases the schema

`apps/frontend/client/src/lib/services/ai/structured_call_coalescer.ts`:

```ts
JSON.stringify(schema, Object.keys(schema).sort())
```

A replacer ARRAY is applied at *every* level of the tree, not just the root.
The array holds only the root's own top-level keys, so every key that is not one
of those is discarded at every depth. For an ordinary object schema the whole
body vanishes:

```
{ type:'object', properties:{ x:{ type:'object', properties:{ m:{ enum:['A'] } } } } }
  → {"properties":{},"type":"object"}
{ type:'object', properties:{ x:{ type:'object', properties:{ m:{ enum:['B'] } } } } }
  → {"properties":{},"type":"object"}
```

Reproduced directly (nested enum, nested `maxLength`, and an extra nested
property all compare EQUAL). The existing "same prompt under a different schema
is NOT coalesced" test passes only because it varies `schemaName`; two callers
reusing one name over different shapes share one provider call and one answer.
The random `unserializable:` fallback is at least not shared, but the common
path is the broken one.

### D2 — the compiled-schema cache is keyed by name alone

`packages/frontend/ai-gateway/src/lib/structured.ts` caches on `schemaName`.
A caller that reuses a name with a different schema is served the FIRST
schema's compiled form — including its `properties`, `required` and nested
constraints. The cache is unbounded, and `compile()` hands the cached object to
the caller **by reference**, so any adapter that mutates the compiled schema
poisons every later compile under that name.

`enforceStrictSchema` mutates in place, but it runs on a
`JSON.parse(JSON.stringify(schema))` deep clone, so the caller's own schema is
safe. It is the cached *output* that is shared by reference.

### D3 — coalescing identity ignores the effective route and the caller's scope

`StructuredCallIdentity` carries task, schema name/fingerprint, prompts and an
explicit model override. It does not carry the resolved endpoint/provider/mode,
the generation or reasoning settings, any connection/credential identity, or a
campaign/account partition. `_runCoalescedStructured` passes the *initiator's*
`routing` into the shared work, so a second subscriber whose effective route
would resolve differently (settings mutated between the two calls) is served the
initiator's route and answer. The comment in `text_generation_service.svelte.ts`
("Identical requests resolve identically, so the initiator's routing IS the
shared work's routing") is an assumption, not a check.

### D4 — deferred NPC memory has no lifecycle ownership

`apps/frontend/client/src/lib/services/npc/npc_memory_service.svelte.ts`:

- `_enqueue` chains per NPC with no cancellation. Work queued for a
  conversation that has since been superseded, or for a campaign that has since
  been torn down, still runs and still pays a provider call.
- `_prefetchOpener`'s `finally` does `this._prefetching.delete(npcId)`. That set
  is never cleared by `reset()`, `hydrate()` or the campaign switch, so after a
  reset the ids stay marked in-flight and new prefetches are refused — and an old
  attempt's `finally` removes a NEWER attempt's marker, unblocking a duplicate.
- `_refreshOpener` writes `generatedAt: Date.now()` at COMPLETION. Staleness was
  evaluated at enqueue time; if the world moved on while the request was queued
  or in flight, a stale opener is stamped with the completion time and reads as
  fresh for another `NPC_MEMORY_OPENER_MAX_AGE_MS`.
- `_syncCampaign` bumps `_epoch` but neither cancels queued work nor releases
  per-NPC bookkeeping, so obsolete subscribers survive the switch.
- A digest superseded before dispatch drops its conversation entirely: the next
  digest's prompt carries only the *new* transcript plus the deterministic
  `fallbackSummary`, so durable notes/promises from the superseded conversation
  are never offered to a digest at all.
- Nothing bounds pending refresh work globally or per NPC beyond the
  per-NPC cooldown, and `_prefetching` is a per-NPC dedupe rather than a
  pending-work bound.

### D5 — the contention-domain comment asserts more than it knows

`text_request_admission.ts` justifies keeping the port in the key with "two
Ollama daemons on one host on different ports are two devices with two pools".
Two daemons on one host very commonly front ONE GPU; the port proves a distinct
socket, not a distinct device. The same file correctly refuses to merge two
provider ids on one origin for the same underlying reason. Nothing was measured
here that separates the two, and no device-mapping signal exists in the route
today, so the honest correction is to the stated assumption plus an explicit
resource-association override — not a new hardware settings UI.

## 3. Plan

| # | Change | Gate |
|---|---|---|
| 1 | Deterministic recursive canonical schema form; coalescer bypasses when a schema cannot be canonicalized | two structurally different nested schemas cannot coalesce; key order still shares |
| 2 | Schema-compiler cache keyed by name + canonical form + compiler version, bounded, frozen output | same name + different schema compiles separately; identical contents reuse; caller cannot poison |
| 3 | Effective route (provider/mode/endpoint origin/model/params/reasoning + optional config revision) and an optional typed caller scope join the coalescing key | sharing never crosses route, revision or scope; six-to-one test still passes |
| 4 | NPC memory lifecycle: generation ownership, cancellation of obsolete queued work, apply-time world-state revalidation, bounded refresh, lossless carry-forward of unsummarized lines | queued obsolete work makes zero provider calls; running obsolete work cannot apply; memory bounded under repeated MAP_LOADED |
| 5 | Contention-domain assumption corrected, explicit resource association | comment matches what is known; independent devices still independent |
| 6 | Lane-local lifecycle diagnostics with honest outcomes | discarded work is not reported as success |

## 4. Ownership boundary

Owned and edited here: the coalescer/deduplicator/admission/diagnostics modules
listed in the lane statement, the NPC memory service + helpers + tests, the
narrow NPC-memory schema/type surface if a new field is needed,
`packages/frontend/ai-gateway/src/lib/structured.ts` and its dedicated tests, one
additive named export in that package's `index.ts` (needed so the client can
import the canonicalizer without duplicating it), this document, and new
scenario files.

NOT touched: the gateway transport adapter, the SSE readers, the telemetry
model/recorder/pricing, the common benchmark scripts (all lane B's), and every
shared task constant, barrel, schema registry and root manifest. The one barrel
touch is a purely additive `export { canonicalSchemaFingerprint }` in
`ai-gateway/src/index.ts`; it changes no existing export and no ordering
dependency. Recorded here so the integration owner sees it explicitly.

## 5. Test plan

* `structured_call_coalescer.test.ts` — nested-schema collision reproduced
  first (fails on current code), then key-order sharing, cyclic/unsupported
  bypass, route/credential/scope separation, late followers, cancellation
  matrix. The existing six-to-one subscriber-cancellation test must stay green.
* `structured.test.ts` (new, ai-gateway) — same name/different schema,
  identical reuse, nested `$ref`/combinators, caller mutation, bounded memory.
* `npc_memory_lifecycle.test.ts` (new) — virtual clock only, no real sleeps:
  replace/two-rapid/world-fact-change/map-switch/campaign A→B with the same NPC
  id/reset/hydrate/eviction/dispose/failed provider/late valid response.
* Existing `npc_memory_service.test.ts`, `structured_request_deduplicator.test.ts`,
  `text_generation_service.test.ts` must stay green.

Commands are the project Moon tasks (`client:test`, `client:typecheck`,
`ai-gateway:test`, `ai-gateway:typecheck`, `client:lint`) plus
`bun run scripts/src/lib/ops/run_guards.ts`. No bare `bun test` from a project
directory.

## 6. Changed-file budget

Hard cap 100 as GitHub counts. Planned: ~30–40 files, all inside the owned
paths. Checked with `git diff --name-only origin/main...HEAD` before publishing.

## 7. Measurement plan and honest gaps

Correctness fixes are gated by regressions, not by benchmarks: this slice makes
work *stop* happening and makes answers *stop crossing*, so the measurement
that matters is "how many provider calls did we avoid making / wrongly merge",
which the unit gates answer deterministically. No provider is contacted, no GPU
is exercised and no cost figure is claimed.

Not measured, and not claimed: physical-device contention under distinct ports
(D5), cross-client scheduling, and live `MAP_LOADED` timing. The lifecycle
evidence here is virtual-clock correctness only, kept separate from any live
timing. Provider behaviour is untouched by this slice and a passing mock
proves the contract, not any provider's behaviour.

---

## 8. What was delivered

Base: `6325e9bc5bd959dceef180de2a73827707c25054` (unchanged from the reviewed
snapshot — see §1). Branch `fix/382-request-identity-background-lifecycle`.
19 changed files.

### 1. Deterministic canonical schema form

`canonicalSchemaFingerprint` in `packages/frontend/ai-gateway/src/lib/structured.ts`,
consumed by the coalescer. Recursive, key-sorted, array-order-preserving,
type-tagged and length-prefixed, with `undefined`/non-finite values tagged rather
than dropped. Cycles, functions, symbols, bigints and non-finite numbers are
REJECTED with `UncanonicalizableSchemaError`; the coalescer catches that and runs
the call ALONE (`unshareableCount`) instead of assigning a shared fallback. The
identity is a compared string, never a truncated hash.

### 2. Compiled-schema cache identity

Key is `schemaName + canonical content + SCHEMA_COMPILER_VERSION`. The cache is
bounded (32 entries, FIFO eviction). The compiled output is deep-frozen, so a
caller can no longer mutate the shared entry — that used to be silent
corruption. A schema with no canonical form is compiled but NOT retained, because
a constant key would make every such schema share one entry. The ORIGINAL schema
remains what `validateAgainstSchema` checks against, so the transport strictness
rewrite cannot redefine the application's validity rules; the compiler version
exists so a change to that rewrite is a total cache miss.

### 3. Effective route and partition in the coalescing key

New `apps/frontend/client/src/lib/services/ai/text_effective_route.ts`:
`textEffectiveRoute` (mode, provider, endpoint ORIGIN, model, generation params,
reasoning settings, optional non-secret `configRevision`) and
`buildCoalescingIdentity`. `extractStructure` gained `scope?` and
`configRevision?`. The route is captured ONCE, before dispatch, from the same
`routing` the shared work will use.

The stale comment in `text_generation_service.svelte.ts` — "Identical requests
resolve identically, so the initiator's routing IS the shared work's routing" —
was an assumption presented as a fact. It is now stated as the mechanism it is:
the shared work runs the initiator's route unconditionally, which is why the
key has to name whose route that is.

### 4. NPC memory lifecycle

New `npc_memory_lifecycle.ts`: a GENERATION bumped by reset / hydrate / campaign
switch / dispose; a TICKET per unit so one unit's cleanup cannot clear another's
bookkeeping; a pre-dispatch generation check so obsolete QUEUED work makes zero
provider calls; an apply-time `isStale()` so obsolete RUNNING work cannot apply;
a global pending bound on REFRESH work with an explicit `overloaded` outcome;
digests never dropped for being late.

In the service: the immediate deterministic update is unchanged and still first;
a superseded digest's transcript lines are carried forward (bounded) into the
next digest, so no durable fact is lost; openers are revalidated against a
task-relevant world-state FINGERPRINT before being stamped, and a deferred stale
opener is left absent rather than dated forward; `reset`/`hydrate`/campaign
switch/dispose all funnel through one `_retireGeneration()`; the "currently
refreshing" `Set<npcId>` is gone (it was the cross-generation cleanup bug), and
`dispose` drains.

### 5. Contention-domain assumption corrected

Extracted to `text_contention_domain.ts`. The claim that two daemons on different
ports are two devices is retracted and the reasoning inverted: keeping the port
is what AVOIDS needlessly serializing two genuinely separate processes, and it
cannot prove two processes are not one device. `resourceGroup` is added as the
only merge performed on evidence — a caller that knows several routes alias one
device or one managed runtime names it. Distinct groups stay distinct, so hosted
traffic is not globally serialized. The corresponding test was renamed from
"are DIFFERENT domains" to what it actually asserts.

### 6. Lifecycle diagnostics

`npc_memory_diagnostics.ts` publishes a content-free snapshot on
`__npc_memory_background_diagnostics` on every transition AND every release:
requested / superseded-before-dispatch / overloaded / cancelled /
invalidated-after-completion / applied / failed / pending / pendingHighWaterMark /
oldestPendingAgeMs. No shared telemetry model was touched — those are lane B's.

## 9. Evidence

Raw captures, checksums and a reproduction recipe are in the gitignored lane
`.evidence/382-request-identity/` (`manifest.json`, `index.md`,
`checksums.sha256`).

The regressions were proven to discriminate, by restoring each original
implementation and re-running:

| Restored original | New tests that failed |
|---|---|
| compiler cache keyed on `schemaName` alone | 3 |
| `JSON.stringify(schema, Object.keys(schema).sort())` fingerprint | 5 |

The underlying collision in isolation:

```
{type:"object",properties:{x:{type:"object",properties:{m:{enum:["A"]}}}}}
{type:"object",properties:{x:{type:"object",properties:{m:{enum:["B"]}}}}}
  → both canonicalise to {"properties":{},"type":"object"}
```

A positive control accompanies every isolation gate: two calls with the SAME
route, revision and scope still make ONE provider call, and two calls in the
same campaign still share. Without it, a key that separated everything would
pass every isolation test while having deleted coalescing entirely.

Virtual-clock coverage is at 91 000 ms of injected time (pending high-water
mark, per-unit event age) with no real sleep anywhere in the lane. Live
`MAP_LOADED` timing was not run.

## 10. Checks actually executed

| Check | Command | Result |
|---|---|---|
| client unit suite | `bun moon run client:test --force` | 4448 pass, 7 skip, 2 todo, **0 fail** (335 files) |
| ai-gateway unit suite | `bun moon run frontend-ai-gateway:test --force` | 128 pass, **0 fail** (6 files) |
| client typecheck | `bun moon run client:typecheck --force` | svelte-check: 0 errors, 0 warnings |
| ai-gateway typecheck | `bun moon run frontend-ai-gateway:typecheck --force` | pass |
| lint/format | `bun moon run client:fix`, `bun moon run frontend-ai-gateway:lint` | pass |
| structural guards | `bun run scripts/src/lib/ops/run_guards.ts` | **10/10 pass** |
| affected CI sweep | `bun moon ci --base=origin/main` | 57 actions, **0 failed** |

Every check was run with `--force` (or without cache) so none of them was a
cached no-op.

UNRELATED PRE-EXISTING FAILURE, reported separately: `biome` reports
`lint/style/useNamingConvention` in `apps/frontend/client/scripts/build_tauri.ts`
and `scripts/dev_tauri.ts`. Neither file is touched by this lane; the same two
errors reproduce on the untouched root checkout at `6325e9b`. They are the only
reason `client:fix` exits non-zero here.

## 11. What this PR does NOT close

Concrete corrections, not a claim that #382 is done. Still open:

- **Physical-device contention behind distinct ports.** No device mapping is
  exposed by a resolved route, so the key cannot prove it. `resourceGroup` is the
  escape hatch for a caller that knows; nothing supplies one yet. The residual
  risk is a background request on one port running alongside interactive work on
  another port of the same host and GPU. Not measured.
- **A credential that changes while every route field stays identical** is not
  distinguishable by the current identity. `configRevision` is the typed input
  for it; no settings owner supplies one yet, because wiring it is outside this
  lane.
- **Unscoped callers still coalesce with other unscoped callers.** Callers with a
  real partition (NPC memory, and anything else that can name one) pass `scope`;
  callers that have not been converted are unchanged, not fixed.
- **No live `MAP_LOADED` / real-timing run.** The provider, the GPU and the
  network were never contacted. Nothing here claims otherwise.
- **Digests are serialised per NPC, not parallelised.** A burst of conversations
  with one NPC queues that many digest calls. Correct and lossless, but it is not
  a throughput improvement, and it was not presented as one.
- **Abort does not reclaim provider compute.** The lifecycle aborts the local
  exchange and the admission entry; a provider may keep generating.

## 12. Integration note

One additive export block in `packages/frontend/ai-gateway/src/index.ts`
(`canonicalSchemaFingerprint`, `isCanonicalizableSchema`,
`SCHEMA_COMPILER_VERSION`, `UncanonicalizableSchemaError`), needed so the client
can share one canonicalizer instead of forking a second copy. No existing export
changed. Flagged here for the integration owner; it is the only file outside the
lane's owned paths.

## 13. Rollback

Self-contained and revertible as one commit. The new modules are additive
(`text_effective_route.ts`, `text_contention_domain.ts`,
`npc_memory_lifecycle.ts`, `npc_memory_diagnostics.ts`) and each is consumed only
by files in the same commit, so reverting the commit removes them cleanly. No
schema, no persisted save format and no constant changed: the lifecycle
bookkeeping is in-memory only, and `serialize()` emits exactly the shape it
emitted before. Reverting restores the old defects; it does not require a data
migration or a content regen.
