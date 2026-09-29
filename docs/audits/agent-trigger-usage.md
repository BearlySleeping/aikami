# Agent-pipeline reachability audit — issue #382 P1 slice 3

**Status:** audited — no code changed. Two distinct findings, only one of which
is a defect.
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

The audit question was: **do the built-in agents run in a shipping build, and if
so how often?**

**They do not run at all.** But *why* turns out to matter more than the fact, and
the two candidate explanations lead to opposite follow-up work. Section
[Which of A/B/C is it](#which-of-abc-is-it) settles that.

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

## Which of A/B/C is it?

The fact above has three possible meanings, and they lead to **opposite**
follow-up work. So it was worth settling rather than assuming. Evidence:

### Ruled out: C — an accidental production-integration regression

**`chat_composition.ts` has never contained the pipeline wiring, in any commit
that has ever existed.** Checked by walking every revision of the file:

```bash
for c in $(git log --format=%h --all -- .../chat_composition.ts); do
  git show $c:.../chat_composition.ts | grep -c agentPipeline
done
# no output — zero matches across all revisions
```

So nothing was dropped later. The production surface was never connected in the
first place, which rules out "a merge or refactor severed it".

### Ruled out: B — an unfinished feature

The C-236 contract does not ask for production wiring. Its scope boundary lists
a **dev sandbox** among the in-scope deliverables:

> - Dev sandbox: `/dev/agent-pipeline`

and its execution report scores **AC-6 "Dev Sandbox"** as the sixth and final
acceptance criterion. The contract is `Status: completed` with all six ACs done.
The `agentPipelineViewModel` parameter was introduced **already optional** in the
original C-236 commit (`872d05ee7`) — the diff that added the `pipelineVm ? … :`
ternary also added the property as `?:`. It was never a required capability that
something failed to satisfy.

That is not a half-finished feature. It is a **completed contract that scoped
itself to a dev sandbox.**

### A — intentional architecture: experimental, dev-only, never player-facing

Confirmed. The evidence above points one way, and two more checks agree:

- **The contract's own "Out of Scope"** list defers the player-facing pieces to
  other work: custom agent UI, import/export marketplace, additional agents,
  agent memory endpoints.
- **No E2E, visual or POM test asserts the pipeline on any game route.** The
  contract listed `tests/client/agent_pipeline.spec.ts` in scope; it does not
  exist, and the unit tests cover orchestration only. Nothing in the repo depends
  on pipeline behaviour outside the dev route.

**Verdict: A. The agent pipeline is experimental and dev-only by design.**

## What this means for #382

The P1 slice-3 work as written — event-based triggers, fingerprint suppression
for "repeated generic post-processing", opt-in prose review — **has no target
today**. Those changes are premised on agents running every turn in a shipping
build. They are not, and by design they have not been since C-236 landed.

Per the issue's own instruction — *"Stop speculative optimization when no
bottleneck is demonstrated"* — the correct action is **not** to build it now.

This is **not** a licence to wire the agents in. The #382 issue is a performance
programme; enabling an experimental subsystem for players is a feature decision
with narrative, cost and privacy consequences, and it belongs to whoever owns
that decision. If the pipeline is later promoted to player-facing, the trigger
work becomes relevant — and it should be designed *then*, against the real
traffic profile, rather than speculatively now.

### The one thing that IS worth fixing

The dormant hooks are indistinguishable from a working integration. A reader
sees `agentPipelineViewModel?` on the production chat ViewModel, a production
`agent_pipeline_composition.ts` that exports a real factory, and an entire
service subtree with agents enabled by default — and reasonably concludes the
agents run in the game. They do not.

That is a documentation-and-ergonomics defect, not a performance defect, and it
is the same class as the routing bugs #410 fixed: **an unconfigured capability
that silently reads as a differently-configured one.** The cheap, honest fix is
to mark it explicitly experimental at the seam (a named type or a doc comment
that says the production composition does not wire it), so the next person
either promotes it deliberately or deletes it. That is a small, separate,
non-behavioural PR — proposed, not done here.

### Where the cost actually is

The production surface is `dialogue` (1 streamed call) + `envelope` (1 structured
call) per turn, plus combat calls. That is where redundant-call and
context-size work would pay — e.g. whether the `envelope` call needs a full
transcript, and whether the CYOA/expression capability was folded into
`envelope` or dropped along with the pipeline.

---

## Verification

| Check | Command | Result |
|---|---|---|
| Pipeline VM in production capabilities | `grep agentPipelineViewModel chat_composition.ts` | absent |
| Only construction site | `grep -rn getAgentPipelineViewModel` | dev sandbox composition only |
| Agent runners outside the pipeline | `grep -rn 'run[A-Z].*Agent'` | none in production |
| Dev routes in prod builds | `vite.config.ts` | excluded at build time |
| Real production AI surface | `grep -rn "task: '" game_composition_root.svelte.ts` | `dialogue`, `envelope` |
| **Was it ever wired?** | walk all revisions of `chat_composition.ts` | **never** — rules out C |
| **Was it scoped to dev?** | `C-236` scope + AC-6 | **dev sandbox** — rules out B |
| **Optional from birth?** | `git show 872d05ee7` | introduced already `?:` |

No code changed: this is a read-only audit.

---

## Recommended next step

Nothing to optimize here. The pipeline is experimental by design and costs
nothing at runtime. The two follow-ups worth doing are both small and neither
is performance work:

1. **Mark the seam experimental** so the dormant hooks stop reading as a live
   integration. Separate, non-behavioural PR.
2. **Re-target #382 at the real surface** — `dialogue`, `envelope`, and combat —
   which is what the baseline benchmark already measures.

The audit's value stands either way: it prevented building suppression logic for
a subsystem that never executes.
