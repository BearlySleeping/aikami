# Lane plan — measured context reuse, prompt projection and background request size

**Lane:** `perf/382-measured-context-reuse`
**Refs:** #382 (and #381, whose boundary this lane does not cross)
**Base SHA:** `98df13ddc041e58c1d501363240d727e23935b96` (`origin/main` at checkout,
2026-10-01 23:09 +0200, #420 merged)

This document is the lane's own audit record. It exists before the code so the
scope, the interfaces, the test plan and the deferrals can be checked against
what is actually delivered.

**Dependency state at checkout.** The brief requires A and B to be merged first.
Both are, and their reports are the inputs to this lane:

| Lane | Report on `main` | Merge |
|---|---|---|
| A — native transport, deadlines, attempt accounting | `382-native-transport-report.md` | #420 (`98df13ddc`) |
| B — request identity, deferred NPC memory lifecycle | `382-request-identity-background-report.md` | #418 (`7922a8944`) |
| (C) — priority-aware admission | `382-admission-control-report.md` | #417 (`6325e9bc5`) |
| E — #381 decision pilot | `381-decision-evaluation.md` | #419 (`5e054bc2b`), measured NO-GO |

A's interfaces (`deadlineAt` on the call surface, `AiTransportAttemptEvent`,
`prompt_eval_cached_count` provenance) and B's interfaces
(`buildCoalescingIdentity`, `createNpcMemoryLifecycle`,
`publishNpcMemoryBackgroundDiagnostics`) are **used unchanged**. C's admission
queue is used unchanged. No lifecycle, transport, admission, coalescing or
decision-routing file is edited by this lane.

The reviewed snapshot named in the brief (`6325e9bc5`, #417 merged) is three
commits behind `origin/main`. Every finding below was re-verified against
`98df13ddc`; the supersession notes in §2 record what changed.

---

## 1. The question this lane answers

A's native transport and B's request identity fixed *how* a call is dispatched
and *who it belongs to*. Neither reduced **how much work a call is asked to do**.
After #413–#420, the remaining cost is in three places:

1. **prompt construction and projection** — the same immutable text is
   reassembled on every turn and every background call, and each background
   prompt carries a full dialogue-grade world-state projection;
2. **redundant background calls** — a remembered NPC's opener is regenerated on
   a timer even when every input to the regeneration is byte-identical to the
   inputs that produced the opener already held;
3. **request size** — whether the bounded, mechanical background tasks benefit
   from the native token/reasoning controls A made honoured.

The lane's gate is measurement. Nothing ships that does not measurably reduce
provider time, tokens, redundant calls or first-visible latency on the pinned
runtime, and nothing ships that degrades narrative quality or memory fidelity.

---

## 2. Inventory re-verified against `98df13ddc`

Every row was read in today's code, not carried from the reviewed snapshot.

| # | Surface | State at `98df13ddc` | Disposition |
|---|---|---|---|
| 1 | `envelope` extraction | `reasoning: 'none'` on the preset; 0/33 → 19/20 completed | **Superseded.** Not revived; the fix landed in #415. |
| 2 | In-flight coalescing | `buildCoalescingIdentity` includes effective route + scope; entry dropped when the attempt settles | **Superseded.** B landed it. This lane does not extend it to a result cache without a measured hit distribution. |
| 3 | Background admission | Priority-aware deferral, `summarization` is `background` | **Superseded.** C landed it. |
| 4 | Streaming / deadlines | Native NDJSON, one absolute deadline, per-attempt accounting | **Superseded.** A landed it. The `21.9 s` residual is a *nonpreemptible provider job*, which this lane may shorten by asking for less work — not by cancelling harder. |
| 5 | Combat prefetch | Does not exist; no call site | **Not revived.** No new call-site evidence. |
| 6 | Unwired agent activation | Not wired; no trigger | **Not revived.** No new call-site evidence. |
| 7 | NPC memory prompt assembly | `buildNpcPersona` re-run per turn AND per background call; `_npcContext` runs a **full** `buildContext` (all manifest accounts, companion witness) twice per background call, once only for `.persona` | **Carried.** |
| 8 | Background world-state projection | Digest and opener prompts receive the full `buildGameStateFacts` list, including the ~200-char GM difficulty-guidance paragraph and the equipped-items list | **Carried.** |
| 9 | Opener refresh | Gated on `generatedAt` age (15 min) + `forConversation` only. The world-state fingerprint exists but is only used to *reject* a result, never to *avoid asking* | **Carried.** |
| 10 | Stable prefix | Narrative system prompt interleaves stable `[ALLOWED ACTIONS]` after variable `[GAME STATE]` / `[CONVERSATION HISTORY]` | **Carried.** |
| 11 | Exact-result cache | `TextCacheLayer` already has an `'exact-result'` member that nothing sets | **Deferred unless measured.** See §6. |
| 12 | Application batching | `agent-batch` exists for the *agent* fan-out, not for NPC memory. No batching primitive for MAP_LOADED opener work | **Evaluate; likely retire.** See §7. |

Row 11 is worth stating plainly: the telemetry vocabulary for an exact-result
cache already exists and is unused. That is an invitation, not evidence.

---

## 3. Owned paths

**Owned and edited:**

- `apps/frontend/client/src/lib/services/npc/npc_memory_utils.ts` (+ test) —
  prompt/projection construction.
- `apps/frontend/client/src/lib/services/npc/npc_prompt_projection.ts` (new, +
  test) — the compiled/template cache and the background-specific world-state
  projection.
- `apps/frontend/client/src/lib/services/npc/npc_memory_service.svelte.ts` —
  use the projection; stamp opener freshness with the fingerprint it was
  generated against; suppress a refresh whose inputs are unchanged.
- `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` —
  stable-prefix ordering in the narrative system prompt only.
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_composition.ts`
  — only if the projection boundary requires it.
- `apps/e2e/scripts/ai_context_reuse_probe.ts` (new) — the isolated benchmark.
- `docs/audits/382-context-reuse-report.md`, this document.

**Read but NOT edited** (A/B/C/E territory, or integration hotspots): the
coalescer, `text_effective_route.ts`, `text_request_admission.ts`,
`text_generation_service.svelte.ts`, `npc_memory_lifecycle.ts`,
`npc_memory_diagnostics.ts`, `TEXT_TASK_PRESETS`, any provider descriptor, any
`packages/frontend/ai-gateway` file, root manifests, lockfiles,
`.context/llms.txt`, the common `ai_baseline_*` harness.

`TEXT_TASK_PRESETS` is deliberately **not** edited: `summarization` is shared
with `session_summary_service`, and the brief forbids changing a preset
globally for unrelated callers. A task-specific measurement is run in the probe
instead of a global preset change.

---

## 4. Interfaces (all additive, all lane-local)

| Interface | File | Consumers |
|---|---|---|
| `createNpcPromptCache` / `NpcPromptCache` | `npc_prompt_projection.ts` (new) | memory service, dialogue service |
| `buildBackgroundWorldStateProjection` | `npc_prompt_projection.ts` (new) | memory service |
| `NpcMemoryOpenerRecord.worldFingerprint` + `memoryRevision` | `@aikami/types` `npc_memory.ts` | save schema (additive, optional) |
| `publishNpcMemoryPromptCacheDiagnostics` | `npc_prompt_projection.ts` (new) | test seam / diagnostics only |

The save-schema field is **additive and optional**: an old save hydrates with no
fingerprint, which makes the opener "unverifiable" and therefore refreshable —
the safe direction.

---

## 5. Test plan

Every correctness fix gets a regression that fails on today's behaviour.

| Area | Case |
|---|---|
| Prompt cache | same key returns the identical string; a different persona/name/rule version is a miss; bounded by entry count; bounded by byte size; explicit `clear()`; no cache entry survives a content change; hit/miss counters are content-free |
| Background projection | required facts (gold, active quest, offerable quests, difficulty) present; GM-guidance paragraph absent; equipped list absent; ordering stable; empty state still yields a usable prompt |
| Persona projection | cache hit avoids re-walking the manifest; a persona whose authored identity changed is rebuilt; account facts for a different NPC are never reused |
| Single projection per call | one background call reads world state exactly once (a counter, not a timing assertion) |
| Opener suppression | unchanged world + unchanged memory ⇒ no provider call; changed world ⇒ refresh; changed memory ⇒ refresh; unverifiable old save ⇒ refresh; suppressed refresh is recorded as its own outcome, not as success |
| Opener apply-time revalidation | the existing fingerprint re-check still rejects a result whose world moved on — suppression must not weaken it |
| Narrative stable prefix | stable blocks precede variable blocks; all prior sections still present; prompt content otherwise unchanged |
| Regression | memory write/apply counts, valid-output rate and narrative text are unchanged versus the pre-change corpus |

---

## 6. Exact-result cache — the bar it must clear

A cached decision is not permission to skip command legality, confirmation or
revision checks. Before any store is written, this lane must produce a **repeat
-hit distribution**: for each proposed task, how often does the *same* key
arrive twice outside the in-flight window?

Predicted from reading the code, and to be confirmed by the probe:

- `narrative` / `dialogue` / `envelope` — fresh prose every turn. Non-cacheable.
- `digest` — a new conversation every time. Non-cacheable.
- `opener refresh` — the prompt deliberately embeds the *previous* greeting
  ("Never repeat your earlier greeting"), so a byte-identical repeat is not
  merely rare, it is **not the same request**. Replaying a stored opener would
  return the greeting the prompt was written to avoid. Non-cacheable.
- `agent-*` — outside this lane's ownership and outside the paths measured here.

If the probe confirms that, the honest deliverable is a **suppression of
unchanged refreshes** (avoid asking at all, when the inputs are provably
unchanged) plus a committed, bounded evaluation — not a result cache with no
production user. The `'exact-result'` telemetry member stays unset, and the
report says why.

---

## 7. Batching — the bar it must clear

Batching `MAP_LOADED` opener work into one envelope would mix four NPCs'
private knowledge into one request, lengthen a nonpreemptible provider job
(the 21.9 s residual A documented), and add failure amplification. The
evidence available today does not reach that bar, and no reachable independent
workload with a compatibility predicate has been identified. The default
outcome is a **committed negative evaluation** in the report, with the specific
measurements that would overturn it.

---

## 8. Changed-file budget

Planned **~22–34** changed files against a hard cap of 100 and a 60–85 target
band. The band is deliberately not padded: the instruction is explicit that a
correct smaller PR beats artificial churn, and this lane's correctness surface
is four production files plus their regressions. If the delivered count lands
below 60, that is the honest number.

---

## 9. What this lane will not claim

- No dollar figure. Ollama bills nothing; provider cached-token counts on this
  runtime are `prompt_eval_cached_count` on the pinned version and are
  **unknown** for any other provider.
- No GPU preemption from an aborted HTTP request. Aborting a fetch does not
  interrupt a kernel, and no measurement here will be phrased as if it did.
- No claim that a shorter prompt is a better one. Narrative quality is checked
  against the existing corpus, and a quality regression retires the change.
- No new mandatory planning framework, no new hosted service, no new provider,
  no model download.
- No closing of #382. A checked box is not a program.
