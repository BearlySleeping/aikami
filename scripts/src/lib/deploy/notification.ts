// scripts/src/lib/deploy/notification.ts
/**
 * Telegram deployment notification.
 *
 * Works both in CI (reads from env vars) and locally (passed as parameters).
 * Sends a rich, structured deployment summary via Telegram bot API.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type AppResult = {
  name: string;
  type: string;
  result: 'success' | 'failure' | 'skipped' | 'unknown';
};

export type NotificationInput = {
  botToken: string;
  chatId: string;
  branch: string;
  sha: string;
  actor: string;
  commitMessage: string;
  runUrl?: string;
  apps: AppResult[];
};

// ── Constants ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  success: '✅',
  failure: '❌',
  skipped: '⏭️',
  unknown: '❓',
};

const TYPE_LABEL: Record<string, string> = {
  'cloud-run-sveltekit': 'Cloud Run',
  'tauri-release': 'Tauri Release',
  'firebase-hosting': 'Firebase Hosting',
  'firebase-functions': 'Firebase Functions',
  'docker-release': 'Docker Release',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function shortSha7(sha: string): string {
  return sha.slice(0, 7);
}

function firstLine(msg: string): string {
  return msg.split('\n')[0].slice(0, 120);
}

function overallStatus(apps: AppResult[]): 'passed' | 'failed' | 'partial' | 'none' {
  if (apps.length === 0) {
    return 'none';
  }
  const hasFailure = apps.some((a) => a.result === 'failure');
  const allPassed = apps.every((a) => a.result === 'success');
  if (allPassed) {
    return 'passed';
  }
  if (hasFailure) {
    return 'failed';
  }
  return 'partial';
}

function appCountBy(apps: AppResult[], result: string): number {
  return apps.filter((a) => a.result === result).length;
}

// ── Message Builder ──────────────────────────────────────────────────────

export function buildNotificationMessage(input: NotificationInput): string {
  const { branch, sha, actor, commitMessage, runUrl, apps } = input;
  const status = overallStatus(apps);

  const headerIcon =
    status === 'passed' ? '✅' : status === 'failed' ? '🚨' : status === 'partial' ? '⚠️' : 'ℹ️';
  const headerText =
    status === 'passed'
      ? 'Deployment Succeeded'
      : status === 'failed'
        ? 'Deployment Failed'
        : status === 'partial'
          ? 'Deployment Partially Succeeded'
          : 'No Deployments';

  const succeeded = appCountBy(apps, 'success');
  const failed = appCountBy(apps, 'failure');
  const skipped = appCountBy(apps, 'skipped');

  const lines: string[] = [];
  lines.push(`${headerIcon} **Aikami — ${headerText}**`);
  lines.push('');

  if (succeeded > 0 || failed > 0 || skipped > 0) {
    const parts: string[] = [];
    if (succeeded > 0) {
      parts.push(`✅ ${succeeded} succeeded`);
    }
    if (failed > 0) {
      parts.push(`❌ ${failed} failed`);
    }
    if (skipped > 0) {
      parts.push(`⏭️ ${skipped} skipped`);
    }
    lines.push(`   ${parts.join(' · ')}`);
    lines.push('');
  }

  lines.push(`📂 \`${escapeMd(branch)}\` · ${shortSha7(sha)}`);
  if (actor) {
    lines.push(`👤 ${escapeMd(actor)}`);
  }
  if (commitMessage) {
    lines.push(`💬 ${escapeMd(firstLine(commitMessage))}`);
  }
  if (runUrl) {
    lines.push(`🔗 ${runUrl}`);
  }
  lines.push('');

  if (apps.length > 0) {
    lines.push('```');
    lines.push(' App                      Type               Result     ');
    lines.push(' ──────────────────────── ────────────────── ────────── ');
    for (const app of apps) {
      const name = app.name.padEnd(22).slice(0, 22);
      const typeLabel = TYPE_LABEL[app.type] ?? app.type;
      const type = typeLabel.padEnd(18);
      const icon = STATUS_ICON[app.result] ?? '❓';
      const result = app.result.padEnd(8);
      lines.push(` ${name} ${type} ${icon} ${result}`);
    }
    lines.push('```');
  }
  lines.push('');

  const failedApps = apps.filter((a) => a.result === 'failure');
  if (failedApps.length > 0) {
    lines.push('━'.repeat(36));
    lines.push('');
    lines.push('🚨 **FAILED**');
    lines.push('');
    for (const app of failedApps) {
      const typeLabel = TYPE_LABEL[app.type] ?? app.type;
      lines.push(`   ❌ \`${escapeMd(app.name)}\` — ${typeLabel}`);
    }
    if (runUrl) {
      lines.push('');
      lines.push(`Check the [run logs](${runUrl}) for details.`);
    }
    lines.push('━'.repeat(36));
  }

  return lines.join('\n');
}

// ── Telegram API ─────────────────────────────────────────────────────────

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = new URLSearchParams({
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: 'true',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(no body)');
    throw new Error(`Telegram API error ${response.status}: ${errorBody}`);
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Send a deployment notification via Telegram.
 * Handles 4096-char truncation automatically.
 */
export async function notifyDeployment(input: NotificationInput): Promise<void> {
  const message = buildNotificationMessage(input);
  const truncated =
    message.length > 4000 ? `${message.slice(0, 3950)}\n\n✂️ _Message truncated_` : message;

  console.log('\n── Telegram Notification ──');
  console.log(truncated);
  console.log('──────────────────────────\n');

  await sendTelegram(input.botToken, input.chatId, truncated);
  console.log('✅ Telegram notification sent');
}
