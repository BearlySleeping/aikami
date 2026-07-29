# Aikami — Index

> This file is the index. Work items live in GitHub Issues + Project board.
> Strategy, reference, and hygiene content lives in `docs/`.

## Active backlog

All pending work is tracked as **GitHub Issues** on the [Project board](https://github.com/orgs/BearlySleeping/projects/2). Every issue links back to its contract in `docs/contracts/` when work begins.

- **Kanban board:** https://github.com/orgs/BearlySleeping/projects/2
- **Issues:** https://github.com/BearlySleeping/aikami/issues?q=is%3Aopen+label%3Afeature
- **Completed contracts:** `docs/contracts/C-*.md`

## Contract pipeline

```bash
# Interactive drafting (default)
bun run contract

# Freeze from a GitHub Issue
bun run contract --issue 54
bun run contract --issue https://github.com/BearlySleeping/aikami/issues/54
```

## Docs reference

| File | What |
|------|------|
| [`docs/strategy/vision-and-directives.md`](strategy/vision-and-directives.md) | Product strategy, executive assessment, non-negotiable architecture directives |
| [`docs/strategy/deferred.md`](strategy/deferred.md) | Explicitly deferred features and scope boundaries |
| [`docs/reference/completed-contracts.md`](reference/completed-contracts.md) | Audit trail of C-312 through C-345 |
| [`docs/reference/design-rationale.md`](reference/design-rationale.md) | TTRPG architecture principles |
| [`docs/reference/project-review.md`](reference/project-review.md) | Competitive analysis — Adopt vs Avoid |
| [`docs/reference/definition-of-done.md`](reference/definition-of-done.md) | Contract quality gates |
| [`docs/engineering-hygiene.md`](engineering-hygiene.md) | Ongoing maintenance items |
| [`docs/backlog-format.md`](backlog-format.md) | How to write a contract-ready backlog item |
