<!-- completed: 2026-06-29 -->
## Metadata

| Field                | Value                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**           | `LLM-Friendly Map Generation Pipeline` (Deep Research)                                                                                      |
| **Target**           | `scripts/tiled/jton_exporter.js`, `packages/frontend/engine/src/assets/jton_parser.ts`, `packages/frontend/engine/src/assets/map_loader.ts` |
| **Priority**         | P0 — Unblocks the primary project goal of LLM procedural generation by eliminating token-bloat.                                             |
| **Dependencies**     | C-171, C-172                                                                                                                                |
| **Status**           | **completed**                                                                                                                                    |
| **Contract version** | 1.0.0                                                                                                                                       |

## Overview

Standard map editors like Tiled export highly verbose JSON files filled with editor metadata, which rapidly exhausts an LLM's context window and leads to spatial hallucinations. This contract implements a token-optimized serialization pipeline. It introduces a custom JavaScript Tiled exporter that outputs map data in the highly compressed "JTON" (Zen Grid) tabular format, and a corresponding high-speed parser within the engine to hydrate this data directly into the ECS memory buffers.

## Design Reference

Follow the "JTON (JSON Tabular Object Notation) and Zen Grid Encoding" and "Tiled: Deep Extensibility and Unconstrained Architectures" sections from the `LLM-Friendly Map Generation Pipeline` deep research document.

## Architecture Directives

1. **Tiled Custom Exporter**: Write a standalone JavaScript file (`scripts/tiled/jton_exporter.js`) that uses the Tiled JS API (`tiled.registerMapFormat`). It must iterate over the map layers, strip all UI/editor metadata, and output a strict JTON/Zen Grid array string.
2. **Zen Grid Format**: The output must collapse repetitive keys into a single header row, delimited by semicolons for rows and commas for values (e.g., `[: x, y, tileId, collisionMask; 0, 0, 14, 1; 1, 0, 15, 1]`).
3. **Engine JTON Parser**: Create `jton_parser.ts` in the engine. It must rapidly split the semicolon/comma delimited string and return structured flat arrays.
4. **Map Loader Migration**: Refactor `map_loader.ts` to detect and parse this new format, feeding the exact same `ChunkData` and `TileVisual` components established in C-171.

## State & Data Models

```typescript
// Conceptual JTON String Output from Tiled Exporter
// The first element defines the schema keys. Subsequent elements are the raw data.
const mapData = `[: x, y, tileLayer, collisionMask, spawnHash; 
0, 0, 14, 1, 0; 
1, 0, 15, 1, 0; 
2, 0, 0, 0, 8439201; 
]`;

// Conceptual Parser Output
export interface ParsedJTONMap {
	width: number;
	height: number;
	// Flat SoA arrays ready for direct ECS ingestion
	x: Uint16Array;
	y: Uint16Array;
	tileLayer: Uint32Array;
	collisionMask: Uint16Array;
	spawnHash: Uint32Array;
}
```

## Scope Boundaries

- **In Scope:** - Writing the Tiled JavaScript export plugin (`tiled.registerMapFormat`).
- Implementing the string-based JTON parser in the engine.
- Updating `map_loader.ts` to support hydrating from this parsed format.
- Generating test maps to verify token-size reduction.

- **Out of Scope:** - The actual LLM API calls (OpenAI/Gemini integration).
- LLM Constrained Decoding/Grammar enforcement (handled backend-side).

## Acceptance Criteria

### AC-1: Tiled Meta-Data Stripping & Export

**Given** a standard configured Tiled map (`.tmx` or `.json`)
**When** exported using the custom `jton_exporter.js` plugin
**Then** the output is a plain text file utilizing the `[: header; data]` Zen Grid syntax, and file size/token count is reduced by at least 40% compared to standard JSON.

**Test Hooks**:

- Integration: Export a test map from Tiled using the plugin. Check the output string to ensure `isTileLayer` metadata, opacity, and UI tints are completely absent.

### AC-2: High-Speed JTON Parsing

**Given** a valid JTON string payload
**When** `JTONParser.parse(payload)` is executed
**Then** it correctly maps the columnar data into flat TypedArrays (`Uint16Array`, `Uint32Array`) based on the header row indices, without throwing type or length errors.

**Test Hooks**:

- Unit: Write tests in `jton_parser.test.ts` to verify standard parsing, handling of empty/null cells (e.g., `, ,`), and bounds checking.

### AC-3: ECS Map Hydration

**Given** a Staging World loading sequence
**When** `map_loader.ts` receives the parsed JTON arrays
**Then** the map renders perfectly using the WebGPU chunks (C-171), physical collisions work via the Spatial Hash (C-173), and Spawn Points resolve correctly (C-172).

**Test Hooks**:

- E2E / Visual: Run existing sandbox and map transition tests to ensure the new data format correctly hydrates the game world with 100% visual and mechanical parity.

## Implementation Sequence

1. **Phase 1 (Tooling)**: Write `scripts/tiled/jton_exporter.js`. You can test this locally in the Tiled editor by loading the script in `Edit -> Preferences -> Plugins`.
2. **Phase 2 (Data/Logic)**: Implement `packages/frontend/engine/src/assets/jton_parser.ts`. Ensure it is heavily optimized (avoiding excessive `.split()` object allocations if possible, or using basic regex/string scanning).
3. **Phase 3 (Integration)**: Wire `jton_parser.ts` into `map_loader.ts`. Test loading the new file extension.

## Edge Cases & Gotchas

- **Empty/Default Values**: In a highly compressed tabular format, empty tiles might be represented as `,,` (two consecutive commas). The parser must recognize this as a `0` or null equivalent in the TypedArrays to maintain index alignment.
- **Tiled API Constraints**: The Tiled JS API runs in a Qt/QJSEngine environment, not Node.js. You cannot use Node modules (`fs`, `path`) inside the exporter script; you must strictly use Tiled's `TextFile` API to output the string.
