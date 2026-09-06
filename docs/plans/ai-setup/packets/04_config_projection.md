# P04 — repair legacy projections through the existing C-463 mutators

Model: `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`.
Dependencies: P02 accepted. Restore C-463's projection guarantee; no new persisted schema.
Read [dispatch rules](../dispatch.md). May run beside P03 only with disjoint source/test ownership.

## Baseline evidence

`apps/frontend/client/src/lib/services/config/config_service.svelte.ts` keeps `state.connections`,
`state.defaultByCapability` and `state.defaultConnectionId` as pure projections of the canonical
C-463 model, rebuilt by the private `_reproject()`.

The legacy wrappers (`addConnection`, `updateConnection`, `deleteConnection`, `duplicateConnection`,
`setDefaultConnection`) each call `_reproject()` on their way out. The canonical mutators —
`addProvider`, `updateProvider`, `deleteProvider`, `addAiConnection`, `updateAiConnection`,
`deleteAiConnection`, `setRoleAssignment`, `clearRoleAssignment` — did not. Anything written through
the canonical API therefore stayed invisible to every consumer reading the projection until an
unrelated legacy call happened to reproject, or the app reloaded.

This matters because the settings ViewModel calls the canonical mutators directly
(`configService.updateAiConnection`, `configService.deleteAiConnection`, `configService.addProvider`),
while `ai_gateway_service` and `capability_view_model` read the projection.

Confirm both premises against the approved baseline before editing.

## Allowed scope

- `config_service.svelte.ts` mutator bodies and `config_service.test.ts`.
- No change to `_reproject()`'s own logic, the persisted schema, or the migration.
- P03 owns AI-settings presentation. Do not edit its view/ViewModel files here.

## Acceptance

1. Add, edit and delete through the canonical API are visible to legacy-projection consumers
   before any reload.
2. A role change (`setRoleAssignment` / `clearRoleAssignment`) reprojects `isDefault`,
   `defaultByCapability` and `defaultConnectionId` together.
3. `updateProvider` propagates a rotated credential to every sibling connection's projection —
   one account, one edit.
4. `deleteProvider` removes its connections from the projection and leaves no orphan role.
5. Reprojecting twice is idempotent, and the existing no-op guard still suppresses a redundant
   `connections` write so `capability_view_model`'s `$effect` is not woken on a no-op.
6. No new persistence, no new public API, no change to load/migration behavior.

## Watch points

`_reproject()` is O(connections x providers) and now runs on every canonical mutation; keep the
existing unchanged-projection guard intact rather than adding a cache.
The legacy wrappers still reproject at the end of their own composite operations — an inner
mutator reprojecting first is harmless because the sequence is synchronous, but do not remove the
outer call to "deduplicate" it: the composite steps between them change the result.

## Evidence

- ViewModel-free service tests: add/edit/delete, role set/clear, credential rotation across
  siblings, provider deletion, and a gateway `detect()` that sees a canonically-added connection
  with no reload.
- Run the current registered client test task plus affected validation.
- Report per-file diff totals including tests.

## Stop and handoff

Use the dispatch handoff format. Do not commit, publish or merge without instruction.
