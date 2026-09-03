// scripts/src/lib/ops/gha_annotate.ts
//
// Emits a GitHub Actions `::error` workflow command for one file/line
// diagnostic, so guard violations and typecheck errors show up as inline
// annotations on the PR's "Files changed" tab and Checks summary — no
// `.github/workflows` change needed, GitHub picks up workflow commands from
// any step's stdout automatically.
//
// No-ops outside CI (GITHUB_ACTIONS unset) so local `bun run guard` /
// `bun run typecheck` stay exactly as clean as they are today — this is
// purely additive to the console.error() output guards already print.
//
// `file` must be repo-root-relative (posix separators) — GitHub resolves it
// against GITHUB_WORKSPACE, so a cwd-relative or absolute path would attach
// the annotation to the wrong file or silently drop it.

const escapeProperty = (value: string): string =>
  value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');

const escapeMessage = (value: string): string =>
  value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

export const annotate = (options: {
  file: string;
  line: number;
  col?: number;
  message: string;
  title?: string;
}): void => {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    return;
  }
  const { file, line, col, message, title } = options;
  const props = [`file=${escapeProperty(file)}`, `line=${line}`];
  if (col !== undefined) {
    props.push(`col=${col}`);
  }
  if (title !== undefined) {
    props.push(`title=${escapeProperty(title)}`);
  }
  console.log(`::error ${props.join(',')}::${escapeMessage(message)}`);
};
