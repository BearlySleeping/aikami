<!-- completed: 2026-06-07 -->
# Contract: C-057 — Edge-Native TTS Worker

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-056 |
| Status | completed |
| Version | 1.0 |

## Overview
We are building the audio generation layer using Kokoro-82M compiled to an ONNX graph. To preserve GPU VRAM for the game renderer and upcoming ComfyUI image generation, this TTS engine must run strictly on host CPU threads. This contract covers the Bun background worker pool, the sentence-boundary chunker that consumes the SSE text stream, and the WebSocket server that streams audio binaries back to the client.

## Design Reference
- Review Bun's `Worker` API for thread isolation.
- Review standard WebSocket binary streaming patterns (e.g., sending `Float32Array` or `Int16Array` buffers).

## Architecture Directives
- **Sentence Boundary Chunker**: Parses incoming SSE text streams on the fly and yields complete sentences to the audio engine.
- **ONNX Runtime Wrapper**: Interfaces with the ONNX model (to be mocked in this contract).
- **TTS Worker Pool**: Manages Bun background workers to ensure CPU-bound tasks don't block the main event loop.
- **WebSocket Audio Streamer**: Handles client connections, streams audio buffers, and respects backpressure/disconnects.

## State & Data Models
The WebSocket should stream raw binary data directly, but control messages (like start/stop/error) can be JSON. 

Control Message format:
    
    {
        "type": "audio_start" | "audio_end" | "error",
        "messageId": "msg_123",
        "timestamp": 1629384756
    }

Audio chunks will be sent as raw binary frames (e.g., 24kHz Float32 PCM data).

## Acceptance Criteria

- **AC1: Sentence Boundary Chunker**
  - Given a simulated SSE text stream
  - When the text arrives in fragmented tokens (e.g., "Hello", " there", "!", " How", " are", " you?")
  - Then the chunker correctly buffers and emits complete sentences ("Hello there!", "How are you?") based on punctuation.
  - Test Hook: Unit test the chunker with various edge cases (ellipses, trailing text without punctuation).

- **AC2: Synthetic ONNX Runtime Mock (Testing Mandate)**
  - Given a request to generate audio for a sentence
  - When the TTS worker processes it
  - Then the mocked ONNX runtime instantly returns a tiny static `Float32Array` representing 0.1s of silence.
  - Test Hook: Assert the output type and length without loading a real 30GB ONNX model.

- **AC3: Bun Worker Isolation**
  - Given a batch of sentences to process
  - When the orchestrator assigns them
  - Then they are dispatched to a Bun `Worker` thread, leaving the main thread unblocked.
  - Test Hook: Use Bun IPC stubs to verify message passing between main and worker threads.

- **AC4: WebSocket Streaming & Lifecycle**
  - Given an active client WebSocket connection
  - When audio chunks are yielded by the worker
  - Then they are streamed to the client as binary frames.
  - Then, if the client disconnects, the worker task is immediately aborted and resources are cleaned up.
  - Test Hook: Connect a mock client, trigger a generation, receive one chunk, disconnect, and assert that the worker cleanup fires.

## Implementation Notes
1. Start with the `Sentence Boundary Chunker` as it's pure logic and easy to TDD.
2. Build the `Synthetic ONNX Runtime Mock` returning the fake `Float32Array`.
3. Wrap the mock in a Bun `Worker` script and build the `TTS Worker Pool` to manage IPC (Inter-Process Communication).
4. Build the WebSocket server endpoint that ties the SSE text consumer, the worker pool, and the binary sender together.

## Edge Cases & Gotchas
- **Straggler Text**: If the SSE stream ends but the final text doesn't have terminal punctuation, the chunker must flush the remaining buffer.
- **Abrupt Disconnects**: Similar to C-056, if a user skips a dialogue line, the WebSocket will close. The Bun worker MUST be told to terminate its current generation loop immediately so we don't waste CPU cycles.
