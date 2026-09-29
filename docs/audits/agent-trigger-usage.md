# Agent-trigger usage audit — issue #382 P1 slice 3

**Status:** audited — no change shipped (documented in the #412 baseline PR)
**Issue:** [#382](https://github.com/BearlySleeping/aikami/issues/382), "Agent triggers, redundant-call elimination and compact context"
**Baseline:** `main` at `ce5a1db58` (#410 and #411 merged)
**Date:** 2026-09-29

---

## Why this audit ran first

Issue #382 asked to *"Define event-based invocation rules for each agent"* and, in
the same section, to *"Audit real caller selection and invocation frequency before
asserting these execute on every turn."* Those two instructions pull in opposite
directions: the first presumes the agents run, the second asks whether they do.

The issue also recorded a suspicion worth taking seriously:

> `built_in_agents.ts` enables Narrative Director, Prose Guardian and Schedule
> Planner by default… **Audit real caller selection and invocation frequency
> before asserting these execute on every turn.**

So the audit question was: **do the built-in agents run in a shipping build, and
if so how often?**

**They do not run at all.** The finding inverts the premise of that entire
workstream.

---

## Finding: the agent pipeline is unreachable from production

### The call graph

`chat_view_model.svelte.ts:706` is the only production-side call site:

```ts
const rawResponse: string | undefined = pipelineVm
  ? await pipelineVm.runPipeline({ /* … agents … */ })
  : await generateResponse();
```

`pipelineVm` is `this._agentPipelineViewModel`, declared **optional**:

```ts
/** Optional agent pipeline ViewModel for pre/post agent orchestration (C-236). */
agentPipelineViewModel?: AgentPipelineViewModelInterface;
```

and it is assigned only from `options.agentPipelineViewModel` (line 365).

The production capability set — `createChatCapabilities()` in
`chat_composition.ts` — **does not include it**. The optional branch is therefore
never taken in a shipping build, and the ternary always falls through to
`generateResponse()`: one streamed model call, no agents.

### Where the pipeline *is* constructed

`getAgentPipelineViewModel` (the production wiring) has exactly one importer:

```
agent_pipeline_composition.ts
  └─ agent_pipeline_sandbox_composition.ts
       └─ routes/(dev)/dev/agent-pipeline/+page.svelte
```

`(dev)` routes are removed from production builds at build time
(`vite.config.ts`: *"Production builds must not ship the `(dev)` route group"*,
gated by `AIKAMI_INCLUDE_DEV_ROUTES`). The route does not exist in a shipped
bundle.

Corroborating: `agentPipelineService` has no other production consumer. Its
importers are the services barrel and `agent_pipeline_composition.ts` — nothing
else. And no agent runner (`runCyoaAgent`, `runWorldStateAgent`, …) is invoked
anywhere outside `agent_pipeline_service.svelte.ts` and its tests.

### What production actually calls

The real dialogue turn is wired in `game_composition_root.svelte.ts` as a
two-call split:

| Call | Task | Purpose |
|---|---|---|
| 1 | `dialogue` | `streamChat` — the narrative prose the player reads |
| 2 | `envelope` | `extractStructure` — choices + state envelope |

Combat adds `combat-ai`, `combat-intent` and `combat-narration`. That is the
whole production AI surface. The eight built-in agents are not part of it.

---

## What this means for #382

The P1 slice-3 work as written — event-based triggers, fingerprint suppression
for "repeated generic post-processing", opt-in prose review — **has no target**.
Those changes are premised on agents running on every turn and wasting calls.
They are not running, so there are no redundant calls to remove.

Per the issue's own instruction — *"Stop speculative optimization when no
bottleneck is demonstrated"* — the correct action is **not** to build it.

### The two real findings that DO need action

**1. A latent wiring gap.** The optional-pipeline branch in `chat_view_model`
means the whole C-236 agent system is written, tested, exported through a
production composition, and reachable only from a dev route. Either that is
deliberate (agents not yet enabled for players) or the wiring is incomplete. It
should be an explicit decision, not an accident of an optional parameter — an
optional capability that silently disables a subsystem is the same class of
problem as the routing bugs #410 fixed, where "not configured" was read as
"configured differently".

**2. The cost is on the *real* path instead.** The production surface is
`dialogue` (1 streamed call) + `envelope` (1 structured call) per turn, plus
combat calls. That is where redundant-call and context-size work would actually
pay — e.g. whether the envelope call needs a full transcript, and whether the
CYOA/expression capability has been folded into `envelope` or dropped.

---

## Verification

| Check | Command | Result |
|---|---|---|
| Pipeline VM in production capabilities | `grep agentPipelineViewModel chat_composition.ts` | absent |
| Only construction site | `grep -rn getAgentPipelineViewModel` | dev sandbox composition only |
| Agent runners outside the pipeline | `grep -rn 'run[A-Z].*Agent'` | none in production |
| Dev routes in prod builds | `vite.config.ts` | excluded at build time |
| Real production AI surface | `grep -rn "task: '" game_composition_root.svelte.ts` | `dialogue`, `envelope` |

No code changed: this is a read-only audit and the working tree is clean.

---

## Recommended next step

Before writing any trigger logic, answer one question: **is the agent pipeline
supposed to be player-facing?**

- **If no** — the honest fix is to make that explicit (drop the unused
  production composition, or gate the optional parameter on a named capability)
  and re-target the P1 work at `envelope` and `dialogue`, which are the calls
  that actually happen.
- **If yes** — that is a real feature gap, larger than a latency optimization,
  and the trigger work becomes relevant *after* it ships.

Either way, the audit's value stands: it prevented building suppression logic for
a subsystem that never executes.
