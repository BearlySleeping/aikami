// scripts/src/lib/pi/types.ts
//
// Types for the pi bridge dispatcher. Every command is a JSON-in / JSON-out
// function keyed by its dotted command name.

/** A single bridged command. Payload is the decoded JSON request body. */
export type PiHandler = (payload: Record<string, unknown>) => unknown | Promise<unknown>;

/** Command name → handler, exported by each domain module. */
export type PiHandlers = Record<string, PiHandler>;
