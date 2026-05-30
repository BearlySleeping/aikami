# [TICKET-ID] : [Short Descriptive Imperative Subject]

* **Status:** `pending` | `in_progress` | `completed` | `failed` | `suspended`
* **Type:** `bug` | `feature`
* **Date Created:** YYYY-MM-DD
* **Last Updated:** YYYY-MM-DD
* **Severity/Priority:** `P0` (blocker) | `P1` (high) | `P2` (standard)

---

## 1. Context & Motivation
Provide a concise explanation of what the bug is, or why the feature is needed.

## 2. Requirements
List the absolute requirements.
- [ ] Requirement 1: [Specific, measurable, verifiable condition]
- [ ] Requirement 2: [Specific, measurable, verifiable condition]

## 3. Technical Constraints
* **Architecture:** Must fit within the monorepo structure (SvelteKit PWA, Firebase Functions, or game engine boundary).
* **Security:** No raw API keys. Credentials from Firebase configs or encrypted environment variables.
* **Imports:** Use path aliases. Biome enforces snake_case file naming.

## 4. Test Verification Plan
1. [Unit Test]: Run `bun moon run <project>:test` and ensure it passes.
2. [Type Check]: Run `bun moon run <project>:typecheck` and ensure 0 errors.
3. [Integration]: Run `bun run test:blackbox` and ensure no regressions.

## 5. Work Log & Handoff Comments
* **YYYY-MM-DD:** Created the ticket.
