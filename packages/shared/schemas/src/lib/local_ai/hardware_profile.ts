// packages/shared/schemas/src/lib/local_ai/hardware_profile.ts
import Type from 'typebox';
import { StackBackendSchema, StackModalitySchema } from './stack_backend.ts';

export const GpuVendorSchema = Type.Union([
  Type.Literal('nvidia'),
  Type.Literal('amd'),
  Type.Literal('intel'),
  Type.Literal('apple'),
  Type.Literal('none'),
]);

export const PlatformSchema = Type.Union([
  Type.Literal('linux'),
  Type.Literal('darwin'),
  Type.Literal('win32'),
]);

export const ArchSchema = Type.Union([Type.Literal('x64'), Type.Literal('arm64')]);

export const ContainerRuntimeSchema = Type.Union([
  Type.Literal('docker'),
  Type.Literal('podman'),
  Type.Literal('none'),
]);

export const CudaMajorSchema = Type.Union([Type.Literal(12), Type.Literal(13)]);

export const HardwareProfileSchema = Type.Object({
  platform: PlatformSchema,
  arch: ArchSchema,
  gpu: Type.Object({
    vendor: GpuVendorSchema,
    name: Type.Optional(Type.String()),
    vramMb: Type.Optional(Type.Number()),
    /** NVIDIA only — decides server-cuda vs server-cuda13. */
    cudaMajor: Type.Optional(CudaMajorSchema),
    /** True when the GPU shares system RAM (Apple Silicon, iGPU). */
    unifiedMemory: Type.Boolean(),
  }),
  ramMb: Type.Number(),
  cores: Type.Number(),
  freeDiskBytes: Type.Number(),
  containerRuntime: ContainerRuntimeSchema,
  /** NVIDIA Container Toolkit detected — GPU containers will actually work. */
  gpuPassthroughReady: Type.Boolean(),
});

export const StackModalitiesInputSchema = Type.Array(StackModalitySchema);
export const StackBackendInputSchema = Type.Optional(StackBackendSchema);
