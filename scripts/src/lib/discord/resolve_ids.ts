// scripts/src/lib/discord/resolve_ids.ts

/** Resolves declared channel or role names to live Discord IDs, failing on unknown names. */
export const resolveIds = (
  names: string[] | undefined,
  idByName: Map<string, string>,
  context: string,
  kind: 'channel' | 'role',
): string[] =>
  (names ?? []).map((name) => {
    const id = idByName.get(name);
    if (!id) {
      throw new Error(`${context} references ${kind} "${name}", which doesn't exist live.`);
    }
    return id;
  });
