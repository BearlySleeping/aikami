---
name: git-workflow
description: Git conventions, commit standards, branch naming, and PR guidelines for the Aikami project.
version: 1.0.0
author: Aikami Team
tags: ["git", "commits", "branching", "pull-requests", "workflow"]
---

# Git Workflow

Git conventions for the Aikami project.

---

## Commit Messages

Use **conventional commits**:

```
<type>(<scope>): <subject>
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code refactoring |
| `docs` | Documentation changes |
| `style` | Formatting, no code change |
| `test` | Adding/updating tests |
| `chore` | Maintenance, deps, build |
| `perf` | Performance improvement |
| `ci` | CI configuration changes |

### Examples

```
feat(auth): add OAuth2 login support
fix(chat): resolve message ordering issue
refactor(character): extract import logic to service
docs(readme): update installation instructions
test(validation): add schema tests for character
```

---

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/<description>` | `feature/user-authentication` |
| Fix | `fix/<description>` | `fix/login-redirect-loop` |
| Refactor | `refactor/<description>` | `refactor/service-layer` |
| Hotfix | `hotfix/<description>` | `hotfix/security-vulnerability` |
| Release | `release/<version>` | `release/v1.2.0` |

---

## Branch Strategy

1. Create a branch from `main`
2. Make commits following conventional format
3. Push and create a PR
4. Get review and approval
5. Squash merge to main

---

## Pull Requests

### Title

Use same format as commit messages:

```
feat(auth): add OAuth2 login support
```

### Description

Include:
- Summary of changes
- Testing done
- Screenshots (if UI changes)
- Related issues

### Checklist

- [ ] Code follows project standards
- [ ] Tests pass
- [ ] Lint/format fixed
- [ ] Typecheck passes
- [ ] Documentation updated (if needed)

---

## Working with Commits

### Amending

Only amend commits that:
- Were created by you in this session
- Have NOT been pushed to remote

```bash
# Amend last commit (if conditions met)
git commit --amend
```

### Safe Operations

- NEVER force push to `main`/`master`
- NEVER skip hooks (`--no-verify`, `--no-gpg-sign`)
- NEVER update git config

---

## Common Commands

```bash
# Check status
git status

# Create and switch to feature branch
git checkout -b feature/my-feature

# Add changes
git add -A

# Commit with message
git commit -m "feat(auth): add login"

# Push to remote
git push -u origin feature/my-feature

# Fetch latest
git fetch origin

# Rebase on main
git rebase main

# Stash changes
git stash save "work in progress"
```

---

## RTK Integration

Use RTK for compact output:

```bash
rtk git status          # Compact status
rtk git log            # Compact log
rtk git diff            # Compact diff
rtk git add             # Ultra-compact confirmations
rtk git commit          # Ultra-compact confirmations
rtk git push            # Ultra-compact confirmations
```
