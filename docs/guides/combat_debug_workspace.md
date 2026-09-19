# Combat Debug Workspace

One development route that answers four questions about a combat bug:

1. **Request** — what did the player (or a controller) actually ask for?
2. **Engine acceptance** — did the kernel accept it, reject it, or suspend it
   behind a reaction window?
3. **Why** — which rule, revision, budget or boundary decided that?
4. **What changed** — which events fired and what does authoritative state look
   like now?

**URL:** `/dev/combat`

The workspace renders the **production** combat surfaces against an **isolated**
session — a private `GameWorld` + ECS worker + engine bridge, disposed with the
page. It never reads or writes your campaign, autosave, party preferences, or
normal game session.

- Route: `apps/frontend/client/src/routes/(dev)/dev/combat/+page.svelte`
- View: `apps/frontend/client/src/lib/views/dev/combat/combat_debug_view.svelte`
- ViewModel: `apps/frontend/client/src/lib/views/dev/combat/combat_debug_view_model.svelte.ts`
- Composition (the only module that touches the real engine):
  `apps/frontend/client/src/lib/views/dev/combat/combat_debug_composition.ts`

## The three modes

Mode is URL configuration (`?mode=`), not a separate page. One ViewModel serves
all three.

| Mode | What it is | Use it for |
|---|---|---|
| `live` | A real, isolated engine session driven by the production combat controls. Engine facts are authoritative. | Reproducing and observing an actual bug. |
| `replay` | Import a recorded reproduction bundle and replay it with the shared pure kernel. Read-only, provider-free. | Checking a bug report off-machine, comparing replay against the recorded log. |
| `fixtures` | Production dice / initiative / log components rendered from typed fixture data, with a persistent **"Presentation fixture — no live simulation"** notice. | Layout, responsive, and presentation work that must be deterministic. |

Live is the default. Fixtures is explicitly labelled so nobody mistakes
fixture-rendered values for a live encounter.

## Adding a scenario

Scenarios are **declarative data**, not code paths. Edit
`apps/frontend/client/src/lib/views/dev/combat/scenarios/combat_debug_scenarios.ts`
and append an entry to `COMBAT_DEBUG_SCENARIOS`.

A `CombatDebugScenarioDefinition` has these fields (defined in
`.../combat/types/combat_debug_types.ts`):

| Field | Meaning |
|---|---|
| `id` | Stable identifier used in `?scenario=`. |
| `version` | Scenario definition version. |
| `title` | Toolbar label. |
| `purpose` | One-line human intent. |
| `proves` | What the scenario is intended to prove; shown in the UI. |
| `seed` | Default deterministic seed. |
| `defaultEngine` | Always `'v2'`. |
| `requiresContentPack` | `true` only for authored-content scenarios. |
| `synthetic` | `true` for tiny synthetic fixtures, `false` for authored content. |
| `battlefield` | `{ kind: 'synthetic', width, height, blockedCells }` or `{ kind: 'authored', mapId, encounterId }`. |
| `controllerPolicies` | `{ player: 'direct', companion: 'direct' \| 'suggest' \| 'auto' \| null, enemies: 'engine-policy' }`. |
| `expectedCheckpoints` | Named checkpoints the scenario declares it must reach (`name`, `description`). |
| `defaultFaultMode` | Fault mode the scenario starts in (see below). |

Adding a scenario requires **no new route and no new engine branch** — it appears
in the toolbar automatically. Synthetic scenarios extend `syntheticBase`;
authored ones set `synthetic: false`, `requiresContentPack: true`, and use
`authoredBattlefield(mapId, encounterId)`.

## Reproducing a bug from a link or export

### URL parameters

| Param | Values | Default |
|---|---|---|
| `scenario` | A registered scenario id | `basic-direct-turn` |
| `mode` | `live` \| `replay` \| `fixtures` | `live` |
| `tab` | `context` \| `actor` \| `action` \| `objects` \| `reactions` \| `ai` | `context` |
| `seed` | Integer | The scenario's default seed |

Invalid values fall back to the defaults and the workspace reports a concise
error in **Run details**; it never silently accepts an unknown value.

A copied link reproduces **initial setup only** (scenario, mode, tab, seed). It
never carries an in-progress run, prompts, credentials, snapshots or provider
secrets. Use **🔗 Copy link** in the toolbar; the URL is synced as you change
these controls.

### Export / import a bundle

A reproduction bundle is the portable artifact for a filed bug. It carries the
recorded initial state, the accepted command journal, optional expected events
and a canonical `expectedFinalHash`, plus a `complete` flag.

- **⇩ Export trace** — renders the bundle JSON in a readonly textarea.
- **⇩ Download bundle** — downloads it as `combat-reproduction.json`.
- **Replay mode** — paste a bundle into the import textarea and press
  **⧉ Replay bundle**. The workspace validates it (size → JSON → schema →
  version → limits → completeness) **before** executing anything.

An incomplete bundle (truncated trace) is rejected and cannot be replayed: a
bounded trace must never masquerade as a complete reproduction. The timeline
shows an **Incomplete trace — N dropped** badge when the bounded buffer dropped
entries.

### Headless reproduction

Replay a bundle with no browser and no engine:

```bash
bun run replay:combat -- /path/to/combat-reproduction.json
```

Add `--expect-divergence` to make the command **succeed only when the replay
diverges** from its recorded `expectedFinalHash` (or aborts early). The CLI
prints scenario id, run id, rules version, command count, event count, whether
`matchedExpected` is true/false/not recorded, and the divergence index when one
exists. It calls no AI, no network, and no content lookup.

CLI: `scripts/src/lib/ops/replay_combat_reproduction.ts`. The same task is
available through Moon as
`bun moon run scripts:replay-combat -- /path/to/combat-reproduction.json`.

## Inspecting a rejection

Two surfaces work together:

- **Trace timeline** (right pane, live mode) lists bounded trace entries in
  buffer order with `sequence`, `kind`, `revision`, turn label, summary and any
  structured payload. The buffer defines the categories `request`, `accepted`,
  `rejected`, `event`, `state`, `controller` and `assertion`; entries are ordered
  by `(revision, sequence)`, never wall-clock time. Rejections and accepted
  commands are surfaced here as they are recorded. The timeline also reports its
  dropped-entry count so a bounded trace never looks complete.
- **Action inspector tab** shows the pending/last action projection (command id,
  revision, semantic intent, grounded kind, acknowledgement, rejection code,
  resulting revision, warnings). The projection type lives in
  `.../inspector/combat_debug_inspector.ts` (`buildCombatDebugActionSummary`), and
  the live ViewModel populates its inputs from the session observer's
  `onCommandRequested` / `onCommandAccepted` / `onCommandRejected` callbacks — so
  the tab reflects the last controller request and the engine's answer to it.
  Before any command has been observed it renders an explicit "no pending action
  projection" placeholder rather than inventing one.

The **Assertions** section below the tabs lists detected dev-assertion
violations (ownership, monotonic revision, budget bounds, snapshot purity,
projection agreement, single settlement, no ordinary command during a reaction)
and says **"No assertion violations detected"** explicitly when the list is
empty — so "no violations" is never confused with "not evaluated".

## Pausing and stepping (what the debugger actually owns)

**The engine has no pause primitive.** Once an encounter starts, the ECS worker
keeps ticking and the deferred-AI protocol keeps running. There is no command
that freezes the kernel.

The only boundary the debugger can honestly own is **client → engine command
dispatch**, so that is what Pause holds. The implementation is
`.../combat/session/combat_debug_command_gate.ts`; the live session wraps its own
bridge with it, and the production combat UI drives commands through that gated
view.

| Action | What really happens |
|---|---|
| **⏸ Pause** (or **Space**) | Commands the production UI tries to send are queued at the boundary instead of dispatched. Nothing reaches the worker. |
| **⏭ Step** | Releases **exactly one** queued command, in dispatch order. |
| **▶ Resume** | Flushes the queue in dispatch order and dispatches synchronously again. |

The toolbar shows the boundary state next to the controls (`boundary held — N
command(s) queued`, or `boundary held — no command queued`), so a step never
implies progress that did not happen. When nothing is queued, **⏭ Step** records
the trace row "Debugger step — nothing queued at the engine boundary" and
announces it; it does **not** claim a transition.

### Limits — read these before trusting a pause

- Pausing does **not** freeze engine-side work: worker ticks, an AI turn the
  controller already answered, and in-flight provider calls all continue.
- Only commands that have **not yet crossed** the boundary are held. A command
  already dispatched cannot be recalled.
- A disposed or superseded session drops its queue; a stale command is never
  dispatched into a dead worker.
- While the gate is open it is a transparent pass-through — the production path
  is unchanged.

### Restart vs Reset

Both dispose the current isolated session and boot a **fresh** one (the view
keys the canvas on `sessionEpoch`, so exactly one session is created against a
new element rather than leaving a disposed world behind a dead canvas).

- **↻ Restart** — same scenario identity, the scenario's declared seed, empty trace.
- **⨯ Reset** — additionally drops the run identity, revision, round, assertions
  and pause state.

Neither restores a recorded engine checkpoint. The engine does expose
session-checkpoint commands, but wiring them into a dedicated debug namespace is
still open — see **Not implemented yet** below.

## Comparing a replay

1. Switch to **replay** mode (`?mode=replay`), or import a bundle directly.
2. Paste the bundle and press **⧉ Replay bundle**.
3. The **Replay result** panel reports either "Replay matched — N events, M
   commands", or the first divergence. On divergence it shows the revision and
   event index of the first mismatch.

The comparison replays through the same pure kernel production uses; the
reproduction is the sole mechanical authority, and controller metadata in the
bundle is never fed to the kernel.

## Choosing a fault mode

The **Provider fault** selector injects a deterministic adapter around the real
intent capability, so fault handling exercises the actual controller
fallback/cancellation path rather than a shortcut.

| Fault mode | Behaviour |
|---|---|
| `disabled` | No provider call; the controller's deterministic path handles the request. This is the default for every scenario. |
| `structured-success` | Provider-free; exercises the controller's deterministic success path. |
| `unavailable` | Typed refusal, as if the provider were unreachable. |
| `timeout` | Waits for the configured timeout, then a typed unparseable result. |
| `malformed` | Returns a structurally unusable reply the controller treats as unparseable. |
| `delayed-stale` | Delays, then returns a stale/unparseable result to exercise cancellation and stale-revision handling. |
| `real` | Delegates to the production provider path. **Opt-in only.** |

**Rule:** simulated faults never commit a substitute outcome directly — they
return typed failures the controller already understands, so the real
fallback/cancellation path runs. Only `real` makes a provider call, and it is
never the default and never selected by the E2E suite. Simulated modes must
never be persisted into normal AI preferences.

## Provisioning the real Emberwatch pack

The `emberwatch-proof` scenario (`synthetic: false`,
`requiresContentPack: true`, battlefield `inn` / `proof_encounter`) runs
authored content through the real production path. It needs:

- The **`emberwatch`** content pack on disk under `content/packs/emberwatch/`.
- Its **manifest** to expose the `inn` map (and the `proof_encounter`
  encounter), i.e. `content/packs/emberwatch/manifest.json` plus the map assets
  under `content/packs/emberwatch/maps/`.

The workspace loads the pack by id (`emberwatch`) through the production
content-pack loader. If the pack, its manifest, its map, or any asset
prerequisite is missing, the workspace **surfaces that fact** — it does not
substitute a synthetic lookalike for the authored encounter. Synthetic
scenarios need no pack.

## Verification

Run each check through its Moon task (never a bare tool):

```bash
bun moon run client:typecheck
bun moon run client:test
bun moon run client:test-browser
bun run guard
```

For changes to this workspace, the affected-only sweep is also useful:

```bash
bun moon ci --base=origin/main
```

**E2E lane.** Focused browser coverage lives in
`apps/e2e/tests/client/combat_debug.spec.ts` with the page object
`apps/e2e/src/pom/combat_debug_page.ts`, run from `apps/e2e` with
`bun run test -- --project=client combat_debug`. It covers all three modes and
asserts the fault mode defaults to `disabled`; it never selects `real`. This
guide does not claim those specs have been run.

## Inspecting a reaction window

1. Watch the status strip for **"Waiting for your reaction"**. When a reaction
   window owns the encounter, the encounter is suspended.
2. Open the **Reactions** inspector tab. It shows the open window's id, trigger,
   current reactor, window version, policy, and the ordered reactor list. When no
   window is open it says so explicitly.

## Not implemented yet

These are known gaps. They are reported here rather than simulated, so the
workspace never implies a capability it does not have:

- **Checkpoint restore.** Restart and Reset boot a *fresh* encounter; they do not
  restore a recorded engine checkpoint. The engine's session-checkpoint commands
  (`COMBAT_SESSION_CHECKPOINT_REQUESTED` / `COMBAT_SESSION_REVISION_REQUESTED`)
  exist, but no dedicated debug namespace wires them up.
- **Scenario coverage is declarative.** Scenarios are data, and most synthetic
  ones boot through `buildSyntheticRoster` (a player plus one hostile on adjacent
  cells). Each scenario's declared `proves` / `expectedCheckpoints` have not been
  exercised individually — treat them as intent, not as a verified contract.
- **Real-provider fault mode.** `?fault=real` is opt-in and selects the production
  provider path, but the real delegate was not fully wired through the production
  intent service, so `real` should be treated as unverified.
- **E2E / visual suites** type-check and are ready to run, but have not been
  executed in this environment (no dev servers). See the E2E lane note above.

## Route migration

Two retired routes redirect (307) to the consolidated workspace:

| Old route | New route |
|---|---|
| `/dev/combat-enhancements` | `/dev/combat?mode=fixtures` |
| `/dev/sandbox/combat` | `/dev/combat?mode=live` |

No duplicate ViewModel, fixtures, or simulation code lives behind the old URLs.
