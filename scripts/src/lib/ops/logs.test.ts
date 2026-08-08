// scripts/src/lib/ops/logs.test.ts
//
// Unit tests for the pure functions in ops/logs.ts — buildFilter() and
// resolveLogTarget(). No gcloud calls, no mocking: these functions are
// pure (they only combine APP_CONFIG data and option flags into strings /
// plain objects).

import { describe, expect, it } from 'bun:test';
import { APP_CONFIG, CLOUD_FUNCTIONS_REGION } from '../deploy/deployment_config';
import { buildFilter, resolveLogTarget } from './logs.ts';

const hubConfig = APP_CONFIG.hub;
const hubServiceName = hubConfig.cloudRunServiceId ?? `aikami-${hubConfig.shortName}`;
const hubRegion = hubConfig.region ?? 'europe-west1';

describe('buildFilter', () => {
  const base = {
    projectId: 'aikami-staging',
    region: 'europe-west1',
    serviceName: 'aikami-hub',
  };

  it('builds the base filter with resource type, location and service name', () => {
    const filter = buildFilter(base, {});
    expect(filter).toBe(
      'resource.type="cloud_run_revision" AND ' +
        'resource.labels.location="europe-west1" AND ' +
        'resource.labels.service_name="aikami-hub"',
    );
  });

  it('omits the service_name clause when serviceName is empty', () => {
    const filter = buildFilter({ ...base, serviceName: '' }, {});
    expect(filter).toBe(
      'resource.type="cloud_run_revision" AND resource.labels.location="europe-west1"',
    );
  });

  it('appends the extraFilter (client redirect) after service_name', () => {
    const filter = buildFilter({ ...base, extraFilter: 'jsonPayload.app="client"' }, {});
    expect(filter).toBe(
      'resource.type="cloud_run_revision" AND ' +
        'resource.labels.location="europe-west1" AND ' +
        'resource.labels.service_name="aikami-hub" AND ' +
        'jsonPayload.app="client"',
    );
  });

  it('appends severity>= when a severity is given, uppercased', () => {
    const filter = buildFilter(base, { severity: 'warning' });
    expect(filter).toContain('severity>=WARNING');
    expect(filter).not.toContain('severity>=warning');
  });

  it('appends a quoted jsonPayload.message substring match', () => {
    const filter = buildFilter(base, { message: 'pollGmail' });
    expect(filter).toContain('jsonPayload.message:"pollGmail"');
  });

  it('escapes double quotes inside --message values', () => {
    const filter = buildFilter(base, { message: 'say "hello"' });
    expect(filter).toContain('jsonPayload.message:"say \\"hello\\""');
  });

  it('ANDs a raw --filter fragment onto the base', () => {
    const filter = buildFilter(base, { filter: 'logName=~"aikami-hub"' });
    expect(filter).toEndWith('AND logName=~"aikami-hub"');
  });

  it('combines severity, message and raw filter in one query', () => {
    const filter = buildFilter(base, {
      severity: 'ERROR',
      message: 'boom',
      filter: 'logName=~"aikami-hub"',
    });
    expect(filter).toBe(
      'resource.type="cloud_run_revision" AND ' +
        'resource.labels.location="europe-west1" AND ' +
        'resource.labels.service_name="aikami-hub" AND ' +
        'severity>=ERROR AND ' +
        'jsonPayload.message:"boom" AND ' +
        'logName=~"aikami-hub"',
    );
  });
});

describe('resolveLogTarget', () => {
  it('hub → cloud-run-sveltekit with its Cloud Run service name and region', () => {
    const target = resolveLogTarget('hub', 'staging', undefined);
    expect('unsupported' in target).toBe(false);
    if ('unsupported' in target) {
      return;
    }
    expect(target.projectId).toBe('aikami-staging');
    expect(target.region).toBe(hubRegion);
    expect(target.serviceName).toBe(hubServiceName);
    expect(target.extraFilter).toBeUndefined();
  });

  it('firebase without --only → all functions in the region, with a hint note', () => {
    const target = resolveLogTarget('firebase', 'staging', undefined);
    expect('unsupported' in target).toBe(false);
    if ('unsupported' in target) {
      return;
    }
    expect(target.region).toBe(CLOUD_FUNCTIONS_REGION);
    expect(target.serviceName).toBe('');
    expect(target.note).toContain('No --only');
  });

  it('firebase with --only → scoped to that one function', () => {
    const target = resolveLogTarget('firebase', 'staging', 'pollGmail');
    expect('unsupported' in target).toBe(false);
    if ('unsupported' in target) {
      return;
    }
    expect(target.serviceName).toBe('pollGmail');
    expect(target.note).toBeUndefined();
  });

  it('client → redirects to hub stream with jsonPayload.app="client" extra filter', () => {
    const target = resolveLogTarget('client', 'staging', undefined);
    expect('unsupported' in target).toBe(false);
    if ('unsupported' in target) {
      return;
    }
    expect(target.serviceName).toBe(hubServiceName);
    expect(target.region).toBe(hubRegion);
    expect(target.extraFilter).toBe('jsonPayload.app="client"');
    expect(target.note).toContain("forwarded through hub's /api/internal_logging");
  });

  it('site → unsupported (static hosting, no server-side logs)', () => {
    const target = resolveLogTarget('site', 'staging', undefined);
    expect('unsupported' in target).toBe(true);
    if (!('unsupported' in target)) {
      return;
    }
    expect(target.unsupported).toContain('static Firebase Hosting');
  });

  it('docs → unsupported (static hosting, no server-side logs)', () => {
    const target = resolveLogTarget('docs', 'staging', undefined);
    expect('unsupported' in target).toBe(true);
    if (!('unsupported' in target)) {
      return;
    }
    expect(target.unsupported).toContain('static Firebase Hosting');
  });

  it('client-tauri → unsupported (desktop release artifact)', () => {
    const target = resolveLogTarget('client-tauri', 'staging', undefined);
    expect('unsupported' in target).toBe(true);
    if (!('unsupported' in target)) {
      return;
    }
    expect(target.unsupported).toContain('desktop release');
  });

  it('image → unsupported (docker-release, self-hosted GPU infra)', () => {
    const target = resolveLogTarget('image', 'staging', undefined);
    expect('unsupported' in target).toBe(true);
    if (!('unsupported' in target)) {
      return;
    }
    expect(target.unsupported).toContain('self-hosted GPU');
  });

  it('text and voice → unsupported like image (docker-release)', () => {
    for (const app of ['text', 'voice'] as const) {
      const target = resolveLogTarget(app, 'production', undefined);
      expect('unsupported' in target).toBe(true);
      if ('unsupported' in target) {
        expect(target.unsupported).toContain('self-hosted GPU');
      }
    }
  });
});
