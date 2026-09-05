// Fixture for runtime_boundary.test.ts's Node execution smoke test.
//
// Shaped like a real .pi extension (`export default (pi) => {...}`) but
// deliberately uses only Node-safe builtins, so loading it under a real
// `node` process must succeed. Proves the "valid" side of the boundary
// check: a clean extension is never a false positive.

import { which } from '../which.ts';

export default (pi: { registerTool: (tool: { name: string }) => void }): void => {
  // `which` is the Node-safe replacement for `Bun.which` — using it here is
  // the point, not incidental.
  which('node');
  pi.registerTool({ name: 'fixture_valid' });
};
