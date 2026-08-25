---
id: C-383
title: "Data Exposure Hardening: close public reads on user-owned data"
source: "external data-layer review (docs/research/database-architecture-recommendation.md §1)"
status: completed
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-12"
completed_at: "2026-08-12"
---

# Contract C-383: Data Exposure Hardening

## Metadata

| Field | Value |
|---|---|
| **Source** | External data-layer review — `docs/research/database-architecture-recommendation.md` §1. Architecture: `docs/architecture/data-layer-target-architecture.md` (I-2). |
| **Target** | `apps/backend/firebase/src/rules/firestore.rules`, `apps/backend/firebase/src/rules/storage.rules`, `apps/backend/firebase/dataconnect/connector/queries.gql`, and the corresponding suites in `apps/backend/firebase/tests/` |
| **Priority** | P0 — `personas` and `users` are readable by callers who do not own them, in production, today. Personas are the user's self-characterization in a companion product. |
| **Dependencies** | None. Ships independently of every other contract in the sequence. |
| **Status** | completed |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**:
  1. `firestore.rules` → `match /personas/{personaId} { allow read: if true; }`. A wildcard-document read permits **collection list queries**, so any anonymous caller can enumerate every persona created by every user.
  2. `firestore.rules` → `match /users/{uid} { allow read: if isAuthenticated(); }`. Any signed-in user can read any other user's profile document, including `email`. The Data Connect connector already removed `email` from `ListUsers` for exactly this reason — the Firestore side was never brought in line.
  3. `storage.rules` → `match /npcs/{npcId}/{allPaths=**} { allow write: if isAuthenticated() && isValidImageType() && isValidFileSize(); }`. No owner check — any signed-in user can overwrite any NPC's avatar. The same path is `allow read: if true`, so the overwritten asset is served to everyone. `match /public/{allPaths=**}` has the same shape.
  4. `dataconnect/connector/queries.gql` → six operations carry `@auth(level: PUBLIC)`, including the **mutation** `UpsertSaveSlot`. An unauthenticated caller could upsert a save slot for any uid with an attacker-chosen `storageRef`, and `ListSaveSlots` (also `PUBLIC`) enumerates targets. Not currently exploitable because `firestack.config.ts:21` excludes Data Connect from non-emulator modes — the mitigation is a config flag, not a control.
- **Reproduction**:
  1. With the emulator running and **no** authenticated session, issue a Firestore list query against `personas`. All documents are returned.
  2. Signed in as user A, read `users/{uid_of_B}`. The document including `email` is returned.
  3. Signed in as user A, upload an image to `npcs/{any_npc_id}/neutral.webp`. The write succeeds.
- **Existing implementation to reuse**: `firestore.rules` already defines `isOwner`, `isDocumentOwner`, `isRequestOwner`, `isAdmin`, `isPublicDocument`. The `npcs` collection block is the correct pattern and needs no change — copy its shape. `storage.rules` already defines `isOwner`.
- **Known gaps**: There is no `visibility` field on `Persona` in any schema, so visibility-gated reads are not implementable in this contract. Owner-only is the correct default; a public-persona feature can add `visibility` later.
- **Baseline tests**: `bun moon run firebase:test-rules`. Must pass before starting. **Note that several existing test cases currently assert the vulnerable behavior** — see "Watch Points" under AC-1.

## User Outcome

After this contract, a **user** can be confident that their persona and profile
are readable only by themselves and admins, and a **developer** cannot
accidentally deploy a Data Connect connector that accepts unauthenticated
writes.

## Success Measures

- **Time/latency target**: N/A — rule evaluation only, no added `get()` calls, so no latency change.
- **Offline/degraded behavior**: N/A — no network behavior change.
- **Production journey enabled**: Closes a live data-exposure hole ahead of any user acquisition.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Owner predicate (Firestore) | `firestore.rules` → `isDocumentOwner(field)` | reuse |
| Owner predicate (Storage) | `storage.rules` → `isOwner(uid)` | reuse |
| Correct collection pattern | `firestore.rules` → `match /npcs/{npcId}` block | reuse as reference |
| Rules test harness | `apps/backend/firebase/tests/rules/*.rules.test.ts` | modify |
| Storage rules tests | `apps/backend/firebase/tests/storage-rules/storage.rules.test.ts` | modify |

## Overview

Three security rules currently grant reads or writes to callers who do not own
the data, and six Data Connect operations are marked `PUBLIC` including one
mutation. This contract tightens all of them to owner-scoped access and
inverts the test cases that currently assert the vulnerable behavior. It
touches security policy and tests only — no application code, no schema, no
data migration.

## Design Reference

Follow the existing `npcs` block in `firestore.rules` as the canonical shape
for an owner-scoped collection. Follow `match /saves/{uid}/{allPaths=**}` in
`storage.rules` as the canonical shape for an owner-scoped Storage path.
Architecture invariant I-2 in `docs/architecture/data-layer-target-architecture.md`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Security policy changes only. Do not modify application code, repositories,
  services, or schemas.
- Do not add a `visibility` field to `Persona`. Owner-only is the decision.
- Do not regenerate the Data Connect SDK. `@auth` directives are server-side
  policy and are not represented in the generated TypeScript.

## State & Data Models

No data model changes. For reference, the Storage path change in AC-3 requires
NPC avatar objects to live under an owner-scoped prefix:

```
before:  npcs/{npcId}/{file}
after:   npcs/{creatorUid}/{npcId}/{file}
```

Because the emulator reseeds NPC images on every run
(`apps/backend/firebase/scripts/on_emulate.ts` → `uploadNpcImages`), there is
no production data to migrate — see "Migration & Rollback".

## Quality Requirements

- **Offline/degraded mode**: N/A — rules are evaluated server-side; no client behavior change.
- **Accessibility/input**: N/A — no UI.
- **Performance budget**: No new `get()` calls in any rule. Rule evaluation stays O(1) on denormalized fields.
- **Security/privacy**: This is the entire contract. Every changed rule must deny by default and grant only to owner or admin.
- **Persistence/migration**: NPC avatar Storage paths change; see below.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: N/A — rule denials surface as client-side permission errors.

## Migration & Rollback

- **Old data compatibility**: The `npcs/{npcId}/…` Storage prefix is written only by the emulator seeding script and by admin uploads. No end-user data exists at that prefix (the product has no users). Existing emulator objects are recreated on the next `bun run emulate`.
- **Migration**: Update `uploadNpcImages` in `apps/backend/firebase/scripts/on_emulate.ts` so `destination` includes the creator uid. Re-run the emulator to reseed.
- **Rollback**: `git revert` the rules commit and redeploy rules — `bun moon run firebase:deploy`. Rules deploy independently of application code.
- **Feature flag or kill switch**: N/A — rules are not feature-flagged. Rollback is a redeploy of the previous rules file.
- **Failure recovery**: If a rules deploy breaks a client path, revert and redeploy; rules deploys are atomic and take seconds.

## Scope Boundaries

- **In Scope:**
  - `apps/backend/firebase/src/rules/firestore.rules` — `personas` read, `users` read.
  - `apps/backend/firebase/src/rules/storage.rules` — `npcs` write, `public` write.
  - `apps/backend/firebase/dataconnect/connector/queries.gql` — `@auth` levels only.
  - `apps/backend/firebase/scripts/on_emulate.ts` — NPC image destination path only.
  - The test suites covering the above.
- **Out of Scope:**
  - Deleting Data Connect (that is C-385). This contract only tightens its auth directives.
  - Any change to `chats`, `messages`, `configs`, `notifications`, `agent_definitions`, `stats` rules — they are already owner-scoped.
  - Any application code, repository, service, or Svelte component.
  - Adding a `visibility` field to any schema.
  - Regenerating any SDK or schema.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. All four ACs are the same class of change
(security policy tightening), share the same test harness, and must ship
together — shipping the Firestore fix while leaving the Storage fix would
leave a live hole. Partial completion is not useful.

## Acceptance Criteria

### AC-1: Personas are readable only by their owner and admins

**Given** persona document `p1` exists with `uid: "userA"`
**When** the document is read, or the `personas` collection is listed, by an unauthenticated caller or by `userB`
**Then** the read is denied; and when read by `userA` or by an admin, the read succeeds

Required rule shape:

```
match /personas/{personaId} {
  allow read: if isDocumentOwner('uid') || isAdmin();
  allow create: if isAuthenticated() && isRequestOwner('uid');
  allow update, delete: if isDocumentOwner('uid') || isAdmin();
}
```

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/backend/firebase/tests/rules/personas.rules.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run firebase:test-rules`
- Integration: N/A
- E2E / Visual: N/A — security rules have no rendered surface.

**Watch Points**:
- 🔴 **The existing test file asserts the vulnerability.** `personas.rules.test.ts` currently contains `test('can read public persona')` under both the `other authenticated user` and `unauthenticated` describe blocks. These tests will fail once the rule is fixed. **Invert them** — rename to `cannot read another persona` / `cannot read any persona` and assert denial. **DO NOT revert the rule to make the existing tests pass.** The tests encode the bug, not the requirement.
- The `creator can read own persona` and all `admin` cases must continue to pass unchanged.
- A `list` query is a distinct operation from a `get` in the rules emulator. Add an explicit denial test for listing the `personas` collection while unauthenticated — a `get`-only test will not catch a regression on list.

### AC-2: User profiles are readable only by their owner and admins

**Given** user document `users/userB` exists
**When** read by `userA` (authenticated, non-admin)
**Then** the read is denied; and when read by `userB` or an admin, it succeeds

Required rule shape:

```
match /users/{uid} {
  allow read: if isOwner(uid) || isAdmin();
  allow create: if isOwner(uid) || isAdmin();
  allow update, delete: if isOwner(uid) || isAdmin();
}
```

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/backend/firebase/tests/rules/users.rules.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run firebase:test-rules`

**Watch Points**:
- `users.rules.test.ts` currently has `test('can read another profile')` under `other authenticated user`. Invert it to assert denial.
- Before changing this rule, grep for client code that reads another user's profile: `grep -rn "userFirestoreRepository\|getUserData" apps packages --include=*.ts | grep -v node_modules`. If a display-name lookup for another user exists, it will break. If one is found, **stop and record it under Open Questions** rather than widening the rule — the correct fix is a denormalized public display-name field, which is out of scope here.

### AC-3: NPC and public Storage writes are owner-scoped

**Given** NPC avatar objects are stored under `npcs/{creatorUid}/{npcId}/{file}`
**When** `userA` attempts to write to `npcs/userB/npc1/neutral.webp`
**Then** the write is denied; and when `userB` (or an admin) writes there with a valid image under the size limit, it succeeds

Required rule shape:

```
match /npcs/{uid}/{allPaths=**} {
  allow read: if true;
  allow write: if (isOwner(uid) || isAdmin()) && isValidImageType() && isValidFileSize();
}
```

Apply the same owner-scoping to `match /public/{allPaths=**}` → `match /public/{uid}/{allPaths=**}`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/backend/firebase/tests/storage-rules/storage.rules.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run firebase:test-rules`
- Integration: `bun run emulate` in `apps/backend/firebase` must complete without upload errors, and NPC avatars must resolve in the client.

**Watch Points**:
- `uploadNpcImages` in `on_emulate.ts` builds `destination` as `npc/${npcDir.split('/').pop()}/${file}` — note it writes to **`npc/`** (singular) while the rule matches **`npcs/`** (plural). Verify which prefix is actually in use before changing the rule; if uploads currently land under `npc/`, they are hitting the default-deny catch-all and only succeed because the seeding script runs with Admin SDK credentials that bypass rules. Fix the path to `npcs/{creatorUid}/{npcId}/{file}` and keep rule and script in agreement.
- Public read on `npcs/**` stays `if true` — NPC avatars are genuinely public content. Only the **write** is being scoped.

### AC-4: No Data Connect operation grants unauthenticated access to user-owned data

**Given** `apps/backend/firebase/dataconnect/connector/queries.gql`
**When** the file is inspected
**Then** no operation touching user-owned data carries `@auth(level: PUBLIC)`

Required changes:

| Operation | Before | After |
|---|---|---|
| `ListSaveSlots` | `@auth(level: PUBLIC)` | `@auth(expr: "auth.uid == request.variables.uid")` |
| `UpsertSaveSlot` | `@auth(level: PUBLIC)` | `@auth(expr: "auth.uid == request.variables.uid")` |
| `ListPersonas` | `@auth(level: PUBLIC)` | `@auth(expr: "auth.uid == request.variables.uid")` |
| `GetPersona` | `@auth(level: PUBLIC)` | `@auth(expr: "auth.uid == request.variables.uid")` |
| `GetTracksByMood` | `@auth(level: PUBLIC)` | **unchanged** — a genuinely public catalog read |
| `ListUsers` | `@auth(level: USER)` | **unchanged** |

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/backend/firebase/tests/rules/dataconnect_auth.test.ts` (new) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run firebase:test-rules`
- Integration: The new test parses `connector/queries.gql` as text and asserts that the set of operations carrying `@auth(level: PUBLIC)` is exactly `["GetTracksByMood"]`. A static text assertion is sufficient and correct here — it is a policy guard, not a behavior test, and it will keep failing loudly if someone adds a `PUBLIC` operation later.

**Watch Points**:
- 🔴 Changing `ListPersonas` to owner-scoped **will break the hub's SSR persona page** (`apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts`), because the Firebase JS SDK running server-side has no authenticated user and cannot satisfy `auth.uid`. This is expected and acceptable: that page is already non-functional in production (Data Connect is excluded from non-emulator modes and the load function swallows the failure into an empty list), and C-385 deletes the page entirely. **Do not "fix" it by reverting the auth directive or by adding a service-account workaround.** If the emulator-mode hub personas page stops listing, that is a PASS for this AC, not a regression.
- Do not run `bun moon run firebase:generate`. `@auth` directives do not appear in the generated TypeScript SDK; regenerating adds churn and risks unrelated drift.
- `level` and `expr` cannot be combined in this dialect — use `expr` alone, matching the existing `CreatePersona` / `UpdatePersona` operations in the same file.

## Implementation Sequence

1. **Phase 1 (Rules)**: Edit `firestore.rules` (AC-1, AC-2) and `storage.rules` (AC-3). Do not touch any other block in either file.
2. **Phase 2 (Tests)**: Invert the vulnerable assertions in `personas.rules.test.ts` and `users.rules.test.ts`; add the list-denial case from AC-1; update `storage.rules.test.ts`; add `dataconnect_auth.test.ts`.
3. **Phase 3 (Seeding)**: Update `uploadNpcImages` destination in `on_emulate.ts` to the owner-scoped path (AC-3).
4. **Phase 4 (Connector)**: Edit `@auth` directives in `queries.gql` (AC-4). No regeneration.
5. **Phase 5 (Validation)**: `bun moon run firebase:test-rules`, then `bun run emulate` in `apps/backend/firebase` and confirm seeding completes with no upload errors.

## Edge Cases & Gotchas

- **`get` vs `list`**: The Firestore rules emulator treats these as separate operations. An `allow read` covers both, but a test that only exercises `get` will not prove that `list` is denied. Test both.
- **Admin SDK bypasses rules entirely**: `on_emulate.ts` runs with Admin credentials, so seeding will succeed even against a misconfigured rule. Never use "seeding worked" as evidence that a rule is correct — only the rules test suite is evidence.
- **`npc/` vs `npcs/` prefix mismatch**: documented in AC-3. Resolve it rather than working around it.
- **Reading another user's display name**: if any client surface needs it, AC-2 breaks it. Record it as an Open Question; do not widen the rule.

## Open Questions

Must be resolved before status becomes `approved`:

- Does any client surface read another user's `users/{uid}` document (e.g. to show a display name on shared content)? Run the grep in AC-2. If yes, that surface needs a denormalized public field and this contract must note it as a follow-up rather than widening the read rule.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
