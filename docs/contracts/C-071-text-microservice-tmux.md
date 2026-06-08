## Metadata

| Field                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| **Source**           | bearlysleeping/aikami                                           |
| **Target**           | `apps/backend/text` — Text Generator Service & Tmux integration |
| **Priority**         | P1                                                              |
| **Dependencies**     | C-070                                                           |
| **Status**           | not_started                                                     |
| **Contract version** | 1.0.0                                                           |

## Overview

Scaffold a standalone text generation microservice using the official Ollama Docker image. This completely mirrors our headless image generator framework, ensuring the local LLM runtime runs isolated from our Bun architecture but plugs perfectly into our shared tmux orchestrator workspace layer.

## Design Reference

Follow the patterns established in `apps/backend/image`. This includes using a container-only workspace target running through local wrapper scripts rather than internal JS runtime engines, alongside automated model pre-caching routines.

## Architecture Directives

- **Text Service Project Workspace**: Define a lightweight package architecture containing container configuration, dependency manifests, and lifecycle management scripts.
- **Port Constant Expositions**: Expand the central dev port architecture to expose uniform endpoint boundaries for the text processor subsystem across local, test, and production stages.
- **Orchestrator Registry Hook**: Bind the container target into the centralized workspace shell multiplexer setup, mapping lifecycle streams to a dedicated command line frame.

## State & Data Models

The service will download and mount its storage partition dynamically. We will configure an initialization controller that checks if the targeting language model is loaded, pulling it automatically if absent.

    Model Cache Mapping:
    Host: ./src/cache/ollama
    Container: /root/.ollama

    Default Model: qwen3.5:4b

## Acceptance Criteria

### AC-1: Port Registry Ingestion

**Given** the central workspace environment ports file
**When** imported by internal tooling
**Then** it must expose `text` fields mapping 11434 for development/emulator, 11433 for staging, and 11435 for production instances.

**Test Hooks**:

- Type validity matches across downstream consumer modules.

### AC-2: Container Shell Orchestration

**Given** the shell orchestrator session manager
**When** the system spawns its global layout workspace
**Then** it must register a window titled 'text' running the microservice initialization script.

**Test Hooks**:

- Orchestration interface lists 'text' as an operational subsystem target.

### AC-3: Data-Persisted Local Image Layer

**Given** the text package container specification
**When** booted via the system runner
**Then** it maps internal model configurations to the host cache directory and successfully initializes the Ollama daemon.

**Test Hooks**:

- Container image points to the official upstream Ollama distribution.

### AC-4: Resilient Diagnostic Evaluator

**Given** an initializing microservice pipeline
**When** the diagnostic sequence pings the local engine port
**Then** it gracefully asserts an active status response block once the daemon reports it is fully operational.

**Test Hooks**:

- Diagnostic utility execution verifies server availability without hard crashes on cold boots.

## Implementation Notes

1. Append port constants for the text engine in the development ports shared file.
2. Inject the text daemon handle into the tmux environment window generation matrix.
3. Establish `apps/backend/text` containing a Dockerfile utilizing the base Ollama manifest, a package manifest handling clean runtime deletions, and an orchestrator mapping target.
4. Draft a runtime check script using native fetch methods to evaluate health endpoints and pull the default narrative weight profile when absent.

## Edge Cases & Gotchas

- Run structural workspace link cleanups before starting container runs to avoid standard resource allocation collisions on the explicit engine ports.
- Local volume mounts running under root privileges internally must map elegantly to the dev workspace without corrupting permissions across adjacent files.
