// .pi/extensions/lib/service_status.ts

/** Present canonical readiness, never equate an open port with instance identity. */
export const formatServiceStatus = (status: {
  name: string;
  running: boolean;
  readyPort?: number;
  state: string;
}): string => {
  if (!status.running) {
    return `⏸️ **${status.name}** — not running`;
  }
  const port = status.readyPort ? ` — :${status.readyPort}` : '';
  if (status.state === 'healthy') {
    const readiness = status.readyPort ? 'identity-verified ready' : 'running (no port check)';
    return `✅ **${status.name}**${port} — ${readiness}`;
  }
  if (status.state === 'unavailable' || status.state === 'crashed') {
    return `❌ **${status.name}**${port} — ${status.state}`;
  }
  return `⏳ **${status.name}**${port} — readiness unverified (${status.state})`;
};

/** Select a service only from the requesting checkout's workspace. */
export const formatWorkspaceServiceStatus = (options: {
  sessions: readonly {
    name: string;
    services: readonly (Parameters<typeof formatServiceStatus>[0] & { service: string })[];
  }[];
  workspace: string;
  service: string;
}): string => {
  const status = options.sessions
    .filter((session) => session.name === options.workspace)
    .flatMap((session) => session.services)
    .find((entry) => entry.service === options.service);
  return status ? formatServiceStatus(status) : `⏸️ ${options.service} — not running`;
};
