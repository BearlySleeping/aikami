// scripts/src/lib/pi/silence_stdout.ts
//
// Imported FIRST by the pi bridge dispatcher (scripts/src/lib/pi/index.ts).
//
// 🔴 The dispatcher's stdout is a machine channel: the only thing it may
// contain is the final JSON envelope the Node-side bridge helper parses.
// Every reused scripts function (startServices, runPrePushGate, …) is written
// as a human-facing CLI and calls `console.log` freely, so redirect the whole
// console object's log stream to stderr before any of them load. stderr is
// ignored by the bridge unless the process fails, so diagnostics are still
// available without corrupting the channel.

console.log = (...args: unknown[]): void => {
  console.error(...args);
};
