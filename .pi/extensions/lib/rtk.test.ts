import { describe, expect, test } from 'bun:test';
import rtkExtension from '../rtk.ts';

type VersionResult = {
  code: number;
  stdout?: string;
  stderr: string;
  killed: boolean;
};

const loadExtension = async (versionResult: VersionResult): Promise<string[]> => {
  const events: string[] = [];
  const pi = {
    exec: async () => versionResult,
    on: (event: string) => events.push(event),
  };

  await rtkExtension(pi as never);
  return events;
};

describe('rtk version compatibility', () => {
  test.each([
    ['missing stdout', undefined],
    ['empty stdout', ''],
    ['unparseable stdout', 'rtk development-build'],
  ])('disables the extension for %s', async (_label, stdout) => {
    const events = await loadExtension({ code: 0, stdout, stderr: '', killed: false });
    expect(events).not.toContain('tool_call');
  });

  test('registers the handler for a supported parsed version', async () => {
    const events = await loadExtension({
      code: 0,
      stdout: 'rtk 0.23.0',
      stderr: '',
      killed: false,
    });
    expect(events).toContain('tool_call');
  });

  test('retains the minimum-version guard for parsed versions', async () => {
    const events = await loadExtension({
      code: 0,
      stdout: 'rtk 0.22.9',
      stderr: '',
      killed: false,
    });
    expect(events).not.toContain('tool_call');
  });
});
