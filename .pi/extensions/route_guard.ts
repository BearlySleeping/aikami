// .pi/extensions/route_guard.ts
/**
 * Route Guard Pi Extension.
 *
 * Deterministic path hygiene for SvelteKit route groups. LLMs habitually
 * write `\(dev\)` first, creating a broken literal `\(dev\)` directory,
 * then retry with `(dev)`. Two guards:
 *
 *   1. write/edit/read paths — escaped groups are fixed in-place silently.
 *   2. bash commands — escaped quoted groups are blocked only when they are
 *      path arguments to mkdir/touch/mv/cp. Grep/sed inspection, tee, and
 *      redirection operands remain available for diagnosis and cleanup.
 */

import {
  isToolCallEventType,
  type ToolCallEvent,
  type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';

/** Matches backslash-escaped route groups: `\(dev\)`, `\\(sandbox\\)`, etc. */
const ESCAPED_GROUP_RE = /\\+\(([a-z0-9_-]+)\\+\)/gi;

/** Restrict normalization to SvelteKit's actual route tree, not arbitrary filenames. */
const ROUTE_PATH_RE = /(?:^|[\s'"/=])src\/routes(?:\/|$)/i;

/** Matches an escaped group inside one complete shell-quoted argument. */
const QUOTED_ESCAPED_GROUP_RE = /(['"])[^'"]*\\+\([a-z0-9_-]+\\+\)[^'"]*\1/i;

/** Finds a path-mutating command at the start of one shell command segment. */
const PATH_MUTATING_COMMAND_RE = /^\s*(?:(?:sudo|command)\s+)*(?:mkdir|touch|mv|cp)\b(.*)/i;

/** Removes redirection operands so they cannot be mistaken for command paths. */
const REDIRECTION_OPERAND_RE =
  /\d*(?:>>>|>>|>\||<<<|<<|<>|>|<)\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s;&|]+)/g;

/**
 * Match quoted spans before unquoted shell control operators. Inspection
 * commands can legitimately contain `|`, `&&`, or `;` inside a grep/sed
 * expression, and those characters must not turn text into a command position.
 * File-descriptor and noclobber redirects stay inside their command segment.
 */
const SHELL_BOUNDARY_RE = /'[^']*'|"(?:\\.|[^"])*"|>&|<&|&>|>\||&&|\|\||[;\n|]|&/g;
const REDIRECTION_BOUNDARIES = new Set(['>&', '<&', '&>', '>|']);

const splitShellCommands = (command: string): string[] => {
  const shellCommands: string[] = [];
  let segmentStart = 0;

  for (const match of command.matchAll(SHELL_BOUNDARY_RE)) {
    const boundary = match[0];
    if (
      boundary.startsWith("'") ||
      boundary.startsWith('"') ||
      REDIRECTION_BOUNDARIES.has(boundary)
    ) {
      continue;
    }

    const shellCommand = command.slice(segmentStart, match.index).trim();
    if (shellCommand !== '') {
      shellCommands.push(shellCommand);
    }
    segmentStart = match.index + boundary.length;
  }

  const finalCommand = command.slice(segmentStart).trim();
  if (finalCommand !== '') {
    shellCommands.push(finalCommand);
  }
  return shellCommands;
};

type ToolCallHandler = (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined>;

/** Structural subset of ExtensionAPI used by this extension. */
type RouteGuardAPI = {
  on(event: 'tool_call', handler: ToolCallHandler): () => void;
};

const hasEscapedGroup = (value: string): boolean => {
  if (!ROUTE_PATH_RE.test(value)) {
    return false;
  }
  ESCAPED_GROUP_RE.lastIndex = 0;
  return ESCAPED_GROUP_RE.test(value);
};

const fixEscapedGroups = (value: string): string => value.replace(ESCAPED_GROUP_RE, '($1)');

/**
 * Detect escaped route groups in path operands, rather than anywhere in a shell
 * command. Inspection commands may legitimately contain the same text, and a
 * quoted redirection target is not an argument consumed by mkdir/touch/mv/cp.
 */
const hasEscapedPathArgument = (command: string): boolean => {
  for (const shellCommand of splitShellCommands(command)) {
    const match = PATH_MUTATING_COMMAND_RE.exec(shellCommand);
    if (!match) {
      continue;
    }
    const commandArguments = (match[1] ?? '').replace(REDIRECTION_OPERAND_RE, '');
    if (ROUTE_PATH_RE.test(commandArguments) && QUOTED_ESCAPED_GROUP_RE.test(commandArguments)) {
      return true;
    }
  }
  return false;
};

const ESCAPED_PATH_REASON =
  '🔴 BLOCKED — backslash-escaped route group inside shell quotes. ' +
  'This creates a literal `\\(dev\\)` directory, breaking the SvelteKit route tree. ' +
  "Route groups use LITERAL parentheses. Correct form: mkdir -p 'src/routes/(dev)/dev/...' " +
  '(quotes handle the parens — no backslashes needed).';

export default function (pi: RouteGuardAPI) {
  pi.on('tool_call', async (event) => {
    if (
      (isToolCallEventType('read', event) ||
        isToolCallEventType('edit', event) ||
        isToolCallEventType('write', event)) &&
      typeof event.input.path === 'string' &&
      hasEscapedGroup(event.input.path)
    ) {
      event.input.path = fixEscapedGroups(event.input.path);
    }

    if (
      isToolCallEventType('bash', event) &&
      typeof event.input.command === 'string' &&
      hasEscapedPathArgument(event.input.command)
    ) {
      return { block: true, reason: ESCAPED_PATH_REASON };
    }
  });
}
