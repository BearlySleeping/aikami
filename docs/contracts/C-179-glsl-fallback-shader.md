## Metadata

| Field | Value |
|---|---|
| **Source** | Visual Sandbox Debugging Requirements |
| **Target** | `packages/frontend/engine/src/rendering/tilemap_chunk_renderer.ts` (or wherever the `GpuProgram` is created) |
| **Priority** | P0 — Fixes endless loop crashing and blank canvas in WebGL2 fallback environments |
| **Dependencies** | C-177 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

The engine currently crashes and spams `Mesh shader has no glProgram` when running in a browser that defaults to WebGL2 (due to missing WebGPU support). This contract adds a `GlProgram` fallback to the custom tilemap shader. Because WebGL2 does not support Storage Buffers (SSBOs), the GLSL fallback will gracefully degrade by ignoring the animation data and simply rendering the static `texture2d_array`.

## Architecture Directives

1. **Write GLSL Vertex Shader**: Create a standard WebGL2 vertex shader string that multiplies `aPosition` by PixiJS's default transform matrices (`uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix`) and passes `aUV` and `aTextureLayer` to the fragment shader.
2. **Write GLSL Fragment Shader**: Create a WebGL2 fragment shader string that takes `vUV` and `vTextureLayer` and samples the `sampler2DArray` (e.g., `uTexture`).
3. **Compile GlProgram**: Use `GlProgram.from({ vertex: glslVertex, fragment: glslFragment, name: 'tilemap-gl-fallback' })`.
4. **Attach to Shader**: Pass the compiled `glProgram` into the `new Shader({...})` constructor alongside the existing `gpuProgram`.

## State & Data Models

```glsl
// glslVertex
in vec2 aPosition;
in vec2 aUV;
in float aTextureLayer;

out vec2 vUV;
out float vTextureLayer;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vTextureLayer = aTextureLayer;
}

```

```glsl
// glslFragment
precision highp float;
precision highp sampler2DArray;

in vec2 vUV;
in float vTextureLayer;

// PixiJS v8 automatically maps the WebGPU texture resource to uTexture in WebGL2 
// if it is named accordingly in the resources object.
uniform sampler2DArray uTexture; 

out vec4 fragColor;

void main(void) {
    fragColor = texture(uTexture, vec3(vUV, vTextureLayer));
}

```

## Scope Boundaries

* **In Scope:** - Adding `glProgram` to the tilemap shader.
* Ensuring the `resources` object in `new Shader()` maps the texture array correctly for both backends.


* **Out of Scope:** - Re-implementing animations for WebGL2. (WebGL2 will just render static tiles, which is an acceptable graceful degradation).

## Acceptance Criteria

### AC-1: WebGL2 Fallback Rendering

**Given** the game runs in a WebGL2 context
**When** the chunk renderer processes the map
**Then** it successfully renders the colored tilemap squares without throwing `Mesh shader has no glProgram` warnings in the console.

**Test Hooks**:

* Integration: Run the dev server. The console should be quiet, and the 10x10 colored map from C-178 should be visible beneath the LPC character.

## Implementation Sequence

1. **Phase 1 (Shaders)**: Add the `glslVertex` and `glslFragment` strings to the shader file.
2. **Phase 2 (Integration)**: Initialize `GlProgram.from()` and add it to the `Shader` constructor. Verify the texture is bound in a way that WebGL2 recognizes (usually just passing the `texture_2d_array` source into the `resources` object).
