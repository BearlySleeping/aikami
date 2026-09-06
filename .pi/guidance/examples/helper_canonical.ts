// .pi/guidance/examples/helper_canonical.ts
//
// Canonical pure helper function — no class scaffolding, no interface.
// Module-level code uses `$logger` (or the runtime-appropriate logger),
// not `this.debug()` which is only available inside a class method.
//
// ✅ executable: compiles and lints under the scripts project configuration.

/**
 * Formats a duration in seconds to a human-readable string.
 * No dependencies, no side effects — a pure utility function.
 */
export const formatDuration = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);
  return parts.join(' ');
};
