# Architecture Overview

This document provides a high-level overview of the technical architecture of the Aikami project.

## Guiding Principles

-   **Hybrid Scalability:** The architecture spans a cloud-hosted backend for persistence/multiplayer and local, containerized microservices for heavy AI workloads, balancing latency and server costs.
-   **Maintainability:** Managed as a Bun monorepo orchestrated by Moon, cleanly separating the game engine, SvelteKit application, shared schemas, and backend microservices.
-   **Performance:** The game client leverages WebGL/WebGPU via PixiJS v8 and Data-Oriented Design via bitECS to maintain 60FPS while rendering AI-driven entities.

## System Components

The Aikami ecosystem is composed of three primary layers: the Frontend Client, the Cloud Backend, and the Local AI Microservices.

### 1. Frontend Client (PWA & Desktop)

-   **SvelteKit 2 & Tauri v2:** The primary interface is a Progressive Web App that can also be compiled as a native desktop application using Tauri v2. It handles UI overlays, AI chat components, and character management using Svelte 5 runes (`ViewModel` patterns).
-   **Game Engine (PixiJS v8 + bitECS):** Embedded directly inside the SvelteKit client (`packages/frontend/engine`). It eschews standard monolithic game engines (like our legacy Godot implementations) in favor of a lightweight, ECS-driven 2D web engine.
-   **Static Sites (Astro):** The public landing page (`apps/frontend/site`) and documentation (`apps/frontend/docs`) are built with Astro for maximum performance and SEO.

### 2. Local AI Microservices (Docker/Tmux)

To handle computationally heavy generative AI locally (especially for desktop users), Aikami orchestrates several Dockerized microservices via Tmux scripts during development and runtime:
-   **Image Generation (`apps/backend/image`):** Runs a headless ComfyUI API (`yanwk/comfyui-boot:cu130-slim-v2`) for generating character avatars, environments, and combat assets.
-   **Text Generation (`apps/backend/text`):** Runs Ollama (`ollama/ollama`) exposing port 11434 to serve local LLMs for NPC dialogue and logic execution.
-   **Voice Synthesis (`apps/backend/voice`):** Runs a headless Kokoro TTS engine (`hwdsl2/kokoro-server`), which can also be utilized as a native binary directly within the client for ultra-low latency voice lines.

### 3. Cloud Backend Services

-   **Firebase Data Connect:** Utilizes modern GraphQL-based data pipelines (`apps/backend/firebase/dataconnect/schema/schema.gql`) to manage structured data in Postgres/Firestore natively.
-   **Firebase Functions & Auth:** Serverless endpoints acting as authoritative logic checks and user authentication handlers.
-   **Firestack Ecosystem:** Interaction with the Firebase emulator, database, and functions is managed efficiently via the custom `@aikami/firestack` package to enforce clean repository boundaries.

## Monorepo & Tooling

-   **Bun & Moon:** The monorepo heavily relies on Bun for blistering fast installations and script executions. Moon dictates task dependencies (e.g., ensuring `packages/shared/schemas` builds before the frontend engine).
-   **Validation:** Biome is the sole linter and formatter, replacing Prettier and ESLint for uniform code syntax. Playwright acts as the E2E blackbox testing framework.
