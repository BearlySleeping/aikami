# Definition of Done

> Quality gates that every contract must pass before being marked completed.

## Definition of Done for Every Future Contract

A contract may be marked completed only when all applicable conditions hold:

1. Production path is reachable without a dev route.
2. Domain state has one authoritative owner and a versioned schema at boundaries.
3. Offline/degraded behavior is specified and tested — "offline" means no
   network (local AI engine), never zero AI capability.
4. Required functional E2E and visual suite files declared by the contract exist.
5. Tests exercise behavior, not only component rendering or sandbox boot.
6. Accessibility, keyboard/focus, loading, empty, error, retry, and cancellation
   states are handled.
7. Save migration and idempotency are covered for persistent mutations.
8. AI output is validated, cost/cancellation behavior is bounded, and mechanics
   have deterministic fallback for AI failure — not a player-facing toggle to
   disable AI.
9. Any new or modified AI call site goes through `AiProviderGateway` (C-320);
   no direct provider SDK/fetch call is introduced outside the gateway's own
   adapters.
10. Any new or modified persistent campaign/save/chat data goes through the
    Turso repository layer (C-321); no new IndexedDB or Firestore write path
    is introduced for campaign-runtime truth.
11. `validate()` passes for affected projects; no critical test is skipped.
12. Execution Report records actual files, results, deviations, and follow-ups.
13. Promotion matrix advances only after independent production evidence:
    `sandbox → integrated → release_verified`.
14. User-facing docs and the canonical backlog are updated in the same change.
