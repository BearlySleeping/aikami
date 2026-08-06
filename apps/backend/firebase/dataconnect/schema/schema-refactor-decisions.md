# schema-refactor-decisions.md

Companion to `schema.gql` — documents every breaking change, every new enum /
relation / auth policy, and every item deliberately left open for a human.
This pass touched **only** `schema.gql` and this file (no Firestore rules, no
repository code, no SDK regeneration, no deployment).

Directive syntax was verified against the current Firebase SQL Connect
documentation (April 2026): the directives reference
(`/docs/reference/sql-connect/gql/directive`), the schema design guide
(`/docs/sql-connect/schemas-guide`), and the authorization guide
(`/docs/sql-connect/authorization-and-security`).

---

## 1. Open items — `# NEEDS DECISION` / `# TODO` (triage first)

All items below also appear at the top of `schema.gql`. Each is a decision a
human must make before this schema is trusted for new work; none was silently
resolved.

| ID | Where | Question |
|----|-------|----------|
| **ND-1** | `Notification.type` | Enum values. The draft hinted `"chat_message" \| "system"` (→ `CHAT_MESSAGE`, `SYSTEM`), but `packages/shared/schemas/src/lib/database/notification.ts` defines `NotificationTypeSchema = 'ctaClicked' \| 'videoViewed'` — a *different* notification model (marketing/analytics events), not in-app notifications. The enum currently uses the draft's own values; reconcile the two models or define the real in-app vocabulary. |
| **ND-2** | `Chat.npc` | Delete semantics. Made an **optional** `@ref` (→ `ON DELETE SET NULL`) so chat history survives NPC deletion — this matches current Firestore behavior (deleting an NPC does not cascade its chats; messages stay renderable via the denormalized `npcName`/`npcAvatarUrl`). But `ChatSchema.npcId` in TypeBox is **required**, which would imply `Npc!` + `ON DELETE CASCADE`. Decide: preserve chat history (current choice) or cascade chats+messages on NPC delete. |
| **ND-3** | `Config` | Table semantics. Draft models a generic key→value store (`key`/`value`), but Firestore `configs/{uid}` and TypeBox `ConfigSchema` model per-user settings (theme/locale/…). Pick one model — if per-user settings, the table needs a `uid` FK instead of `key`. |
| **ND-4** | `Persona` | Read policy. Firestore rules allow **fully public** reads (`allow read: if true`) and `Persona` has no `visibility` field. The intended product behavior may be visibility-gated like NPCs. Either accept public read or add a `visibility: Visibility!` column. |
| **ND-5** | `AudioTrack.mood` | Free-form `String`. No mood vocabulary is defined anywhere (`packages/shared/schemas/src/lib/media/music.ts` uses `String { minLength: 1 }`). Candidate enum once a mood list exists. |
| **ND-6** | `Npc.tags`, `Notification.data`, `Config.value` | No governing TypeBox schema exists for these `Any` columns (flagged `# TODO` inline). A human must define them before these fields are trustworthy. `Notification.data` note: the existing `NotificationSchema` governs a *different* payload shape. |

Secondary items (not blocking, recorded here so they are not lost):

- **Persona.owner is `User!`** while `PersonaSchema.uid` is Optional in TypeBox.
  FEATURES.md `PersonaData.uid` is required and Firestore create enforces the
  request uid, so the SQL schema treats it as required. TypeBox should be
  tightened to match.
- **`ListUsers` connector query** — updated to `@auth(level: USER)` and the
  `email` selection removed (only `id` is returned now). Note: the generated
  SDK is stale until `firebase:generate` runs — the connector pass must
  regenerate it and check for consumers of the removed `email` field.
- **Npc field name mismatch:** Firestore uses `creatorUid`; the SQL column is
  `uid` (preserved from the draft). The sync layer maps between them — no
  schema change needed, but be aware when writing filters.
- **`User.role` vs claims naming:** the SQL field is `role` (kept from the
  draft); the Firebase custom claim and TypeBox use `userRole`. Admin checks
  in CEL must use `auth.token.userRole == 'superAdmin'`. The `role` column
  only ever stores the enum spellings `MEMBER`/`SUPER_ADMIN` — the sync layer
  maps claim values; `auth.token.userRole` is never written to the column.
- **`Config` auth ambiguity:** Firestore's `configs/{uid}` is owner-only, but a
  generic KV store may need different rules. Tied to ND-3.

---

## 2. Breaking changes (downstream code must adapt)

| Table | Field | Draft → New | Impact |
| all (except AudioTrack) | `createdAt`, `updatedAt` | `Date` (nullable) → `Timestamp! @default(expr: "request.time")` | Wire format changes from `YYYY-MM-DD` (Date scalar) to RFC 3339 (Timestamp scalar); columns become `NOT NULL` — inserts that passed `null` now fail; the app no longer needs to pass these (server-set), and `updatedAt` on update must be set via `updatedAt_expr: "request.time"`. |
| `Message` | `chatOwnerUid`, `chatVisibility` | **removed** | These were Firestore security-rule denormalizations (O(1) rule evaluation without a parent-chat `get()`). SQL Connect enforces the same policy by joining through `Message.chat`, so they are redundant. Any SQL-side writer that sets them must stop. Firestore rules may keep using them Firestore-side (out of scope). |
| `Message` | `sender` | `String` → `Sender!` enum | Generated SDK type changes from `string` to enum; inserts without a valid `user`/`ai` value now fail. |
| `Message` | `editedBy` | `String` → `Sender` enum | Same, nullable. |
| `Message` | `text` | nullable → `String!` | Inserts with missing/`null` text now fail (TypeBox already requires `text`). |
| `Message` | `chatId` | scalar only | + `chat: Chat! @ref(...)` relation field. The `chatId` scalar **remains** (column `chat_id` unchanged), so existing filters keep working; queries can now also traverse `chat { … }`. |
| `Chat` | `uid` | scalar only | + `owner: User! @ref(...)` relation. `uid` scalar remains (column `uid` unchanged). |
| `Chat` | `npcId` | scalar only | + `npc: Npc @ref(...)` optional relation (see ND-2). `npcId` scalar remains (column `npc_id` unchanged). |
| `Chat` | `visibility` | `String` → `Visibility!` enum (default `PRIVATE`) | Enum type; value must be `private`/`public` (GraphQL: `PRIVATE`/`PUBLIC`). |
| `Chat` | `messageCount`, `affection` | nullable → `Int! @default(value: 0)` | Inserts without them now default to 0 instead of accepting `null`. |
| `Chat` | `lastMessageAt` | `Date` → `Timestamp`, now `@default(expr: "request.time")` | Retype (was nullable, no default). The default ensures newly created chats always have a sortable value in the `uid`/`lastMessageAt` ordering index; explicit last-message updates still overwrite it. |
| `Npc` | `uid` | scalar only | + `owner: User @ref(...)` optional relation. `uid` scalar remains (column `uid` unchanged). |
| `Npc` | `visibility` | `String` → `Visibility!` enum (default `PRIVATE`) | Enum type. |
| `Npc` | `name` | nullable → `String!` | Inserts with missing name fail (TypeBox already requires it). |
| `Persona` | `uid` | scalar only | + `owner: User! @ref(...)` relation, and `uid` becomes `String!` (was nullable). |
| `Persona` | `name` | nullable → `String!` | Inserts with missing name fail (TypeBox already requires it). |
| `Notification` | `uid` | scalar only | + `user: User! @ref(...)` relation. `uid` scalar remains (column `uid` unchanged). |
| `Notification` | `type` | `String` → `NotificationType!` enum | Enum type; values per ND-1. |
| `SaveSlot` | `uid` | scalar only | + `user: User! @ref(...)` relation. `uid` scalar remains (column `uid` unchanged). `SaveSlot` gains composite `@unique(uid, slotNumber)` — duplicates now rejected. |
| `User` | `role` | nullable `String` → `UserRole!` enum (default `MEMBER`) | Enum type; value must be `member`/`superAdmin` (GraphQL: `MEMBER`/`SUPER_ADMIN`). |
| `User` | `email` | nullable `String` | + `@unique` — duplicate emails now rejected (Postgres allows multiple NULLs, so absent emails stay legal). Uniqueness is case-insensitive in practice: the sync layer normalizes emails to lowercase before persistence. |
| `User` | `id` | plain PK | + `@default(expr: "auth.uid")` — server falls back to the request uid when id is omitted; Admin SDK writes must set `id` explicitly (auth.uid is null there). |
| `Config` | `key` | nullable `String` | + `@unique`, becomes `String!` — two rows with the same key now rejected; missing key rejected. |
| `AudioTrack` | all fields | — | Explicit `@col(name:)` added (column names unchanged: `id`, `title`, `mood`, `storage_url`). `mood` gains `@index`. |

No physical column was renamed — every `@col(name:)` and `@ref(fields:)`
preserves the draft's column names (`uid`, `npc_id`, `chat_id`, …), so the
DDL layout stays compatible with anything already deployed; the breaking
surface is the GraphQL/SDK type layer, not the SQL layout. **Before applying
the migration**, existing nullable data must be remediated: backfill
`Npc.name`, `Persona.name`, `Message.text`, `Message.chatId`, `Config.key`
and the `uid` FK columns (drop rows that cannot be backfilled), and validate
that every `uid` value references an existing `User.id` before the foreign
keys are enforced (delete or reassign orphans first). The same pass must
normalize `User.email` to lowercase so the case-insensitive uniqueness
contract holds from day one.

---

## 3. New enums

| Enum | GraphQL identifiers | Sync-layer source spelling (mapped by the sync layer) | Rationale |
|------|--------------------|-------------------------------------------------------|-----------|
| `Visibility` | `PRIVATE`, `PUBLIC` | `'private'`, `'public'` (`_visibilityUnion` TypeBox union) | Shared by `Npc.visibility` and `Chat.visibility`. Values map to Postgres enum; only append new values (enum order is meaningful). |
| `Sender` | `USER`, `AI` | `'user'`, `'ai'` (`_senderUnion` in `database/message.ts`) | `Message.sender` / `Message.editedBy`. |
| `UserRole` | `MEMBER`, `SUPER_ADMIN` | `'member'`, `'superAdmin'` (`UserRoleSchema` in `packages/shared/schemas/src/lib/auth/auth.ts` and the `userRole` custom claim) | `User.role`. The sync layer must map `'member'` → `MEMBER` and `'superAdmin'` → `SUPER_ADMIN`; `auth.token.userRole` is never written to the `role` column directly — reads/comparisons use the claim spelling, writes use the enum spelling. |
| `NotificationType` | `CHAT_MESSAGE`, `SYSTEM` | draft comment values (`"chat_message"`, `"system"`) — **see ND-1** | `Notification.type`; reconcile with the TypeBox model before trusting. |

---

## 4. New `@ref` relations

| Relation | Type | FK column (unchanged) | References | On delete | Rationale |
|----------|------|----------------------|------------|-----------|-----------|
| `Chat.owner` → `User` | required (`User!`) | `uid` | `User.id` | CASCADE | Every chat belongs to a user (Firestore create enforces the request uid); user deletion should clean up their chats. |
| `Chat.npc` → `Npc` | optional (`Npc`) | `npc_id` | `Npc.id` | SET NULL | **ND-2** — preserve chat history when an NPC template is deleted. |
| `Message.chat` → `Chat` | required (`Chat!`) | `chat_id` | `Chat.id` | CASCADE | Messages are a subcollection of chats in Firestore; deleting a chat deletes its messages. |
| `Npc.owner` → `User` | optional (`User`) | `uid` | `User.id` | SET NULL | Preset/system NPCs may have no creator (`creatorUid` optional in TypeBox). |
| `Persona.owner` → `User` | required (`User!`) | `uid` | `User.id` | CASCADE | FEATURES.md requires an owner; personas die with their user. |
| `Notification.user` → `User` | required (`User!`) | `uid` | `User.id` | CASCADE | Recipient is mandatory; notifications die with the user. |
| `SaveSlot.user` → `User` | required (`User!`) | `uid` | `User.id` | CASCADE | Save slots are per-user. |

Notes:

- Each relation keeps its existing scalar FK column as a declared field
  (`uid`, `npcId`, `chatId`), the documented SQL Connect pattern for explicit
  FK columns — so existing `where: { uid: { eq: … } }` filters in the
  connector keep compiling while the new relation field enables joins.
- `Message.regeneratedFrom` deliberately stays a bare `String` — see the field
  comment; it is an informational pointer, and a hard FK would cascade/block
  the independent deletion of regenerated messages.

---

## 5. Authorization

`@auth` cannot be declared on `@table` types in the current SQL Connect
dialect (directive is valid on `QUERY | MUTATION` only — verified in the
directives reference). Per-table policies are therefore documented in each
table's doc comment and must be enforced per-operation in
`connector/queries.gql` and `connector/mutations.gql` (a follow-up task).
Recommended shapes:

| Table | Recommended @auth per operation | Basis |
|-------|----------------------------------|-------|
| `User` | read: `@auth(level: USER)`; writes: `USER` + owner filter `id_expr: "auth.uid"` (admin via `auth.token.userRole == 'superAdmin'`) | rules: `users/{uid}` |
| `Npc` | public browse: `PUBLIC` + `where: {visibility: {eq: PUBLIC}}`; owner ops: `USER` + `uid_expr: "auth.uid"` | rules: `npcs/{npcId}` |
| `Persona` | read: `PUBLIC` (per rules); writes: `USER` + owner filter | rules: `personas/{personaId}` — **ND-4** |
| `Chat` | read: `PUBLIC` with `visibility == PUBLIC`, or `USER` + `uid_expr: "auth.uid"`; writes: `USER` + owner | rules: `chats/{chatId}` |
| `Message` | read/write: `USER` + chat-owner (join through `chat.uid`); public chats readable at `PUBLIC` when `chat.visibility == PUBLIC` | rules: `chats/{chatId}/messages/{messageId}` |
| `Notification` | `USER` + `uid_expr: "auth.uid"` (owner only) | rules: `users/{uid}/notifications` |
| `SaveSlot` | `USER` + `uid_expr: "auth.uid"` (owner only) | no Firestore rule; owner-only per architecture |
| `AudioTrack` | read: `PUBLIC` (catalog); write: `NO_ACCESS` (Admin SDK) | catalog table, C-151 |
| `Config` | **ND-3** first — Firestore `configs/{uid}` is owner-only, but this table has no `uid` column and no per-operation `@auth` can express an owner check; enforcement is not available until the ownership model is resolved | rules: `configs/{uid}` |

Most existing connector queries are `@auth(level: PUBLIC)`; `ListUsers` has
already been tightened to `USER` (and its `email` selection removed). Bringing
the rest in line with the table above is part of the connector follow-up.

---

## 6. `Any` (JSONB) columns — governing TypeBox schemas

| Column | Governing TypeBox schema | Status |
|--------|--------------------------|--------|
| `User.connectedEmails` | `UserSchema` in `packages/shared/schemas/src/lib/database/user.ts` (`connectedEmails: Optional(Array(String))`) | documented |
| `User.signInProviders` | `UserSchema` in `…/database/user.ts`; vocabulary from `SignInProviderSchema` in `…/lib/auth/auth.ts` (`'email' \| 'google' \| 'github'`) | documented |
| `Npc.stats` | `NpcSheetSchema` in `…/database/npc.ts` (extends `BaseCharacterSheetSchema` in `…/database/character.ts`) | documented |
| `Npc.tags` | — none exists | **ND-6** (`# TODO`) |
| `Persona.traits` | `PersonaSheetSchema` in `…/database/persona.ts` (extends `BaseCharacterSheetSchema`) | documented |
| `Chat.stats` | `ChatSchema.stats` in `…/database/chat.ts` (`{ hp?, ac?, level?, class?, abilities? }`) | documented |
| `Message.attachments` | `MessageSchema.attachments` in `…/database/message.ts` (`{ type: 'image'\|'file', url, name?, mimeType?, size? }[]`) | documented |
| `Message.metadata` | `MessageSchema.metadata` in `…/database/message.ts` (`Record<string, Unknown>`) | documented |
| `Notification.data` | — `NotificationSchema` in `…/database/notification.ts` models a *different* payload | **ND-6** (`# TODO`) |
| `Config.value` | — `ConfigSchema` in `…/database/config.ts` models a fixed per-user settings object, not arbitrary KV | **ND-6** (`# TODO`) |

---

## 7. Other deliberate decisions

- **ID strategy:** all tables keep `String!` ids (migration-bridged from
  Firestore document ids; `User.id` = Firebase Auth uid) except `AudioTrack`
  (`UUID! @default(expr: "uuidV4()")` — new catalog, no Firestore
  equivalent). Documented in the file header; no silent change.
- **Timestamps:** `@default(expr: "request.time")` verified as the current
  documented server-set timestamp pattern (`Timestamp! @default(expr:
  "request.time")`). Retyped `Date` → `Timestamp` because Postgres `date`
  truncates time-of-day, which loses message/chat ordering precision.
- **Denormalized display fields kept (documented):** `Chat.npcName` /
  `Chat.npcAvatarUrl` remain — chat-list/header rendering without a join, and
  renderable after NPC deletion (see ND-2). Both carry doc comments; the sync
  layer must refresh them on NPC metadata change.
- **Denormalized security fields dropped:** `Message.chatOwnerUid` /
  `Message.chatVisibility` (see breaking changes) — Postgres joins replace the
  Firestore O(1)-rule hack.
- **Indexes added** (beyond `@unique`): `Chat(uid, lastMessageAt)` for the
  owner chat list ordered newest-first; `Message(chatId, createdAt)` for
  per-chat history; `Notification(uid)`; `AudioTrack(mood)` for
  `GetTracksByMood`. `SaveSlot` uses its composite `@unique(uid, slotNumber)`
  as the index (a unique constraint already builds one). No index on
  `Npc.visibility` yet — add when public NPC browsing needs it.

## 8. Explicitly out of scope (per task)

- Firestore collections, security rules, backend/frontend repository code.
- New business entities or fields (group chats, lorebooks, relationships,
  worlds, memories — FEATURES.md #2–10 tables are future work, not invented
  here).
- `bun moon run firebase:generate`, deploys, migrations, or anything touching
  a live Cloud SQL instance.
- Connector operation rewrites (`connector/*.gql` — only the `ListUsers` PII
  fix was applied up front; the rest is the next pass): update `@auth` levels
  per section 5, run `firebase:generate` to refresh the stale SDK (the
  `ListUsers` change removed `email` from its result type), and re-check the
  generated SDK for consumers of the removed field.
