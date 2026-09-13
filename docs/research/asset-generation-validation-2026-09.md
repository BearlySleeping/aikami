# Asset generation pack — delivery validation (2026-09-13)

Prepared against Aikami main `813d056fe0949573aa360a44c7a349b10f2d7b00`, reviewed 13 September 2026. Imported into the repository later the same day: contracts were renumbered to C-517–C-524 (C-516 is the combat direct-control contract), the C-512/C-513 integration addendum was merged into C-513, and the standalone execution prompts were folded into the contracts and `docs/research/asset-generation-review-2026-09.md`.

## Checked for this deliverable

- Read the complete repository tree and relevant source/contracts through GitHub; checked current branches and open/recent PRs.
- Confirmed C-510/C-511 source, the audio prompt precedence defect, format mismatch, disabled ComfyUI LoRA capabilities, missing recipe postprocessing, provenance loss at registration and filesystem-only v1 audio retrieval. C-512 was absent at the reviewed commit but has since shipped in PR #341 (see the review's import reconciliation).
- Read current primary provider documentation/model cards and the PixelLab OpenAPI. External access limitations are recorded in the recommendations. No gated weights or paid generation requests were made.
- Parsed the asset brief and its proposed JSON Schema. A local validator checked every validation keyword used in this specific schema (types, required fields, closed objects, enum/anyOf, string patterns, bounds and array lengths). This was not a general-purpose JSON Schema implementation or a TypeBox runtime test.
- Checked unique job/reference IDs, dependency acyclicity, map/NPC identity references, preparation/provider references, audio/image shapes, candidate limits and budget defaults.
- Confirmed **42 items: 6 slice + 36 expansion; maximum 84 candidates**. One audio candidate per audio item requests 489.3 seconds total; two candidates double that requested duration. These are input budgets, not measured output duration or generation time.
- Checked eight new draft contract IDs C-517–C-524, matching contracts and balanced Markdown fences.

## Not executed here

- Repository unit/integration/guard/TypeBox tests, builds or migrations.
- Live GPU image/music/SFX generation or hardware benchmarks.
- Browser pairing, Hub/client Studio E2E, game navigation, native-scale animation or audio listening tests.
- Actual pack import, asset acceptance, public publication or PR creation.

The JSON brief uses a proposed production format implemented by C-519. It is deliberately not described as accepted by today's CLI, Studio or pack importer. References have null hashes until actual bytes are resolved. Runtime cue IDs/profile names marked proposed are implementation inputs, not claims of existing engine support.

## Execution evidence still required

The implementing agent must run each contract's ACs and keep unexecuted checks marked unverified. C-523 must demonstrate exact accepted bytes in the five-map offline Emberwatch journey. Ending bindings require verified authoritative story state; asset generation cannot substitute for story correctness. C-513 needs direct pending-blob privacy tests and verified intended-use rights before community publication.
