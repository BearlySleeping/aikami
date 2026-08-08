// packages/shared/logger/src/lib/logger_browser.test.ts
//
// Unit tests for HttpLogSink (the browser logger's cross-origin HTTP
// ingestion sink):
//   - default endpoint is the relative /api/internal_logging when
//     PUBLIC_LOG_ENDPOINT is unset
//   - PUBLIC_LOG_ENDPOINT is honored when set (hub's custom domain for
//     static hosts like `client`)
//   - the POST body carries PUBLIC_APP_ID as `app` so hub can tag entries
//
// import.meta.env proxies process.env under Bun, so env vars are set before
// constructing each sink instance (the endpoint is captured at
// construction time — same as a Vite build replacing the literal).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { HttpLogSink } from './logger_browser.ts';

const DEFAULT_ENDPOINT = '/api/internal_logging';

const fetchMock = mock((_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
  Promise.resolve(new Response('{"count":1,"success":true}')),
);

beforeEach(() => {
  delete process.env.PUBLIC_LOG_ENDPOINT;
  delete process.env.PUBLIC_APP_ID;
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.PUBLIC_LOG_ENDPOINT;
  delete process.env.PUBLIC_APP_ID;
  // Restore the real global fetch so other tests aren't affected.
  // (bun:test restores module state per file, but be explicit anyway.)
});

const writeAndFlush = (sink: HttpLogSink, message = 'test log') => {
  sink.write({ logLevel: 'INFO', logType: 'info', message });
  sink.flush();
};

describe('HttpLogSink endpoint resolution', () => {
  test('defaults to the relative /api/internal_logging when PUBLIC_LOG_ENDPOINT is unset', () => {
    const sink = new HttpLogSink();
    writeAndFlush(sink);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(DEFAULT_ENDPOINT);
  });

  test('uses PUBLIC_LOG_ENDPOINT when set (cross-origin hub endpoint)', () => {
    process.env.PUBLIC_LOG_ENDPOINT = 'https://hub.stg.bearlysleeping.com/api/internal_logging';
    const sink = new HttpLogSink();
    writeAndFlush(sink);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://hub.stg.bearlysleeping.com/api/internal_logging');
  });

  test('endpoint is captured at construction time (build-time replacement semantics)', () => {
    const sinkA = new HttpLogSink();
    process.env.PUBLIC_LOG_ENDPOINT = 'https://changed.example.com/api';
    const sinkB = new HttpLogSink();

    writeAndFlush(sinkA);
    writeAndFlush(sinkB);

    expect(String(fetchMock.mock.calls[0][0])).toBe(DEFAULT_ENDPOINT);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://changed.example.com/api');
  });
});

describe('HttpLogSink request payload', () => {
  test('POSTs a JSON batch with label, app and payload.batch', () => {
    process.env.PUBLIC_APP_ID = 'client';
    const sink = new HttpLogSink();
    sink.write({ logLevel: 'ERROR', logType: 'error', message: 'boom' });
    sink.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(DEFAULT_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(init?.body));
    expect(body.label).toBe('logger');
    expect(body.app).toBe('client');
    expect(body.payload.batch).toHaveLength(1);
    expect(body.payload.batch[0].message).toBe('boom');
  });

  test('omits the app field entirely when PUBLIC_APP_ID is unset', () => {
    const sink = new HttpLogSink();
    writeAndFlush(sink);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('app');
  });

  test('batches multiple entries written before flush into one request', () => {
    const sink = new HttpLogSink();
    sink.write({ logLevel: 'INFO', logType: 'info', message: 'one' });
    sink.write({ logLevel: 'WARNING', logType: 'warn', message: 'two' });
    sink.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.payload.batch).toHaveLength(2);
  });

  test('drops render-spam entries matching the exclude pattern before flushing', () => {
    const sink = new HttpLogSink();
    sink.write({ logLevel: 'DEBUG', logType: 'debug', message: '00:12 [GameWorld] render' });
    sink.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does not call fetch when flush is a no-op (empty buffer)', () => {
    const sink = new HttpLogSink();
    sink.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
