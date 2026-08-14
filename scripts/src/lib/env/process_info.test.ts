// scripts/src/lib/env/process_info.test.ts
//
// The parsers are tested against captured real-world output, because that is
// the half that cannot be exercised on the developer's own OS — a Linux CI
// box never runs `netstat -ano`, and a Windows box never runs `ps -o etime=`.

import { describe, expect, it } from 'bun:test';
import { parseEtime, parseNetstatPids, parseSsPids, parseTasklistName } from './process_info.ts';

// Real `netstat -ano -p tcp` output (Windows 11), trimmed.
const NETSTAT_OUTPUT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       23120
  TCP    127.0.0.1:5173         127.0.0.1:51234        ESTABLISHED     9988
  TCP    [::]:5173              [::]:0                 LISTENING       23120
  TCP    0.0.0.0:9099           0.0.0.0:0              LISTENING       7744
`;

describe('parseNetstatPids', () => {
  it('extracts the listening PID for a port', () => {
    expect(parseNetstatPids(NETSTAT_OUTPUT, 9099)).toEqual([7744]);
  });

  it('dedupes the IPv4 and IPv6 rows of one listener', () => {
    expect(parseNetstatPids(NETSTAT_OUTPUT, 5173)).toEqual([23120]);
  });

  it('ignores ESTABLISHED connections — only the listener holds the port', () => {
    expect(parseNetstatPids(NETSTAT_OUTPUT, 5173)).not.toContain(9988);
  });

  it('does not match a port that is merely a prefix or suffix', () => {
    // "517" must not match the ":5173" row, nor "173".
    expect(parseNetstatPids(NETSTAT_OUTPUT, 517)).toEqual([]);
    expect(parseNetstatPids(NETSTAT_OUTPUT, 173)).toEqual([]);
  });

  it('returns empty for an unlisted port and for junk input', () => {
    expect(parseNetstatPids(NETSTAT_OUTPUT, 4321)).toEqual([]);
    expect(parseNetstatPids('', 5173)).toEqual([]);
    expect(parseNetstatPids('not netstat output at all', 5173)).toEqual([]);
  });
});

describe('parseTasklistName', () => {
  it('reads the image name from a CSV row', () => {
    expect(parseTasklistName('"node.exe","23120","Console","1","61,234 K"')).toBe('node.exe');
  });

  it('returns undefined for the "no tasks" message', () => {
    expect(
      parseTasklistName('INFO: No tasks are running which match the criteria.'),
    ).toBeUndefined();
  });

  it('returns undefined for empty output', () => {
    expect(parseTasklistName('')).toBeUndefined();
  });
});

describe('parseEtime', () => {
  it('parses mm:ss', () => {
    expect(parseEtime('05:30')).toBe(330);
  });

  it('parses hh:mm:ss', () => {
    expect(parseEtime('01:00:00')).toBe(3600);
  });

  it('parses dd-hh:mm:ss', () => {
    expect(parseEtime('2-03:04:05')).toBe(2 * 86_400 + 3 * 3600 + 4 * 60 + 5);
  });

  it('tolerates the leading whitespace ps emits', () => {
    expect(parseEtime('   12:34  ')).toBe(754);
  });

  it('returns undefined for unparseable input', () => {
    expect(parseEtime('not-a-time')).toBeUndefined();
    expect(parseEtime('')).toBeUndefined();
  });

  it('reports a just-started process as 0, not undefined', () => {
    // 0 is a real age and must survive — a falsy-check bug would drop it and
    // make a fresh process look ageless, defeating the crash-grace window.
    expect(parseEtime('00:00')).toBe(0);
  });
});

// Real `ss -tlnpH "sport = :45999"` output (Linux, iproute2).
describe('parseSsPids', () => {
  it('extracts the PID from a listening socket row', () => {
    expect(
      parseSsPids(
        'LISTEN 0      512    127.0.0.1:45999 0.0.0.0:* users:(("bun",pid=762939,fd=11))',
      ),
    ).toEqual([762939]);
  });

  it('collects every PID sharing one socket, deduped', () => {
    const row =
      'LISTEN 0 511 *:3000 *:* users:(("node",pid=100,fd=20),("node",pid=101,fd=20),("node",pid=100,fd=21))';
    expect(parseSsPids(row)).toEqual([100, 101]);
  });

  it('returns empty when ss reports no matching socket', () => {
    expect(parseSsPids('')).toEqual([]);
  });
});
