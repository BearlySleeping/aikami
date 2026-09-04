// Fixture for runtime_boundary.test.ts's Node execution smoke test.
//
// Shaped like a real .pi extension but calls the `Bun` global directly —
// exactly the mistake the boundary guard exists to catch (see
// runtime_boundary.test.ts's header comment). Loading this under a real
// `node` process must throw `ReferenceError: Bun is not defined`, proving
// the "invalid" side of the boundary check actually fires instead of
// passing vacuously.

export default (pi: { registerTool: (tool: { name: string }) => void }): void => {
  // Type-checks fine (this package's tsconfig has @types/bun globally
  // available for the dual-runtime code it shares with Bun-only scripts);
  // it's only absent at runtime under `node`, which is the case under test.
  Bun.which('bash');
  pi.registerTool({ name: 'fixture_invalid' });
};
