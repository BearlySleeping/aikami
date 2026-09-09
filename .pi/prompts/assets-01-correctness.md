---
description: "PR 1: stable LPC identities and bounded shipped-asset fixes (manual workflow)"
---
Implement visual asset foundation **PR 1**, not the entire roadmap.

Read repository-root files:
- `docs/plans/visual_asset_foundation.md` — follow its common execution protocol.
- `docs/contracts/C-504-stable-character-appearance-identity.md`.

Require maintainer approval of the specification before implementation. If it is still draft without explicit approval, stop and request approval; do not self-approve it. Use an isolated worktree and preserve unrelated edits. Do not launch the contract pipeline.

## Scope

1. Implement all C-504 ACs: verified legacy snapshot → named identities, explicit unknown-provenance handling, idempotent persistence and validator/runtime parity. Existing named persona recipes remain supported.
2. Fix Hub LPC tag reconstruction by reusing the shared builder; test nested IDs and state tags.
3. Normalize missing equipment layer roles before merging. Test omitted role, explicit front and distinct rear/front passes using production-shaped inputs.
4. Fix atlas source alpha/extrusion and lossless encoding without moving/renaming frames or changing GIDs. Unpainted prop/decor regions are transparent; terrain is opaque. No global chroma deletion.
5. Remove only proven Emberwatch duplicate ground/decor data after checking which semantic/baked path is active. Preserve collision, transitions and placement identity.

## Gates

Capture baseline first. Test the real inn/shop NPC identities before/after reload and offline; verify affected props over grass/dirt/indoor flooring. Include migration failure/retry and unknown-save cases. Follow the guide's affected validation and production visual requirements.

Target 30–55 changed paths; reassess at 75, stop at 85. Do not add generic formats, procedural generation, shaders, new slots or unrelated cleanup. If a small fix actually needs a later contract, report that boundary rather than implementing a competing solution.

End with C-504 AC evidence, direct-fix results, commands/exits, artifact paths, total changed paths and unresolved issues. No commit, push, PR, publication or deployment without explicit authorization. Request a fresh `/assets-verify 1` session before PR review.
