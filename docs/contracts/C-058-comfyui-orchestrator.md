# Contract: C-058 — ComfyUI Orchestration

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-052 (DockerManager) |
| Status | completed |
| Version | 1.0 |

## Overview
We need to build the orchestration client for our Headless ComfyUI image generation service. This service will construct workflow graphs, submit them via REST, listen for binary image frames via WebSockets, and strictly enforce VRAM eviction post-generation. The goal is to stream generated character expressions/assets directly to client memory without touching the host's disk.

## Design Reference
- ComfyUI's native API and WebSocket documentation.
- The `DockerManager` utility built in C-052 for blackbox testing.

## Architecture Directives
- **Workflow Builder**: Constructs the ComfyUI JSON prompt graph. It must dynamically inject a `SaveImageWebsocket` node at the end of the pipeline.
- **ComfyUI REST Client**: Handles queueing the prompt (`/prompt`), fetching history (`/history`), and explicitly flushing memory (`/api/free`).
- **ComfyUI WS Receiver**: Connects to the ComfyUI WebSocket endpoint, listens for the `executing` status to finish, and parses incoming binary image payloads.
- **Image Generation Orchestrator**: Ties the Builder, REST Client, and WS Receiver together.

## State & Data Models
The VRAM eviction payload sent to `/api/free` must look exactly like this:

    {
        "unload_models": true,
        "free_memory": true
    }

ComfyUI WebSocket binary messages consist of a header followed by JPEG/PNG data. We need to capture this buffer and pass it up the chain.

## Acceptance Criteria

- **AC1: Workflow Builder Injection**
  - Given a base ComfyUI workflow definition
  - When the builder processes it for our pipeline
  - Then it successfully appends/replaces the output node with a `SaveImageWebsocket` node linked to the final image tensor.
  - Test Hook: Unit test the JSON graph manipulation to ensure the node exists and links are valid.

- **AC2: VRAM Eviction Enforcement**
  - Given a successful image generation cycle
  - When the WebSocket reports completion
  - Then the orchestrator immediately dispatches a POST request to `/api/free` with the `unload_models` flag.
  - Test Hook: Use fetch interceptors to assert that `/api/free` is called immediately after a mocked WS completion event.

- **AC3: WebSocket Binary Receiver**
  - Given an active generation
  - When ComfyUI sends a binary WebSocket frame containing image data
  - Then the receiver correctly parses the buffer and resolves the generation promise with the raw image data.
  - Test Hook: Inject a synthetic binary WS frame and assert the orchestrator returns the correct `Uint8Array` or `Buffer`.

- **AC4: Minimal Container Health Check (Testing Mandate)**
  - Given the integration test suite
  - When testing the ComfyUI integration
  - Then it uses `DockerManager` to boot a minimal, empty ComfyUI container (no real model weights) to assert the REST and WS endpoints accept connections and return expected HTTP statuses.
  - Test Hook: Boot the container, ping `/system_stats` or `/history`, and assert a 200 OK response before tearing it down.

## Implementation Notes
1. Create the `Workflow Builder` first to establish the data shape.
2. Build the `ComfyUI REST Client` and `ComfyUI WS Receiver` concurrently. Ensure you pass `AbortController` signals to the WS Receiver so it doesn't hang indefinitely on failures.
3. Combine them into the `Image Generation Orchestrator`.
4. For AC4, leverage the existing blackbox testing infrastructure. You don't need to run a real diffusion model; just verifying the API surface of a bare ComfyUI image is sufficient for "Straight Away" testing.
5. Place this in a new `packages/backend/image` or similar domain module.

## Edge Cases & Gotchas
- **Zombie WebSockets**: ComfyUI can sometimes drop the connection silently if a custom node crashes. Implement a timeout in the `Image Generation Orchestrator` that aborts the generation and forces a `/api/free` call if no image arrives within the expected window.
- **Binary Header Parsing**: ComfyUI's binary WS messages have an 8-byte header (usually identifying the image format and node ID). Make sure to slice this header off before returning the raw image buffer to the game client.
