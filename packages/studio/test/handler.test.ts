import { createLaci, MemoryStore, VersionConflictError } from '@lacijs/core';
import type { Entry, EntryHistory, Paginated } from '@lacijs/core';
import { createStudioHandler, DISABLED_MESSAGE, isStudioEnabled } from '../src/handler';
import { colors, createTestLaci, CSRF, setupHandler, UI_FIXTURE } from './fixtures';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('isStudioEnabled', () => {
  it('is on unless NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isStudioEnabled({})).toBe(true);
    vi.stubEnv('NODE_ENV', 'test');
    expect(isStudioEnabled({})).toBe(true);
    vi.stubEnv('NODE_ENV', undefined);
    expect(isStudioEnabled({})).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(isStudioEnabled({})).toBe(false);
  });

  it('follows `enabled` when it is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isStudioEnabled({ enabled: true })).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    expect(isStudioEnabled({ enabled: false })).toBe(false);
  });
});

describe('in production', () => {
  it('answers every studio request with a plain 404, while reads keep working', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const laci = await createTestLaci();
    const handler = createStudioHandler({ laci, uiDir: UI_FIXTURE });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(DISABLED_MESSAGE);

    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/api/session'],
      ['GET', '/api/entries'],
      ['POST', '/api/entries'],
      ['PUT', '/api/entries/linkPath'],
    ] as const) {
      const init: RequestInit = { method, headers: CSRF };
      if (method !== 'GET') init.body = JSON.stringify({ key: 'x', schema: {}, value: 1 });
      const response = await handler(new Request(`http://localhost/laci${path}`, init), {
        path,
        user: null,
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found.');
    }
    expect(await laci.getEntry('x')).toBeNull();
    // The app's own reads are not affected.
    expect(await laci.find('customerCategoryColor', { category: 'VIP' })).toEqual(colors.value[0]);
  });

  it('runs when turned on explicitly', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { call } = await setupHandler({ enabled: true, label: 'PRODUCTION' });
    const session = await body(await call('/api/session'));
    expect(session).toMatchObject({ label: 'PRODUCTION', runtime: 'production' });
  });
});

describe('UI files', () => {
  it('redirects the mount point to a trailing slash, keeping the query', async () => {
    const { handler } = await setupHandler();
    const response = await handler(new Request('http://localhost/laci?x=1'), {
      path: '/',
      user: null,
    });
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/laci/?x=1');
  });

  it('serves the page with security headers, and assets with long caching', async () => {
    const { call } = await setupHandler();
    const page = await call('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await page.text()).toContain('<title>Fixture</title>');

    const script = await call('/assets/app.js');
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(script.headers.get('x-frame-options')).toBeNull();
    expect((await call('/style.css')).headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect((await call('/data.bin')).headers.get('content-type')).toBe('application/octet-stream');
    expect((await call('/', { method: 'HEAD' })).status).toBe(200);
  });

  it('answers 404 for missing files and paths outside the UI folder, 405 for writes', async () => {
    const { call } = await setupHandler();
    expect((await call('/missing.js')).status).toBe(404);
    expect((await call('/../handler.test.ts')).status).toBe(404);
    expect((await call('/', { method: 'POST' })).status).toBe(405);
  });

  it('finds the built UI next to the package by default', async () => {
    const handler = createStudioHandler({ laci: await createTestLaci() });
    const response = await handler(new Request('http://localhost/no-such-file'), {
      path: '/no-such-file',
      user: null,
    });
    expect(response.status).toBe(404);
  });
});

describe('API', () => {
  it('describes the session', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const { call } = await setupHandler({ label: 'staging' });
    expect(await body(await call('/api/session'))).toEqual({
      label: 'staging',
      user: { id: 'dev-1' },
      runtime: 'test',
      environment: 'production',
      environments: ['production', 'staging', 'development'],
      defaultLocale: 'id-ID',
      kinds: ['CONFIG', 'EMAIL_TEMPLATE', 'MESSAGE_TEMPLATE'],
      statuses: ['DRAFT', 'PUBLISHED', 'DISABLED'],
      channels: ['WHATSAPP', 'SMS', 'PUSH', 'IN_APP'],
      timeZone: 'UTC',
      sendTest: false,
      providerSync: false,
    });
    vi.stubEnv('NODE_ENV', undefined);
    const plain = await setupHandler();
    const anonymous = await body(await plain.call('/api/session', {}, null));
    expect(anonymous).toMatchObject({ label: null, user: null, runtime: 'development' });
  });

  it('requires the CSRF header for changes', async () => {
    const { call } = await setupHandler();
    const response = await call('/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'x', schema: {}, value: 1 }),
    });
    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({ error: 'Missing the x-laci-studio header.' });
  });

  describe('GET api/entries', () => {
    const list = async (query: string) => {
      const { call } = await setupHandler();
      const response = await call(`/api/entries${query}`);
      return { response, page: await body<Paginated<Entry>>(response.clone()) };
    };
    const keys = (page: Paginated<Entry>) =>
      page.items.map((entry) => `${entry.key}/${entry.environment}`);

    it('lists entries in every status', async () => {
      const { page } = await list('');
      expect(page.total).toBe(4);
      expect(keys(page)).toEqual([
        'approval-request/production',
        'customerCategoryColor/production',
        'customerCategoryColor/staging',
        'linkPath/production',
      ]);
    });

    it('filters', async () => {
      expect(keys((await list('?kind=CONFIG&environment=staging')).page)).toEqual([
        'customerCategoryColor/staging',
      ]);
      expect(keys((await list('?locale=id-ID')).page)).toEqual(['approval-request/production']);
      expect((await list('?locale=none')).page.total).toBe(3);
      expect((await list('?channel=none')).page.total).toBe(4);
      expect((await list('?channel=SMS')).page.total).toBe(0);
      expect(keys((await list('?status=DRAFT')).page)).toEqual(['linkPath/production']);
      expect((await list('?status=DRAFT,%20PUBLISHED,')).page.total).toBe(4);
      expect(keys((await list('?search=badge')).page)).toEqual([
        'customerCategoryColor/production',
      ]);
      const page = (await list('?limit=1&offset=1')).page;
      expect(page.total).toBe(4);
      expect(keys(page)).toEqual(['customerCategoryColor/production']);
    });

    it.each([
      ['?kind=OTHER', '"kind" must be one of: CONFIG, EMAIL_TEMPLATE, MESSAGE_TEMPLATE.'],
      ['?status=LIVE', '"status" must be one of: DRAFT, PUBLISHED, DISABLED.'],
      ['?channel=FAX', '"channel" must be one of: WHATSAPP, SMS, PUSH, IN_APP.'],
      ['?limit=0', '"limit" must be an integer of at least 1.'],
      ['?offset=-1', '"offset" must be an integer of at least 0.'],
      ['?limit=1.5', '"limit" must be an integer of at least 1.'],
      [
        '?environment=qa',
        'Unknown environment "qa"; configured: "production", "staging", "development".',
      ],
    ])('rejects %s', async (query, error) => {
      const { response } = await list(query);
      expect(response.status).toBe(400);
      expect((await body(response)).error).toBe(error);
    });
  });

  describe('POST api/entries', () => {
    it('creates an entry with the user as author', async () => {
      const { send, laci } = await setupHandler();
      const response = await send('POST', '/api/entries', {
        key: 'maxUpload',
        schema: { type: 'integer' },
        value: 10,
        description: 'Upload limit in MB',
        status: 'DRAFT',
        note: 'First version',
        environment: 'staging',
      });
      expect(response.status).toBe(201);
      expect(await body(response)).toMatchObject({
        key: 'maxUpload',
        environment: 'staging',
        status: 'DRAFT',
        version: 1,
        createdBy: 'dev-1',
      });
      const history = await laci.history('maxUpload', { environment: 'staging' });
      expect(history.items[0]).toMatchObject({ changedBy: 'dev-1', note: 'First version' });
    });

    it('creates templates and records anonymous users as nobody', async () => {
      const { send } = await setupHandler();
      const response = await send(
        'POST',
        '/api/entries',
        {
          key: 'reminder',
          kind: 'MESSAGE_TEMPLATE',
          channel: 'SMS',
          schema: { type: 'object' },
          value: { body: 'Hi' },
        },
        null,
      );
      expect(await body(response)).toMatchObject({
        kind: 'MESSAGE_TEMPLATE',
        locale: 'id-ID',
        channel: 'SMS',
        createdBy: null,
        status: 'PUBLISHED',
      });
    });

    it('refuses an entry that exists', async () => {
      const { send } = await setupHandler();
      const response = await send('POST', '/api/entries', {
        key: 'approval-request',
        kind: 'EMAIL_TEMPLATE',
        schema: {},
        value: {},
      });
      expect(response.status).toBe(409);
      expect(await body(response)).toEqual({
        code: 'ENTRY_EXISTS',
        error: 'Entry "approval-request" (production, id-ID) already exists.',
      });
    });

    it('reports validation problems with their paths', async () => {
      const { send } = await setupHandler();
      const response = await send('POST', '/api/entries', {
        key: 'badges',
        schema: colors.schema,
        value: [{ category: 'VIP', background: 'brown' }],
      });
      expect(response.status).toBe(422);
      expect(await body(response)).toMatchObject({
        code: 'VALIDATION_FAILED',
        target: 'value',
        issues: [{ path: '[0].background', keyword: 'format' }],
      });
    });

    it.each([
      [{ schema: {}, value: 1 }, 400, '"key" is required.'],
      [{ key: 7, schema: {}, value: 1 }, 400, '"key" must be a string.'],
      [{ key: 'x', schema: [], value: 1 }, 400, '"schema" must be a JSON Schema object.'],
      [{ key: 'x', schema: {} }, 400, '"value" is required.'],
      [
        { key: 'x', schema: {}, value: 1, status: 'LIVE' },
        400,
        '"status" must be one of: DRAFT, PUBLISHED, DISABLED.',
      ],
      [
        { key: 'x', schema: {}, value: 1, kind: 'X' },
        400,
        '"kind" must be one of: CONFIG, EMAIL_TEMPLATE, MESSAGE_TEMPLATE.',
      ],
      [
        { key: 'x', schema: {}, value: 1, environment: 'qa' },
        400,
        'Unknown environment "qa"; configured: "production", "staging", "development".',
      ],
      ['not json', 400, 'The request body is not valid JSON.'],
      ['[1]', 400, 'The request body must be a JSON object.'],
      ['x'.repeat(5_000_001), 413, 'The request body is too large.'],
    ])('rejects %j', async (payload, status, error) => {
      const { send } = await setupHandler();
      const response = await send('POST', '/api/entries', payload);
      expect(response.status).toBe(status);
      expect((await body(response)).error).toBe(error);
    });
  });

  describe('GET api/entries/:key', () => {
    it('returns drafts and templates selected by the query', async () => {
      const { call } = await setupHandler();
      expect(await body(await call('/api/entries/linkPath'))).toMatchObject({ status: 'DRAFT' });
      expect(
        await body(await call('/api/entries/approval-request?kind=EMAIL_TEMPLATE&locale=id-ID')),
      ).toMatchObject({ value: { subject: 'Halo {{ name }}' } });
      expect(
        await body(await call('/api/entries/customerCategoryColor?environment=staging')),
      ).toMatchObject({ environment: 'staging', createdBy: null });
    });

    it('answers 404 for missing entries', async () => {
      const { call } = await setupHandler();
      const response = await call('/api/entries/approval-request?kind=EMAIL_TEMPLATE&locale=en');
      expect(response.status).toBe(404);
      expect(await body(response)).toEqual({
        code: 'ENTRY_NOT_FOUND',
        error: 'Entry "approval-request" (en) does not exist or is not published.',
      });
    });

    it('decodes keys in the path', async () => {
      const { call, laci } = await setupHandler();
      await laci.define('app:links.v2', { schema: {}, value: 1 });
      expect((await call(`/api/entries/${encodeURIComponent('app:links.v2')}`)).status).toBe(200);
    });
  });

  describe('PUT api/entries/:key', () => {
    it('changes an entry as the user', async () => {
      const { send, laci } = await setupHandler();
      const response = await send('PUT', '/api/entries/linkPath', {
        value: { home: '/home' },
        status: 'PUBLISHED',
        description: 'Links',
        expectedVersion: 1,
        note: 'Publish',
      });
      expect(response.status).toBe(200);
      expect(await body(response)).toMatchObject({
        version: 2,
        status: 'PUBLISHED',
        description: 'Links',
        updatedBy: 'dev-1',
      });
      expect(await laci.get('linkPath', 'home')).toBe('/home');
      expect((await laci.history('linkPath')).items[0]?.note).toBe('Publish');
    });

    it('changes the schema, clears the description, and selects by query', async () => {
      const { send, laci } = await setupHandler();
      const response = await send('PUT', '/api/entries/customerCategoryColor?environment=staging', {
        schema: { type: 'array' },
        description: null,
        expectedVersion: 1,
      });
      expect(await body(response)).toMatchObject({ schema: { type: 'array' }, description: null });
      expect((await laci.getEntry('customerCategoryColor'))?.version).toBe(1);
      const empty = await send('PUT', '/api/entries/customerCategoryColor', {
        description: '',
        expectedVersion: 1,
      });
      expect(await body(empty)).toMatchObject({ description: null, version: 2 });
    });

    it('refuses a change based on an old version', async () => {
      const { send } = await setupHandler();
      await send('PUT', '/api/entries/linkPath', { value: { a: '/a' }, expectedVersion: 1 });
      const response = await send('PUT', '/api/entries/linkPath', {
        value: { b: '/b' },
        expectedVersion: 1,
      });
      expect(response.status).toBe(409);
      expect(await body(response)).toEqual({
        code: 'VERSION_CONFLICT',
        error:
          'Entry "linkPath" (production) was changed by someone else: expected version 1, but it is at version 2.',
        expectedVersion: 1,
        actualVersion: 2,
      });
    });

    it('rejects invalid changes', async () => {
      const { send } = await setupHandler();
      const invalid = await send('PUT', '/api/entries/customerCategoryColor', {
        value: [{ category: 'VIP' }],
        expectedVersion: 1,
      });
      expect(invalid.status).toBe(422);
      expect((await body(invalid)).issues).toEqual([
        { path: '[0].background', message: 'is required', keyword: 'required' },
      ]);
      for (const [payload, error] of [
        [{ value: 1 }, '"expectedVersion" must be an integer of at least 1.'],
        [{ value: { x: '/x' }, expectedVersion: '1' }, undefined],
        [{ schema: 'x', expectedVersion: 1 }, '"schema" must be a JSON Schema object.'],
        [{ description: 5, expectedVersion: 1 }, '"description" must be a string.'],
      ] as const) {
        const response = await send('PUT', '/api/entries/linkPath', payload);
        if (error === undefined) expect(response.status).toBe(200);
        else expect((await body(response)).error).toBe(error);
      }
      expect(
        (await send('PUT', '/api/entries/missing', { value: 1, expectedVersion: 1 })).status,
      ).toBe(404);
    });
  });

  describe('history and rollback', () => {
    it('lists versions and rolls back', async () => {
      const { send, call, laci } = await setupHandler();
      await laci.set('linkPath', { home: '/v2' });
      await laci.set('linkPath', { home: '/v3' });
      const history = await body<Paginated<EntryHistory>>(
        await call('/api/entries/linkPath/history'),
      );
      expect(history.items.map((item) => item.version)).toEqual([3, 2, 1]);
      const page = await body<Paginated<EntryHistory>>(
        await call('/api/entries/linkPath/history?limit=1&offset=1'),
      );
      expect(page).toMatchObject({ total: 3, items: [{ version: 2 }] });

      const rolledBack = await send('POST', '/api/entries/linkPath/rollback', {
        version: 1,
        expectedVersion: 3,
        note: 'Undo',
      });
      expect(rolledBack.status).toBe(200);
      expect(await body(rolledBack)).toMatchObject({
        version: 4,
        value: { home: '/' },
        updatedBy: 'dev-1',
      });
      expect((await laci.history('linkPath')).items[0]).toMatchObject({
        note: 'Undo',
        changedBy: 'dev-1',
      });

      const plain = await send('POST', '/api/entries/linkPath/rollback', {
        version: 2,
        expectedVersion: 4,
      });
      expect((await laci.history('linkPath')).items[0]?.note).toBe('Rolled back to version 2');
      expect(plain.status).toBe(200);
    });

    it('rejects unknown versions, conflicts, and bad input', async () => {
      const { send, call } = await setupHandler();
      const missing = await send('POST', '/api/entries/linkPath/rollback', {
        version: 9,
        expectedVersion: 1,
      });
      expect(missing.status).toBe(404);
      expect((await body(missing)).error).toBe('Entry "linkPath" (production) has no version 9.');
      const conflict = await send('POST', '/api/entries/linkPath/rollback', {
        version: 1,
        expectedVersion: 5,
      });
      expect(conflict.status).toBe(409);
      const bad = await send('POST', '/api/entries/linkPath/rollback', {
        version: 0,
        expectedVersion: 1,
      });
      expect((await body(bad)).error).toBe('"version" must be an integer of at least 1.');
      expect((await call('/api/entries/linkPath/history?limit=x')).status).toBe(400);
      expect((await call('/api/entries/linkPath/history?offset=x')).status).toBe(400);
      expect((await call('/api/entries/missing/history')).status).toBe(404);
    });
  });

  it('answers 404 for unknown routes and methods', async () => {
    const { call, send } = await setupHandler();
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/entries/linkPath/nope')).status).toBe(404);
    expect((await call('/api/entries/linkPath/history/1')).status).toBe(404);
    expect((await send('DELETE', '/api/entries/linkPath', {})).status).toBe(404);
    expect((await send('PATCH', '/api/entries', {})).status).toBe(404);
    expect((await send('POST', '/api/entries/linkPath/history', {})).status).toBe(404);
  });

  it('reports a conflict without a known stored version as null', async () => {
    const laci = await createTestLaci();
    vi.spyOn(laci, 'update').mockRejectedValue(
      new VersionConflictError(
        { key: 'linkPath', environment: 'production', locale: null, channel: null },
        1,
      ),
    );
    const { send } = await setupHandler({ laci });
    const response = await send('PUT', '/api/entries/linkPath', { value: {}, expectedVersion: 1 });
    expect(await body(response)).toMatchObject({ expectedVersion: 1, actualVersion: null });
  });

  it('answers 500 and logs unexpected errors', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const laci = createLaci({ store: new MemoryStore() });
    vi.spyOn(laci, 'listEntries').mockRejectedValue(new Error('database down'));
    const { call } = await setupHandler({ laci });
    const response = await call('/api/entries');
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: 'Internal error; see the server log.' });
    expect(logged).toHaveBeenCalledWith('Laci Studio: request failed.', expect.any(Error));
  });
});
