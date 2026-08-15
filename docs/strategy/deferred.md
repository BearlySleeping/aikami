# Explicitly Deferred / Not MVP

> Extracted from `docs/TODO.md`. These are intentionally prevented from displacing the playable demo.

## Explicitly Deferred / Not MVP

These are not deleted ideas; they are intentionally prevented from displacing
Phase 1:

- default generated-world wizard and "one big strict JSON" onboarding;
- custom agents, prompt-template ordering, raw schema/JSON editors;
- Spotify/YouTube playback and external OAuth integrations;
- automatic per-turn image/video/storyboard generation;
- autonomous messages and full weekly NPC schedule editor;
- connected OOC chats, public character marketplace, and bulk import UI;
- full D&D 5e rules fidelity, arbitrary PDF mechanics, and dynamic generated UI;
- co-op, procedural maps, shared worlds, and mobile-native release;
- PowerSync/TanStack DB adoption without a measured Phase 4 sync requirement
  (Turso's own embedded-replica sync is the default, see C-357);
- Aikami-hosted "no setup required" pay-per-use service mode — the
  `AiProviderGateway`'s `service` adapter interface exists from C-320, but
  billing is Phase 5 work, not Phase 1.
  🔴 **Under revision (C-413):** the Cloud Run cold-start optimization (model
  weights in Storage instead of the Docker image) and GCP Model Garden
  evaluation named here are recommended for **rejection**, not scheduling —
  Cloud Run GPU cold starts (20–30 s) sit directly in the player's first
  dialogue turn, and self-hosted inference only wins at sustained high
  utilization. The recommendation is that `service` mode be a thin metered
  proxy over frontier APIs. See
  `docs/strategy/mvp-assessment-2026-08-16.md` §2.4;
- Data Connect migration for NPC/chat/items — Turso is the campaign-runtime
  source of truth (C-321); Data Connect is revisited only if a genuine
  dashboard/reporting/admin use case emerges;
- creator.aikami.com content-authoring web app (tilemap/item/NPC/quest editor,
  mod upload) — tracked as a future evolution of C-358, not a Phase 1 concern.

**No longer deferred — now disallowed:** a campaign with zero text AI
capability was previously an accepted "offline demo" product mode (old C-318).
It is not merely deprioritized; it is removed as a supported state by C-323.
Authored fallback text is a resilience behavior for AI failure, not a menu
option a player can choose instead of AI.

---
