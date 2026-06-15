## Metadata

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Source**           | Aikami per-project `moon.yml` and `tsconfig.json` patterns                              |
| **Target**           | All packages and apps in aikami                                                         |
| **Priority**         | P1 — Standardization pass after all structural changes                                  |
| **Dependencies**     | C-005 (packages/shared), C-006 (frontend configs), C-007 (scripts), C-008 (.moon setup) |
| **Status**           | **completed**                                                                             |
| **Contract version** | 1.0.0                                                                                   |

## Overview

Standardize every project's `moon.yml` and `tsconfig.json` to follow the aikami pattern. After restructuring packages (C-005) and adding the .moon templates (C-008), each project needs updated configs that reference the correct inherited tasks and package paths.

## Design Reference

**Aikami `moon.yml` pattern** (library):

```yaml
$schema: "https://moonrepo.dev/schemas/project.json"

language: "typescript"
layer: "library"
stack: "shared" # or 'backend', 'frontend'
tags: ["utils", "shared", "library"]

project:
    name: "utils"
    description: "Shared utility functions."
    channel: "#general"
    owner: "Core Team"

dependsOn:
    - "constants"
    - "types"

# No explicit tasks — inherits from task templates
```

**Aikami `tsconfig.json` pattern** (shared library):

```json
{
	"$schema": "https://json.schemastore.org/tsconfig",
	"display": "Utils",
	"extends": "../../../config/tsconfig/tsconfig.base.json",
	"compilerOptions": {
		"rootDir": "../..",
		"outDir": "dist",
		"paths": {
			"@aikami/constants": ["../constants/src/index.ts"],
			"@aikami/types": ["../types/src/index.ts"],
			"$logger": ["../logger/src/index.ts"]
		}
	},
	"include": ["src/**/*"],
	"exclude": ["node_modules", "dist"]
}
```

**Aikami `moon.yml` pattern** (application):

```yaml
$schema: "https://moonrepo.dev/schemas/project.json"

language: "typescript"
layer: "application"
stack: "frontend" # or 'backend'
tags: ["client", "frontend", "application"]

project:
    name: "client"
    description: "Aikami PWA."
    channel: "#frontend"
    owner: "Frontend Team"

dependsOn:
    - "frontend-components"
    - "frontend-services"

# Tasks reference task template
template: "vite-application"
```

## Changes Per Project

### All Library Projects (packages/shared/_, packages/backend/_, packages/frontend/\*)

1. **moon.yml**:
    - Add `stack` field (shared/backend/frontend)
    - Clean up explicit task definitions — let task template handle them
    - Ensure `dependsOn` lists correct project IDs from workspace.yml
    - Add `toolchains: javascript: false` (use Bun)
2. **tsconfig.json**:
    - Use `"rootDir": "../.."` consistently (build from package group root)
    - Update path aliases to reflect new locations (post C-005)
    - Ensure all cross-package dependencies are in `paths`

### App Projects (apps/frontend/_, apps/backend/_)

1. **moon.yml**:
    - Add `stack` and proper tags
    - Add `template` reference to task template
    - Add `dependsOn` for all required library packages
2. **tsconfig.json**:
    - Update path aliases to `packages/shared/`, `packages/backend/`, `packages/frontend/`

## Project Grid

| Project ID              | Path                             | stack    | layer       | template           |
| ----------------------- | -------------------------------- | -------- | ----------- | ------------------ |
| `constants`             | `packages/shared/constants`      | shared   | library     | typescript-library |
| `logger`                | `packages/shared/logger`         | shared   | library     | typescript-library |
| `mocks`                 | `packages/shared/mocks`          | shared   | library     | typescript-library |
| `schemas`               | `packages/shared/schemas`        | shared   | library     | typescript-library |
| `types`                 | `packages/shared/types`          | shared   | library     | typescript-library |
| `utils`                 | `packages/shared/utils`          | shared   | library     | typescript-library |
| `backend-configs`       | `packages/backend/configs`       | backend  | library     | typescript-library |
| `backend-utils`         | `packages/backend/utils`         | backend  | library     | typescript-library |
| `backend-database`      | `packages/backend/database`      | backend  | library     | typescript-library |
| `backend-auth`          | `packages/backend/auth`          | backend  | library     | typescript-library |
| `backend-svelte-kit`    | `packages/backend/svelte-kit`    | backend  | library     | typescript-library |
| `frontend-configs`      | `packages/frontend/configs`      | frontend | library     | typescript-library |
| `frontend-services`     | `packages/frontend/services`     | frontend | library     | typescript-library |
| `frontend-utils`        | `packages/frontend/utils`        | frontend | library     | typescript-library |
| `frontend-repositories` | `packages/frontend/repositories` | frontend | library     | typescript-library |
| `frontend-components`   | `packages/frontend/components`   | frontend | library     | typescript-library |
| `client`                   | `apps/frontend/client`              | frontend | application | vite-application   |
| `landing-page`          | `apps/frontend/landing_page`     | frontend | application | vite-application   |
| `docs`                  | `apps/frontend/docs`             | frontend | application | vite-application   |
| `gamejs`                | `apps/frontend/gamejs`           | frontend | application | vite-application   |
| `functions`             | `apps/backend/functions`         | backend  | application | firebase-functions |
| `scripts`               | `scripts`                        | —        | application | — (custom tasks)   |

## Acceptance Criteria

### AC-1: All moon.yml Files Standardized

**Given** each project has a moon.yml
**When** standardization is complete
**Then** every moon.yml has `stack`, consistent tags, `dependsOn`, and no redundant explicit task definitions

**Test Hooks**:

- Unit: `grep -L 'stack:' packages/*/*/moon.yml apps/*/*/moon.yml` returns no results
- Unit: `bun moon sync` succeeds
- Unit: `bun moon run :typecheck` passes for all projects

### AC-2: All tsconfig.json Files Updated

**Given** packages were restructured (C-005)
**When** tsconfig paths are updated
**Then** all cross-package type resolution works correctly

**Test Hooks**:

- Unit: `bun run typecheck` passes at monorepo level
- Unit: `grep -r 'packages/constants' packages/shared/*/tsconfig.json` shows `../constants` (relative, not root-relative)

### AC-3: Root tsconfig.json References All Projects

**Given** all projects exist
**When** the root tsconfig.json is updated
**Then** it contains a `references` entry for every project

**Test Hooks**:

- Unit: Count of references in `tsconfig.json` equals count of projects in `.moon/workspace.yml` (minus root)
- Unit: `bunx tsc --build` succeeds

### AC-4: package.json Scripts Consistent

**Given** each project has a package.json
**When** scripts are standardized
**Then** every package has `typecheck`, `lint`, `format`, `fix`, `test` scripts (where applicable)

**Test Hooks**:

- Unit: Each package.json has `"typecheck": "tsgo --noEmit"` or equivalent
- Unit: Each package.json has biome lint/format scripts

## Implementation Notes

1. **Work through the grid systematically**: Start with shared packages (no deps), then backend, then frontend, then apps
2. **dependsOn uses project IDs**: References are to the IDs in workspace.yml (e.g., `constants`, not `packages/shared/constants`)
3. **Explicit tasks**: Only keep explicit tasks if they deviate from the template (e.g., custom build steps, deployment tasks)
4. **rootDir**: All libraries use `"rootDir": "../.."` (relative to package group: shared, backend, frontend). This means source maps / output are relative to the group root
5. **Backend utils deprecation**: Consider merging `packages/backend/utils` into `packages/shared/utils` if the utils are truly shared — keep separate only if they have Firebase-specific code that shouldn't be in shared
6. **Stack values**: `shared`, `backend`, `frontend` — used by moon for task inheritance and grouping

## Edge Cases & Gotchas

- **gamejs**: This is a non-SvelteKit app — may need custom task definitions, not vite-application template
- **docs app**: Verify it uses Vite/SvelteKit — if using a different framework, adjust template
- **backend-ai removal**: If C-005 removed `packages/backend/ai`, ensure no references remain in any config
- **Cross-package circular deps**: Verify no circular dependencies exist after restructuring (moon will warn)
