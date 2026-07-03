# C-216: Documentation and Architecture Overhaul

## Context
Our documentation has fallen severely out of sync with the actual codebase. The root `README.md` currently mentions Godot, which we've moved away from in favor of our custom PixiJS v8 + bitECS engine. It also lists unused packages and apps.

We need a comprehensive sweep of our documentation and `.context` files to ensure they accurately describe the platform's current architecture: SvelteKit 2 (PWA), PixiJS v8 + bitECS (Engine), Firebase Data Connect (Backend), and Dockerized AI Microservices (ComfyUI / Kokoro / Local LLMs).

## Objectives
1. Rewrite the root `README.md` to reflect the actual tech stack and project structure.
2. Consolidate and update the architecture documentation.
3. Update `.context/CONTEXT.md` so future AI agents have an accurate map of the system.

## Acceptance Criteria

- **Root README Rewrite**:
    - Remove all references to Godot.
    - Update the "Architecture" ASCII diagram to reflect the SvelteKit / PixiJS / Firebase / Local Docker AI relationship.
    - Update the "Project Structure" table to only include active, in-use directories. Mention the roles of `apps/backend/image`, `apps/backend/text`, and `apps/backend/voice` as Dockerized local services.
    - Keep it concise, punchy, and developer-focused.
- **Architecture Docs Consolidation**:
    - Audit `docs/architecture/architecture.md` and `docs/guides/ARCHITECTURE.md`. If they overlap, consolidate them into `docs/architecture/architecture.md` and delete the redundant file.
    - Ensure the new architecture document explicitly outlines the strict boundary between the SvelteKit UI/Services and the `packages/frontend/engine` package.
- **Context Updates**:
    - Update `.context/CONTEXT.md` to reflect the finalized naming conventions (`Character` -> `Persona` / `NPC`) established in C-215.
    - Remove any outdated legacy references in the AI briefing.
- **Cleanup**:
    - Run `moon run validate` to ensure no markdown links were broken during the consolidation.

## Technical Notes
- Do not write a novel. Use bullet points, bold text for key terms, and code blocks for directory structures. The goal is scannability for both humans and AI agents.
- For the ASCII diagram in the README, keep it simple. Something like:
    
    [ SvelteKit PWA ] <--> [ PixiJS + bitECS Engine ]
            |                        |
            v                        v
    [ Firebase Backend ]    [ Local Docker AI (ComfyUI/Kokoro) ]
