import type { Entry, Paginated } from '@lacijs/core';
import type { StudioEntry, StudioPromoteResult } from '../src/handler';
import { approvalRequest, colors, setupHandler } from './fixtures';

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const promotePath = '/api/entries/customerCategoryColor/promote';

describe('POST api/entries/:key/promote', () => {
  it('copies an entry to another environment', async () => {
    const { send, laci } = await setupHandler();
    await laci.set('customerCategoryColor', colors.value.slice(0, 1), { environment: 'staging' });
    const plan = await send('POST', promotePath, {
      from: 'staging',
      to: 'production',
      dryRun: true,
    });
    expect(plan.status).toBe(200);
    expect(await body<StudioPromoteResult>(plan)).toMatchObject({
      changes: [
        { action: 'update', previous: { version: 1 }, entry: { version: 2, warnings: [] } },
      ],
    });
    expect(await laci.getEntry('customerCategoryColor')).toMatchObject({ version: 1 });

    const response = await send('POST', promotePath, {
      from: 'staging',
      to: 'production',
      expectedVersion: 1,
      sourceVersion: 2,
      note: 'Release',
    });
    expect(await body<StudioPromoteResult>(response)).toMatchObject({
      changes: [{ action: 'update', entry: { version: 2, updatedBy: 'dev-1' } }],
    });
    const history = await laci.history('customerCategoryColor');
    expect(history.items[0]).toMatchObject({ note: 'Release', changedBy: 'dev-1' });
  });

  it('promotes every locale of a template', async () => {
    const { send, laci } = await setupHandler();
    for (const locale of ['id-ID', 'en']) {
      await laci.define('approval-request', { ...approvalRequest, environment: 'staging', locale });
    }
    const response = await send(
      'POST',
      '/api/entries/approval-request/promote',
      { from: 'staging', to: 'production', kind: 'EMAIL_TEMPLATE', all: true },
      null,
    );
    expect(
      (await body<StudioPromoteResult>(response)).changes.map(
        ({ action, entry }) => `${action}:${entry.locale}`,
      ),
    ).toEqual(['create:en', 'unchanged:id-ID']);
  });

  it('promotes one locale or channel', async () => {
    const { send, laci } = await setupHandler();
    await laci.define('reminder', {
      kind: 'MESSAGE_TEMPLATE',
      environment: 'staging',
      locale: 'en',
      channel: 'SMS',
      schema: { type: 'object' },
      value: { body: 'Hi' },
    });
    const response = await send('POST', '/api/entries/reminder/promote', {
      from: 'staging',
      to: 'production',
      kind: 'MESSAGE_TEMPLATE',
      locale: 'en',
      channel: 'SMS',
    });
    expect(await body<StudioPromoteResult>(response)).toMatchObject({
      changes: [{ action: 'create', entry: { locale: 'en', channel: 'SMS', warnings: [] } }],
    });
  });

  it('rejects bad requests, stale versions, and missing entries', async () => {
    const { send } = await setupHandler();
    for (const [payload, status, error] of [
      [{ from: 'staging' }, 400, '"from" and "to" are required.'],
      [{ from: 'staging', to: 'staging' }, 400, '"from" and "to" must be different environments.'],
      [
        { from: 'staging', to: 'production', all: true, expectedVersion: 1 },
        400,
        '"expectedVersion" and "sourceVersion" cannot be used with "all".',
      ],
      [
        { from: 'staging', to: 'production', sourceVersion: 0 },
        400,
        '"sourceVersion" must be an integer of at least 1.',
      ],
      [
        { from: 'staging', to: 'qa' },
        400,
        'Unknown environment "qa"; configured: "production", "staging", "development".',
      ],
      [
        { from: 'staging', to: 'production', expectedVersion: 5 },
        409,
        'Entry "customerCategoryColor" (production) was changed by someone else: expected version 5, but it is at version 1.',
      ],
      [
        { from: 'development', to: 'production' },
        404,
        'Entry "customerCategoryColor" (development) does not exist or is not published.',
      ],
    ] as const) {
      const response = await send('POST', promotePath, payload);
      expect(response.status).toBe(status);
      expect((await body(response)).error).toBe(error);
    }
  });

  it('needs the CSRF header', async () => {
    const { call } = await setupHandler();
    const response = await call(promotePath, { method: 'POST', body: '{}' });
    expect(response.status).toBe(403);
  });
});

describe('locales of a template', () => {
  it('lists the entries of one key', async () => {
    const { call, laci } = await setupHandler();
    await laci.define('approval-request', { ...approvalRequest, locale: 'en' });
    const response = await call('/api/entries?key=approval-request');
    expect((await body<Paginated<Entry>>(response)).items.map((entry) => entry.locale)).toEqual([
      'en',
      'id-ID',
    ]);
  });

  it('warns when the variable schemas of the locales differ', async () => {
    const { call, laci } = await setupHandler();
    // Same schema with its keys in another order: no warning.
    const { required, ...rest } = approvalRequest.schema;
    await laci.define('approval-request', {
      ...approvalRequest,
      locale: 'en',
      schema: { ...rest, required },
    });
    const get = async (locale: string) =>
      (
        await body<StudioEntry>(
          await call(`/api/entries/approval-request?kind=EMAIL_TEMPLATE&locale=${locale}`),
        )
      ).warnings;
    expect(await get('en')).toEqual([]);

    await laci.define('approval-request', {
      ...approvalRequest,
      locale: 'ms',
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      value: { subject: 'Hai {{ name }}', html: '', text: '' },
    });
    expect(await get('id-ID')).toEqual([
      {
        path: 'schema',
        message:
          'differs from the schema of locale ms: every locale of a template should have the same variables',
        code: 'schemaMismatch',
      },
    ]);
    expect((await get('ms'))[0]?.message).toContain('locale en, id-ID:');
  });
});
