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
  if (status.state === 'healthy' && status.readyPort) {
    return `✅ **${status.name}**${port} — identity-verified ready`;
  }
  if (status.state === 'unavailable' || status.state === 'crashed') {
    return `❌ **${status.name}**${port} — ${status.state}`;
  }
  return `⏳ **${status.name}**${port} — readiness unverified (${status.state})`;
};
