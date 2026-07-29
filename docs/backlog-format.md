# Contract-Ready Backlog Format

> How to write a contract-ready backlog item.

## Contract-Ready Backlog Format

Every `### C-NNN` item below is one potential contract based on
`docs/contracts/TEMPLATE.md`.

- **Status** uses `not_started`, `in_progress`, `blocked`, or `completed`.
- **Priority** uses P0 (blocks playable demo), P1 (core product), or P2 (later).
- **Target** identifies the primary architectural surface, not a fixed file list.
- **Acceptance gate** is the seed for contract Given/When/Then criteria.
- Dependencies may reference completed contracts and pending items in this file.
- Generate one contract per item; do not bundle a whole category into one contract.

---
