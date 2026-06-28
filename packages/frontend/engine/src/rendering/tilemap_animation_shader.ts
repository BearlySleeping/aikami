// packages/frontend/engine/src/rendering/tilemap_animation_shader.ts

export const TILEMAP_ANIMATION_WGSL = /* wgsl */ `
  struct GlobalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uTime: f32,
  };

  struct AnimData {
    frameCount: f32,
    speed: f32,
    offsetStart: f32,
    padding: f32,
  };

  @group(0) @binding(0) var<uniform> globals: GlobalUniforms;
  @group(2) @binding(0) var<storage, read> animTable: array<AnimData>;
  @group(2) @binding(1) var uTextures: texture_2d_array<f32>;
  @group(2) @binding(2) var uSampler: sampler;

  struct VertexInput {
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
    @location(2) aTextureLayer: f32,
  };

  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) vUV: vec2<f32>,
    @location(1) vLayer: f32,
  };

  @vertex
  fn mainVertex(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let transformed = globals.uTransformMatrix * vec3<f32>(input.aPosition, 1.0);
    output.position = vec4<f32>(transformed.xy, 0.0, 1.0);
    output.vUV = input.aUV;
    output.vLayer = input.aTextureLayer;
    return output;
  }

  @fragment
  fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
    let anim = animTable[u32(input.vLayer)];
    
    // Animation frame math:
    // current_frame = floor((globals.uTime * anim.speed) % anim.frameCount)
    // frame_index = anim.offsetStart + current_frame
    
    let time_ms = globals.uTime * 1000.0;
    let frame = floor(time_ms * anim.speed) % anim.frameCount;
    let layer = u32(anim.offsetStart + frame);

    return textureSample(uTextures, uSampler, input.vUV, layer);
  }
`;
