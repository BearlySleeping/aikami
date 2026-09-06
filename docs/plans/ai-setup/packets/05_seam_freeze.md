# P05 — C-481 capability/provider/identity seam and typed API freeze

Model: `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`.
Dependencies: P03 and P04 accepted on `main`; C-481 approved; the one OpenAI
architecture/migration critique of C-481 recorded and its seam accepted once.
Read [dispatch rules](../dispatch.md) and [C-481](../../contracts/C-481-ai-configuration-convergence.md).
Parallel: R01's downloader lane may run beside this. Lane A owns every shared export named below.

## Goal

Freeze the typed seams the rest of C-481 and C-482 build against — schemas, capability/provider
definitions, stable identity and the storage/restore interface — **without activating v3 writes**.

C-481's split rule is explicit: *"P05 adds tested schema/API seams without activating v3"* and
*"P05 must freeze storage/restore seams, including PIN/key handling and crash/retry behavior,
before P06 activates writes."* A seam that persists a v3 payload in this packet is out of scope,
not ahead of schedule.

## Baseline evidence

`packages/shared/schemas/src/lib/domain/providers_config.ts` defines `AiProviderSchema`,
`AiConnectionSchema`, `RoleAssignmentsSchema`, `VaultPayloadV2Schema` (`schemaVersion: 2`) and the
v1 shapes. There is no v3 schema and no `routing` shape.

`packages/shared/constants/src/lib/providers.ts` exposes `TEXT_PROVIDERS`, `VOICE_PROVIDERS` and
`IMAGE_PROVIDERS` as flat registries. Capability rules, required URL/key rules and locality are
re-derived in `ai_settings_view_model.svelte.ts` and `connection_verifier.ts` (`LOCAL_PROVIDERS`,
`OLLAMA_NATIVE`, `OPENAI_COMPAT`) rather than read from one definition.

`config_service.svelte.ts` resolves accounts by first registry-ID match in places
(`_findProviderByRegistry`), which C-481 forbids: *"Select/reuse an account by stable `providerId`,
never the first registry-ID match."*

Confirm all three premises against the approved baseline before editing. P04 already repaired the
projection refresh; do not redo it here.

## Allowed scope

- `packages/shared/schemas/src/lib/domain/providers_config.ts` — add the v3 payload and `routing`
  schemas alongside v1/v2. Existing schemas keep their exported names.
- `packages/shared/types/src/lib/domain/` — the inferred types for the above.
- `packages/shared/constants/src/lib/providers.ts` — the capability/provider definition shape and
  its typed accessors.
- A new client-side storage/restore seam module plus its tests.
- Focused tests for every export added.

Explicitly **not** in this packet: `config_service.load()` / `save()` behavior changes, any write of
`schemaVersion: 3`, migration transformations (P06), setup/verification operations (P07), consumer
routing (P08), and every C-482 installer/runtime concern.

## Acceptance

1. A v3 schema exists and validates `schemaVersion: 3`, `providers`, canonical `connections`,
   `routing` and preserved user options/presets. Nothing writes it yet; v2 remains the live format
   and `config_service` still loads and saves v2 exactly as before.
2. `routing: { defaults, overrides }` is expressed in the schema with sparse capability defaults and
   sparse role overrides, where an absent override inherits, a connection ID pins and `null`
   explicitly disables. The three states are distinguishable in the type, not by convention.
3. Connection params are discriminated by capability in the schema itself — not a capability enum
   next to an unconstrained params union. A text connection cannot validate with image params.
4. Provider identity is stable and typed: an account is selected by `providerId`, credential rotation
   preserves that ID, and two instances sharing a registry ID remain distinct. Any helper that
   resolves an account by first registry-ID match is either removed or marked deprecated with its
   replacement in place.
5. Capability/provider definitions are declarative and single-source: locality, required URL/key
   rules, supported capabilities and protocol/model-discovery support are read from the definition.
   A definition advertising an operation without schema and adapter support is a test failure —
   registry tests distinguish usable definitions from label-only stubs.
6. An unsupported operation returns typed unavailability. It never defaults to text, and `voice`
   remains the existing TTS key. STT/music/ambience/video stay unsupported design cases.
7. The storage/restore seam is frozen as a typed interface: read/decrypt without rewriting storage,
   a genuinely absent vault distinguished from wrong-PIN / corrupt / unknown-version, PIN and key
   handling, snapshot-before-rewrite, and crash/retry semantics. The interface is exercised by tests
   with a fake adapter; no live vault rewrite happens in this packet.
8. Typed failures distinguish not-configured, unsupported, invalid config, auth, transport/timeout,
   cancelled, stale result, locked/corrupt/unsupported-version vault and persistence
   conflict/failure. Redaction happens before logging or building a user-visible error.
9. `main` still works: the client builds, existing config/capability/settings/gateway tests pass,
   and no consumer behavior changes.

## Watch points

This is the packet most likely to grow past its budget. The seam is a **public API freeze**, so
prefer fewer, well-named exports over a broad surface — every export added here is one P06–P08 and
C-482 must build against, and `dispatch.md` makes Lane A the owner of shared exports.

Do not introduce a speculative framework, a new persistence system, or a capability registry that
C-481 assigns to later packets. Keep wire schemas/types/constants in shared packages and vault/config
orchestration in client services; no app imports from shared packages.

C-481 exposes only optional C-482 runtime references and capability seams here — not installation
inventories, jobs or process control. If R01 needs a seam that is not yet frozen, transfer ownership
or serialize; do not let two lanes edit the same export.

Feature support, reachability, selected-model compatibility and last successful generation are four
distinct facts. The seam must keep them distinguishable — P03 established this in presentation and
the type must not collapse it again.

## Evidence

- Schema tests: valid/invalid v3 payloads, the three routing states, capability-discriminated params
  rejecting a mismatched shape, and v1/v2 schemas still validating their existing fixtures.
- Registry/identity tests: stable `providerId` across a credential rotation, two instances with one
  registry ID staying distinct, and every advertised operation backed by schema and adapter.
- Storage-seam tests against a fake adapter: absent vs. locked vs. corrupt vs. unknown-version, and
  crash/retry leaving the original intact.
- Run the current registered client and shared-package test tasks plus affected validation; record
  exact baseline and new failures rather than historical counts.
- Report per-file additions+deletions including new files; target <=80 per file, stop at >=100.

## Stop and handoff

Return the dispatch handoff with the frozen seam listed export by export — that list is what P06,
P07, P08 and R02 build against, and it is the packet's real deliverable.
Stop before commit, PR, merge and before P06. Release the shared-export lock explicitly.
If freezing the storage/restore seam and the schema/definition work together exceed the file gate,
propose two ordered slices — schema/definitions first, storage/restore second — before editing.
