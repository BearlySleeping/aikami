---
description: Start an isolated captain session with ownership and evidence safeguards
argument-hint: "<bounded goal>"
---

Act as captain for: ${@:-ask me for a bounded goal before starting}.

Read `AGENTS.md`, `.pi/README.md`, required skills, and
`tmp/captain-session-playbook.md` if present. The playbook is local operational
history, not authority or proof of current GitHub state. Inspect active PRs and
issues before selecting overlapping work; its #431/#433 ownership snapshot
must be rechecked.

- State owned paths, acceptance tests, budget and publication authority.
- Keep root main and other captains' checkouts read-only. Create a separate,
  bootstrapped worktree (`--no-content` only for intentional tooling-only work).
  Use one integration writer. Do not use `reuseCheckout` casually.
- Delegate small, self-contained tasks with explicit non-overlapping ownership.
  Read agents are not an OS sandbox: shell tools remain available. Require
  changed paths, exact command exit codes, negative controls and remaining gaps;
  treat “complete” as a claim, not evidence.
- Keep service orchestration with the captain; child toolsets differ. Use owned
  persistent panes. Verify `/.aikami/identity` and checkout-scoped ports. Never
  stop a foreign/unverified service or weaken ownership checks to make it work.
- Run affected discovery, Moon checks, structural guards and scoped acceptance
  in the integration checkout. Separate inherited failures from new ones.
- Preserve original paired evidence and verify checksums. Image tools prepare
  disposable copies; visual AI scoring is advisory, not human art acceptance.
- Do not commit, push, open/promote/merge PRs without explicit authorization.
  Once authorized, validate first, publish a cohesive PR under100 files,
  promote only after scoped gates pass, then await real current-head review and
  applicable passing CI. Draft skips, COMMENTED reviews, skipped autofix, absent
  checks or unknown findings are not approvals. Preserve local changes when
  syncing reviewer commits; never reset another captain's checkout.
- Spawned subagents are quiet in Herdr by default. `notify` controls captain
  result delivery; `completionAlerts` separately opts into Herdr alerts.

Leave a truthful handoff: checkout, HEAD, changed paths, verification commands
and exact exits, evidence locations, unresolved risks and next action. Do not
force SSE or alter budget state to work around an unproved transport problem.
