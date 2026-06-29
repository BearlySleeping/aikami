<!-- completed: 2026-06-29 -->
# Contract: C-151 AI Dynamic Music via Data Connect

## Goal
Implement the "AI Director" by extending the LLM structured output to control scene music. Create a Firebase Data Connect schema for audio tracks, allowing the Svelte UI to dynamically query and crossfade BGM based on narrative moods dictated by the AI during combat.

## Tech Stack
- **Framework:** Svelte 5, TypeBox
- **Database:** Firebase Data Connect (PostgreSQL)
- **Engine:** Svelte `AudioService`

---

## Task 1: Data Connect Schema & Queries

**File:** `apps/backend/firebase/dataconnect/schema/schema.gql`

Define a new table for audio tracks:

```graphql
type AudioTrack @table {
  id: UUID! @default(expr: "uuidV4()")
  title: String!
  mood: String! # e.g., 'epic', 'tense', 'triumph', 'sorrow'
  storageUrl: String!
}
```

**File:** `apps/backend/firebase/dataconnect/connector/queries.gql`

Add a query to fetch tracks by mood:

```graphql
query GetTracksByMood($mood: String!) @auth(level: PUBLIC) {
  audioTracks(where: { mood: { eq: $mood } }, limit: 10) {
    id
    title
    storageUrl
  }
}
```

> **Note:** Run `moon generate dataconnect` (or the equivalent local command) to regenerate the TypeScript SDK.

## Task 2: Extend AI Combat Schema

**File:** `apps/frontend/client/src/lib/game/core/ai/prompts/combat_action_schema.ts`

Add a new optional field to `CombatActionSchema`:

- `sceneMood: Type.Optional(Type.String({ description: "If the narrative drastically shifts mood, suggest a new musical mood (e.g., 'epic', 'tense', 'triumph', 'sorrow'). Otherwise leave undefined." }))`

## Task 3: AI Orchestration in ViewModel

**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`

1. Inject the generated Data Connect SDK (or your Rpc/Database wrapper).
2. In `executeCustomAction()`, after the LLM structure is extracted:
   - If `sceneMood` is defined, call `GetTracksByMood({ mood: sceneMood })`.
   - If tracks are returned, select one (e.g., `Math.random()`) and pass its `storageUrl` to `AudioService.transitionToBgm(url, 2000)`.

## Task 4: Mock Data Integration

**File:** `packages/shared/mocks/src/lib/mock_database_service.ts` (or equivalent mock file)

Ensure your development environment doesn't break if Firebase isn't running locally. Implement a mock Rpc/Query handler for `GetTracksByMood` that returns hardcoded URLs pointing to the placeholder tracks created in C-150 (e.g., returning `/assets/audio/bgm_combat.webm` for the `'epic'` mood).

## Task 5: Unit & E2E Testing

**File:** `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts`

Write a test mocking an LLM response with `sceneMood: 'triumph'`. Assert that the database query is fired and `AudioService.transitionToBgm` is called.

**File:** `apps/e2e/tests/client/combat_immersion.spec.ts`

Update the test to verify that typing a heroic action triggers the BGM track change.

## Acceptance Criteria

- [ ] `AudioTrack` table exists in Data Connect schema and queries compile successfully.
- [ ] The LLM structure definition includes `sceneMood`.
- [ ] The `CombatViewModel` queries Data Connect and triggers the `AudioService` crossfade upon receiving a mood change.
- [ ] Sandbox/Dev environments gracefully handle mock audio tracks.
- [ ] Unit tests pass cleanly.
