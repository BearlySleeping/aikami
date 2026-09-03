---
id: C-464
title: "Account section — cloud sync, sign-out, and account deletion"
source: "Settings teardown review, 2026-09-03 (§6 'Account earns its own tab'). Follows C-463 and PRs #233–#238. C-463 is the highest claimed ID; C-464 is the next free one."
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04"
---

# Contract C-464: Account section — cloud sync, sign-out, and account deletion

## Metadata

| Field | Value |
|---|---|
| **Source** | Settings teardown review, 2026-09-03 |
| **Target** | `apps/frontend/hub/src/lib/server/api/` — the deletion endpoint; `packages/backend/database/` — the ownership-transfer migration; `apps/frontend/client/src/lib/views/settings/account/` and `.../data/` — the two sections |
| **Type** | full |
| **Priority** | P1 — the settings shell (#238) has a `data` group with one section in it and no account surface at all, while every piece of plumbing it needs already exists unused |
| **Dependencies** | C-426 (Cloudflare identity), C-463 (config model), PR #238 (settings groups) |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | user-facing → a "Your account and your data" page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the client has no account surface whatsoever. The only auth UI
  is `lib/views/auth/login`. A signed-in player cannot see that they are signed in,
  cannot sign out from the app, cannot see whether their saves are backed up, and
  cannot delete their account.

- **Reproduction**: sign in with Google, then open Settings. Nothing anywhere
  references the session.

- **Existing implementation to reuse** — nearly all of it is written and unused:
  - `authService` (`lib/services/auth/auth_service.svelte.ts`) already has
    `signOut()`, `socialSignIn()`, `registerUser()`, `sendPasswordResetEmail()` and
    `completeDeviceHandoff()`.
  - `gameStateSyncService` (`lib/services/game_state_sync.svelte.ts`) already has
    `saveGame` / `loadGame` / `listSlots` / `deleteSlot`, all tested, **with zero UI
    callers**.
  - `apps/frontend/hub/src/lib/server/api/save_backup.ts` is the model for a new
    endpoint: session-verified, D1 via drizzle, R2 through `env.SAVES_BUCKET`. Its
    per-backup delete (R2 object first, then the metadata row) is the ordering to
    follow.
  - Paraglide already carries translated `delete_account`, `cloud_sync`,
    `cloud_sync_description`, `account_information` and `manage_your_account`
    messages that nothing renders.
  - The settings registry gained `group` and `contexts` in #238; adding a section is
    a registry entry plus a component.

- **Known gaps**:
  - `deleteAccount` exists only as a word in a comment header in
    `packages/backend/auth/src/index.ts`. There is no route, no client method.
  - The `data` group currently holds one section (`export`). Offline mode and
    telemetry still live inside `ai_privacy`, where they are about AI rather than
    about data.

- **Baseline tests**: `apps/frontend/hub/src/lib/server/api/tests/` (save-backup
  suite), `lib/services/__tests__/game_state_sync.test.ts`. Client unit baseline is
  **1845 pass / 31 fail**; those 31 are pre-existing and unrelated (InventoryService,
  GmPromptService, ImageViewModel, GameCanvasViewModel, EndSessionViewModel).

## User Outcome

After this contract, a player can see whether they are signed in and whether their
saves are backed up, back up and restore on demand, sign out knowing their campaigns
stay on the device, and delete their cloud account — understanding exactly what that
does and does not remove.

## Success Measures

- **Time/latency target**: the Account section renders from cached session state with
  no blocking network call. Backup and restore show progress; deletion completes or
  reports a specific failure.
- **Offline/degraded behavior**: with no network the section renders, states that
  sync is unavailable, and offers no action that would fail silently. **The game must
  still boot and play** — nothing here becomes a boot dependency.
- **Production journey enabled**: the full cloud lifecycle — sign in, back up, restore
  on a second device, leave.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Session, sign-in, sign-out | `auth_service.svelte.ts` | reuse — add only `deleteAccount()` |
| Backup / restore / slot list | `game_state_sync.svelte.ts` | reuse unchanged; give it a UI |
| Worker API module pattern | `api/save_backup.ts` | reuse as the template for the new route |
| D1 access | `packages/backend/database` drizzle schema | modify — add the tombstone owner |
| R2 saves bucket | `env.SAVES_BUCKET` | reuse |
| Settings registry | `settings_sections.ts` (#238) | modify — add `account`, move two toggles |
| Device handoff | `/link`, `completeDeviceHandoff()` | reuse — surface the sessions |

## Overview

Add an **Account** group to Settings holding identity, sync status, sign-out and
account deletion; move offline mode and telemetry out of AI & Privacy into **Data**.
Build the deletion path end to end — a session-verified Worker route that erases D1
rows and R2 objects, and anonymises published packs rather than destroying them.

## Design Reference

- Follow `save_backup.ts` exactly for the endpoint: `setXEnv()` injection from
  `routes/api/[...slugs]/+server.ts`, session verification on every request, drizzle
  for D1, the binding for R2.
- Follow the settings-section convention established in #238: a registry entry, a
  `*_view.svelte` and a `*_view_model.svelte.ts` under
  `lib/views/settings/<section>/`.
- Follow the destructive-action pattern the review asked for: type-to-confirm, not a
  plain dialog.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Deletion is **server-authoritative**. The client calls one endpoint and renders the
  result; it never orchestrates a multi-step erasure, because a client that dies
  mid-sequence leaves an account half-deleted.
- The endpoint is **idempotent and resumable**. Deleting an already-deleted account
  succeeds. A crash part-way leaves a state the next call completes.
- Erasure order is **R2 first, D1 last**. The `account_backups` rows are the only
  record of which R2 keys belong to a user, and the user delete cascades them away —
  destroying the index before the blobs orphans them permanently.
- Schemas in `packages/shared/schemas/`, types in `packages/shared/types/`. No schema
  under `apps/**`.

## State & Data Models

No new client persistent state. Server-side:

```ts
/**
 * The tombstone owner. Published packs are transferred here on deletion
 * rather than removed — see Migration & Rollback.
 */
const DELETED_OWNER_ACCOUNT_ID = 'deleted-user';

/** Response shape of DELETE /api/account. */
type AccountDeletionResult = {
  /** Objects removed from SAVES_BUCKET. */
  readonly blobsDeleted: number;
  /** Backup metadata rows removed. */
  readonly backupsDeleted: number;
  /** Packs transferred to the tombstone owner. */
  readonly packsTransferred: number;
};
```

## Quality Requirements

- **Offline/degraded mode**: every action is disabled with a stated reason when
  `navigator.onLine` is false. `voice_model_service`'s download guard is the
  precedent.
- **Accessibility/input**: the delete flow is keyboard-completable; the confirm field
  is labelled; focus moves to the dialog and returns on close. The section works at
  the same tab semantics #238 established.
- **Performance budget**: no blocking call on section mount.
- **Security/privacy**: every route verifies the session and derives the user id
  **from the session, never from the request body** — a body-supplied id is an
  account-deletion vulnerability. Deletion is rate-limited. No email, id or R2 key is
  logged; log counts only.
- **Persistence/migration**: adds a tombstone user row. See below.
- **Cancellation/retry/idempotency**: deletion is idempotent; backup and restore are
  cancellable and safe to retry.
- **Observability**: one structured log per deletion with the three counts and no
  identifiers.

## Migration & Rollback

- **Old data compatibility**: no existing client state changes.

Deletion is **immediate**, with no grace period or undelete (OQ-2, decided), and
published packs are **transferred, not destroyed** (OQ-1, decided).

- **Migration**: a drizzle migration inserts the `DELETED_OWNER_ACCOUNT_ID` user row
  (no email, display name "Deleted user"). It must be present before the endpoint
  ships, or the first deletion by a pack author fails the FK.

- **Rollback**: the endpoint can be removed without a data migration. The tombstone
  row is inert if unused. Packs already transferred **cannot** be reattached — the
  original owner id is gone by design. Say so in the PR.

- **Feature flag or kill switch**: none. Deletion either works correctly or is not
  shipped.

- **Failure recovery**: R2 deletes are batched and retried; the D1 transaction runs
  only after the last blob is confirmed gone. A failure between phases leaves the
  account intact with fewer blobs, and the next call finishes the job. **Never** leave
  a user row deleted with blobs remaining — that is unrecoverable, since the keys are
  gone with the rows.

## Scope Boundaries

- **In Scope:**
  - `DELETE /api/account` on the hub Worker, session-verified, idempotent.
  - `authService.deleteAccount()`.
  - The tombstone user and pack ownership transfer.
  - An **Account** settings section: identity, sync status (last backup, slot list,
    back up now, restore), linked devices with "sign out everywhere", sign out,
    delete account.
  - A dedicated **revoke-all-sessions endpoint** (OQ-3, decided) rather than deleting
    `sessions` rows directly — Better Auth owns session lifecycle and reaching around
    it invites drift.
  - Moving offline mode and telemetry from `ai_privacy` into the **Data** section,
    and adding "Delete local data" there.
  - A docs page explaining what each delete removes.

- **Out of Scope:**
  - **Anything in the `ai` group beyond removing the two moved toggles.** The AI
    section rebuild is a later contract; `ai_privacy` keeps its AI status block.
  - Data export as a download — `export` already exists and is untouched.
  - Account recovery, undelete, or a grace period.
  - Scrubbing PII from pack *content* (descriptions, asset metadata). Only ownership
    is anonymised. Note it in the docs page.
  - Email change, password change, or provider linking.
  - Anything under `src-tauri/`.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one contract. The endpoint and the section are a vertical slice
of a single outcome — a player leaving cleanly — and they share the invariant that
matters here: what "delete" means across two data planes. Shipping the endpoint alone
leaves a destructive capability with no way to invoke or verify it; shipping the
section alone leaves a button that cannot work. Per the repo rule, affected project
count is not a split signal.

## Acceptance Criteria

### AC-1: Signed-out state states the offline promise
**Given** no session
**When** Settings → Account is opened
**Then** it says campaigns, saves and chat history live on this device and the game is
fully playable without an account, offers Google and email sign-in, and shows no sync
controls.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Visual | `account_view_model.test.ts`; `suites/account.visual.ts` | `/settings?group=account` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: new `suites/account.visual.ts`, route `/settings?group=account`, criteria: "Score 90+: a signed-out account panel stating the game works without an account, with Google and email sign-in buttons and no sync or delete controls visible."

### AC-2: Sync status is visible and actionable
**Given** a signed-in user with two backup slots
**When** Account is opened
**Then** last-backup time and both slots are listed, and "Back up now" and "Restore"
call `gameStateSyncService` and reflect progress and failure.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `account_view_model.test.ts` | `/settings?group=account` | Filled during verification |

**Watch Points**:
- `listSlots` parses ids with `/^sync_slot_(\d+)$/` and orders lexicographically —
  slot 10 sorts before slot 2. Sort numerically in the ViewModel.

### AC-3: Deletion erases R2 objects and D1 rows
**Given** a signed-in user with three backups
**When** `DELETE /api/account` succeeds
**Then** no object remains under `saves/{uid}/`, the user row and every cascaded row
are gone, and the response reports the counts.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `hub/src/lib/server/api/tests/account_delete.test.ts` | N/A | Filled during verification |

**Watch Points**:
- Two writers use the bucket: `account_backups.r2Key` is
  `saves/{accountId}/{timestamp}-{filename}` and the client's sync service writes
  `saves/{uid}/slot_{n}.json`. **List by the `saves/{uid}/` prefix** rather than
  iterating metadata rows, or the client-written objects are missed.
- R2 list is paginated. Loop until the cursor is exhausted.

### AC-4: A pack author can be deleted
**Given** a user who owns a published pack
**When** their account is deleted
**Then** deletion succeeds, the pack keeps its slug, versions and visibility, and its
`owner_account_id` is the tombstone owner.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `account_delete.test.ts` | N/A | Filled during verification |

**Watch Points**:
- `packs.ownerAccountId` is `onDelete: 'restrict'` **deliberately** — the schema
  comment reads "catalog rows are moderated, never cascaded away". Without the
  transfer, deleting any pack author fails on the FK. This AC is the reason this is a
  contract and not a prompt.
- Transfer must happen inside the same D1 transaction as the user delete.

### AC-5: Deletion is idempotent and never half-completes
**Given** a deletion that fails after removing some blobs
**When** it is retried
**Then** it completes, and at no point does a deleted user row coexist with
undeleted blobs.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `account_delete.test.ts` | N/A | Filled during verification |

**Watch Points**:
- Write this one first. The failure it prevents — orphaned blobs whose key index has
  been cascaded away — is unrecoverable.
- Deleting an account that does not exist returns success, not 404.

### AC-6: The user id comes from the session
**Given** a request whose body names a different user id
**When** it reaches `DELETE /api/account`
**Then** the session's own account is the one deleted, or the request is rejected —
never the body's.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `account_delete.test.ts` | N/A | Filled during verification |

### AC-7: The two deletes are unambiguous about scope
**Given** the Account and Data sections
**When** either delete is opened
**Then** Account → Delete account names the cloud identity, community packs and
backups and states that on-device data is untouched; Data → Delete local data names
the device database and states the cloud account is untouched; both require
type-to-confirm.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + Visual | `account_view_model.test.ts`; `suites/account.visual.ts` | `/settings?group=data` | Filled during verification |

**Watch Points**:
- A player who conflates these loses a campaign. The copy is the feature.

### AC-8: Offline mode and telemetry move to Data
**Given** the settings registry
**When** Settings is opened
**Then** offline mode and telemetry appear under Data, `ai_privacy` retains only its
AI status block, and no setting is lost or duplicated.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit + E2E | `settings_view_model.test.ts`; `tests/client/settings.spec.ts` | `/settings?group=data` | Filled during verification |

**Watch Points**:
- Both toggles persist to `aikami_ai_privacy_settings` in localStorage. Keep the key
  or migrate it — silently renaming it resets both for every existing player.

### AC-9: No regression
**Given** the existing suites
**When** the gate runs
**Then** client unit is **1845+ pass / 31 fail** with the failing set unchanged, and
the type-safety guard baseline holds at T1=14 T2=4 T3=1.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit | `bun run fix && bun moon run :validate && bun run test` | N/A | Filled during verification |

### AC-10: Sign out everywhere goes through Better Auth
**Given** a signed-in user with sessions on two devices
**When** "Sign out everywhere" is used
**Then** both sessions are revoked through Better Auth's own session API rather than
by deleting `sessions` rows directly, and the other device's next request is
unauthenticated.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | Integration | `hub/src/lib/server/api/tests/account_sessions.test.ts` | `/settings?group=account` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`
- Integration: assert via Better Auth's session lookup, not a raw D1 count — the
  point of the decision is that the table is not the contract.

**Watch Points**:
- Revoking every session includes the caller's own. Decide and state whether the
  current device stays signed in; the copy must match whichever it is.
- `deviceCodes.userId` is nullable, so an in-flight handoff has no session to revoke
  and must not error the batch.

## Implementation Sequence

1. **Phase 1 (Schema)**: tombstone user migration in `packages/backend/database`.
2. **Phase 2 (Endpoints, test-first)**: AC-5 and AC-6 before the happy path, then
   AC-3 and AC-4. `DELETE /api/account` and the revoke-all route (AC-10), both
   modelled on `save_backup.ts`.
3. **Phase 3 (Client service)**: `authService.deleteAccount()`.
4. **Phase 4 (Sections)**: Account section, then the Data moves.
5. **Phase 5 (Docs + validation)**: the docs page, then the full gate.

## Edge Cases & Gotchas

- **Deleting yourself while signed in on another device**: sessions cascade, so the
  other device's next request 401s. Acceptable, but the copy should say the account is
  signed out everywhere.
- **The tombstone user must never be signable-into**: no email, no credential row.
- **`deviceCodes.userId` is nullable** — an in-flight device handoff may carry a null
  user id and must not break the cascade.
- **Restore overwrites the local database.** It needs its own confirmation; it is
  destructive to on-device data even though it lives under a benign heading.
- **The R2 prefix is user-controlled only through the uid.** Never build the prefix
  from a request value; derive it from the session id.

## Resolved Decisions

All three open questions were resolved by the author on 2026-09-04; the contract is
`approved`. Recorded rather than deleted, because each shaped a scope boundary above.

1. **Published packs transfer to a tombstone owner.** Other players may have installed
   a pack, so destroying shared content to satisfy one erasure punishes everyone else;
   npm and crates.io both anonymise rather than unpublish. Refusal would also trap a
   user who cannot leave without first hunting down their own packs. See AC-4 and the
   tombstone migration.
2. **Deletion is immediate.** No grace period, no undelete — those need a scheduler, a
   restore path and a second set of states, and this batch of work exists to stop
   shipping half-wired features.
3. **"Sign out everywhere" gets its own endpoint** through Better Auth's session API
   rather than deleting `sessions` rows. See AC-10.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
