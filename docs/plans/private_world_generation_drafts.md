# G01 — Private narrative world drafts

Baseline: `00d72af83` (PR #431 already merged).

This milestone replaces the wizard's unsafe campaign-seeding path with a
bounded, cancellable **device-local narrative draft**. It does not compile,
install, or start a playable world. The schema fixes `preview: true` and
`playable: false`; the last wizard step is **Draft Saved**, not character
creation.

## Ownership and boundaries

- The wizard owns inputs and presentation. A capability-injected draft service
  owns generation, cancellation, checkpoints and persistence.
- Production composition supplies only the existing text-generation gateway
  and local draft repository. It supplies **no campaign/world/GM mutator**.
- Acceptance writes only the private draft row. In particular it does not call
  `setWorldGenOutput`: that seemingly harmless setter changes the live combat
  GM prompt. The existing combat prompt consumer remains unchanged.
- Retired worldgen-only seeding methods and their now-unused world-state
  mutators are removed rather than retained as disconnected runtime APIs.
- `worldgen_drafts` is migration v8 over the existing local database adapter;
  it has no account or campaign foreign key. Delete-all-local-data includes it.

## Generation contract

The dependency graph is `setting → {cast, places, hudWidgets} → arcs`, with
arcs also requiring the cast. Siblings settle together before the next round.
Each stage has bounded attempts; failed stages do not reissue successful stages.

Wizard inputs and revision bounds are checked before hashing or provider admission.
Duplicate intents cannot admit work or return an old draft as a new result.
Every run has one identity, AbortController and absolute deadline. Requests
use the existing background `agent-world` task, request IDs and scope. Local
waiting is bounded even if the provider ignores cancellation/deadline metadata.
Restart, editing, navigation and disposal retire the run synchronously. Each
run owns detached accumulator/checkpoint state; late results cannot update a
replacement run, clear its active identity, or publish stale persistence state.

Prompts and bounded deterministic fingerprints use the same input-scope
accessor. Invalidation follows actual dependencies transitively. Because the
premise currently consumes every wizard answer, changing goals invalidates the
premise and its dependents; this milestone does **not** promise that a goals edit
always reuses the cast. A rejected aggregate cannot be reused as a valid proposal
by the Retry action.

## Validation and persistence

- Stable IDs disambiguate same-named cast members; arcs reference IDs.
- Unknown quest-givers are reported as stage failures, not silently dropped.
  Place references remain intact until the cast and final validation settle.
- Each provider stage is checked against its bounded schema before receiving a
  successful checkpoint. The assembled draft and repository read/write boundary
  check structure, references and the **UTF-8** serialized byte count.
- Bounds: 20 cast members, 12 narrative places, 8 arcs, 8 HUD widgets, 8 objectives
  per arc, 4 quest-givers per arc, and 256 KiB for the whole draft.
- Acceptance is single-flight and idempotent. A failed write does not claim
  acceptance. Revision-aware SQL prevents an older late write from replacing a
  newer proposal or downgrading acceptance at the same revision. Superseded writes
  are refused rather than reported as saved. Indexed row metadata must match its
  validated blueprint; the full stored payload is verified after flushing.
- Repository writes await the adapter's optional durability flush, which matters
  for IndexedDB-snapshot-backed devices before an immediate page reload.
- A fresh production wizard initializes from the newest validated draft row.
  Late hydration cannot replace a run started while reading. Corrupt or
  unsupported stored data is rejected with a diagnostic.
- `unknown`, `memory` and `durable` persistence are distinct. Database failure
  leaves an explicitly memory-only draft, not a false saved result.

## Verification and evidence

Captain verification is recorded in the isolated checkout's `.evidence/G01/`
lane. Commands use Moon prerequisites/project scripts and preserve their actual
exit codes; piping through a log filter is not a pass. All listed gates passed:
942 schema tests, 147 storage tests, 4,830 client tests, 75 compiled-browser tests,
six project typechecks, structural guards, and 16 Playwright cases (including
setup and two error-policy negative-control cases). A post-freeze focused run
also passed all 36 draft-service cases. The final scoped validation tool passed
fix/format, typecheck and guards for seven affected projects.

| Lane | Acceptance |
|---|---|
| `schemas:test` | Structure, versions, references and UTF-8 size bounds |
| `frontend-storage:test` | Real SQLite migrations, round-trip, revision ordering and flush boundary |
| `client:test` | Production orchestration, failed-stage retention, stale results/writes, acceptance and fresh-service hydration |
| `client:test-browser` | Compiled Svelte reactivity and lifecycle cancellation |
| Scoped `e2e:test-client` | Wizard UI, cancellation/navigation and honest production-route failure/reload smoke |
| Affected fix/typecheck + structural guards | No new guard debt or policy expansion |

Playwright sandbox journeys use an explicitly controllable provider; they are
**adapter acceptance**, not live-model generation or the #433 cold-launch
release journey. UI lifecycle PNGs show narrative preview and saved presentation;
they are not gameplay/WebGL evidence, and are not pre-change-code captures.
Original images, checksums and a manifest remain local and uncommitted. Timestamped
captures preserve prior originals; top, places and footer viewport captures expose
the wizard's inner scroll container. Visual review caught and removed a stale claim
that private drafts feed GM prompts. The corrected notice scored 100/100, and the
four-panel lifecycle montage scored 90/100 with no functional visual issue.

Production reload smoke observes the actual missing `/config.json` response.
Only a same-origin, exact-URL, observed HTTP 404 can classify its corresponding
native 404 console line as the documented C-389 fallback. URL-less/unobserved
errors, unrelated assets, foreign origins, script errors, 403 and 500 remain
failures; page exceptions and other HTTP failures are still asserted.

The source-file-size baseline change only locks in the wizard ViewModel's
reduction below its old accepted debt; it does not raise any ceiling or waiver.
A broad inherited `client:fix` invocation also scans unrelated pre-existing
client scripts. Those failures are kept separate from changed-source checks,
not repaired or suppressed in this milestone.

## Deliberate limits and next milestone

No terrain, maps, anchors, physical NPC population, compiler, pack installation,
sign-in dependency, or campaign save format is introduced. There is no draft-list
UI or stored partial-run recovery yet: completed drafts persist, while stage
checkpoints for a failed/cancelled run are currently session-local. Do not claim
that an interrupted application resumes partial provider work after restart.

The next generation milestone must define a deterministic compiler and install
transaction through the existing pack/save/boot boundaries. Only then can an
accepted private draft become a playable campaign. P02's authoritative clock
and P03's physical residents remain separate milestones.
