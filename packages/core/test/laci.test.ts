import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLaci,
  EntryExistsError,
  EntryNotFoundError,
  InvalidPathError,
  LaciValidationError,
  MemoryStore,
  UnexpectedValueError,
  UnknownEnvironmentError,
  VersionConflictError,
} from '../src';
import type { ChangeEvent, Laci, LaciOptions } from '../src';
import {
  approvalRequest,
  customerCategoryColor,
  customerLiveStream,
  linkPath,
  setFeatureLive,
} from './fixtures';

/** A clock that only moves when told to. */
function clock(start = '2026-10-27T00:00:00Z') {
  let time = Date.parse(start);
  return {
    now: () => new Date(time),
    advance(ms: number) {
      time += ms;
    },
  };
}

function setup(options: Partial<LaciOptions> = {}) {
  const store = new MemoryStore();
  const time = clock();
  const laci = createLaci({ store, now: time.now, ...options });
  return { store, time, laci };
}

async function seed(laci: Laci): Promise<void> {
  await laci.define('customerLiveStream', customerLiveStream);
  await laci.define('setFeatureLive', setFeatureLive);
  await laci.define('linkPath', linkPath);
  await laci.define('customerCategoryColor', customerCategoryColor);
}

describe('createLaci', () => {
  it('has defaults', () => {
    const { laci } = setup();
    expect(laci.environment).toBe('production');
    expect(laci.environments).toEqual(['production', 'staging', 'development']);
    expect(laci.defaultLocale).toBe('en-US');
    expect(laci.limits).toEqual({ maxValueBytes: 1_000_000, maxDepth: 10 });
  });

  it('rejects an environment outside `environments`', () => {
    expect(() => setup({ environment: 'qa' })).toThrow(UnknownEnvironmentError);
    expect(() => setup({ environments: [] })).toThrow('must not be empty');
    expect(setup({ environment: 'qa', environments: ['qa'] }).laci.environment).toBe('qa');
  });
});

describe('define', () => {
  it('creates an entry at version 1 with a history row', async () => {
    const { laci, time } = setup();
    const entry = await laci.define('linkPath', {
      ...linkPath,
      description: 'Links',
      by: 'iyon',
      note: 'First',
    });
    expect(entry).toMatchObject({
      key: 'linkPath',
      kind: 'CONFIG',
      environment: 'production',
      locale: null,
      channel: null,
      description: 'Links',
      status: 'PUBLISHED',
      version: 1,
      createdBy: 'iyon',
      updatedBy: 'iyon',
      createdAt: time.now(),
    });
    const history = await laci.history('linkPath');
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      entryId: entry.id,
      version: 1,
      changedBy: 'iyon',
      note: 'First',
    });
  });

  it('never overwrites an existing entry', async () => {
    const { laci } = setup();
    await laci.define('linkPath', linkPath);
    await laci.set('linkPath', { help: 'https://new.example.com' });
    const again = await laci.define('linkPath', linkPath);
    expect(again.version).toBe(2);
    expect(again.value).toEqual({ help: 'https://new.example.com' });
  });

  it('refuses a key used by another kind', async () => {
    const { laci, store } = setup();
    await laci.define('linkPath', linkPath);
    // A config and a template can only collide when written straight to the store.
    const config = (await store.getEntry({
      key: 'linkPath',
      environment: 'production',
      locale: null,
      channel: null,
    }))!;
    await store.write([
      {
        type: 'update',
        entry: { ...config, kind: 'EMAIL_TEMPLATE', version: 2 },
        expectedVersion: 1,
        history: {
          id: 'h',
          entryId: config.id,
          version: 2,
          value: config.value,
          schema: config.schema,
          status: 'PUBLISHED',
          changedBy: null,
          changedAt: new Date(),
          note: null,
        },
      },
    ]);
    await expect(laci.define('linkPath', linkPath)).rejects.toThrow(EntryExistsError);
  });

  it('returns the other entry when one is defined at the same time', async () => {
    const { laci, store } = setup();
    const other = createLaci({ store });
    const original = store.getEntry.bind(store);
    // Both see "missing", then the other one writes first.
    vi.spyOn(store, 'getEntry').mockImplementationOnce(async (address) => {
      const result = await original(address);
      await other.define('linkPath', { ...linkPath, by: 'other' });
      return result;
    });
    const entry = await laci.define('linkPath', { ...linkPath, by: 'me' });
    expect(entry.createdBy).toBe('other');
  });

  it('validates the value against the schema, with the path of each problem', async () => {
    const { laci } = setup();
    const value = structuredClone(customerLiveStream.value);
    value[0]!.sessions[0]!.slots[0]!.end = 42 as unknown as string;
    const error = await laci
      .define('customerLiveStream', { ...customerLiveStream, value })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LaciValidationError);
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      target: 'value',
      issues: [
        { path: '[0].sessions[0].slots[0].end', message: 'must be string', keyword: 'type' },
      ],
    });
    expect((error as Error).message).toBe(
      'Value of "customerLiveStream" (production) is invalid (1 issue):\n  - [0].sessions[0].slots[0].end: must be string',
    );
    expect(await laci.getEntry('customerLiveStream')).toBeNull();
  });

  it('rejects an invalid schema, key, status, locale, or limits', async () => {
    const { laci } = setup({ limits: { maxDepth: 2 } });
    await expect(laci.define('x', { schema: { type: 'nope' }, value: 1 })).rejects.toMatchObject({
      code: 'INVALID_SCHEMA',
      target: 'schema',
    });
    await expect(laci.define('bad key', { schema: {}, value: 1 })).rejects.toMatchObject({
      target: 'entry',
    });
    await expect(
      laci.define('x', { schema: {}, value: 1, status: 'LIVE' as never }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: 'status' })],
    });
    await expect(laci.define('x', { schema: {}, value: 1, locale: 'en' })).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: 'locale' })],
    });
    await expect(laci.define('x', { schema: {}, value: [[[1]]] })).rejects.toMatchObject({
      issues: [expect.objectContaining({ keyword: 'maxDepth' })],
    });
    await expect(laci.define('x', { schema: {}, value: 1, environment: 'qa' })).rejects.toThrow(
      UnknownEnvironmentError,
    );
  });

  it('stores templates with the default locale and their channel', async () => {
    const { laci } = setup({ defaultLocale: 'id-ID' });
    const email = await laci.define('approval-request', approvalRequest);
    expect(email).toMatchObject({ kind: 'EMAIL_TEMPLATE', locale: 'id-ID', channel: null });
    const message = await laci.define('reminder', {
      kind: 'MESSAGE_TEMPLATE',
      channel: 'SMS',
      locale: 'en-US',
      schema: { type: 'object' },
      value: { body: 'Hi' },
    });
    expect(message).toMatchObject({ locale: 'en-US', channel: 'SMS' });
    await expect(
      laci.define('reminder', { kind: 'MESSAGE_TEMPLATE', schema: { type: 'object' }, value: {} }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: 'channel' })],
    });
  });
});

describe('get', () => {
  let laci: Laci;
  beforeEach(async () => {
    laci = setup().laci;
    await seed(laci);
  });

  it('returns the whole value', async () => {
    expect(await laci.get('customerLiveStream')).toEqual(customerLiveStream.value);
    expect(await laci.get('linkPath')).toEqual(linkPath.value);
  });

  it('reads a path three lists deep', async () => {
    expect(await laci.get('customerLiveStream', '[0].sessions')).toEqual(
      customerLiveStream.value[0]!.sessions,
    );
    expect(await laci.get('customerLiveStream', '[0].sessions[0].slots[1].start')).toBe(
      '2026-11-01T10:30:00+07:00',
    );
    expect(await laci.get('linkPath', 'promo')).toBe('https://example.com/promo/november');
  });

  it('falls back to `default` for missing entries and paths', async () => {
    expect(await laci.get('maxUpload', { default: 10 })).toBe(10);
    expect(await laci.get('linkPath', 'nope', { default: 'https://fallback' })).toBe(
      'https://fallback',
    );
    expect(await laci.get('linkPath', 'nope')).toBeUndefined();
    expect(await laci.get('maxUpload', { default: null })).toBeNull();
  });

  it('throws for a missing entry without a default', async () => {
    await expect(laci.get('maxUpload')).rejects.toThrow(EntryNotFoundError);
    await expect(laci.get('maxUpload')).rejects.toThrow(
      'Entry "maxUpload" (production) does not exist or is not published.',
    );
  });

  it('throws for an invalid path', async () => {
    await expect(laci.get('linkPath', '[x')).rejects.toThrow(InvalidPathError);
  });

  it('returns copies, so changing the result does not change the cache', async () => {
    const links = await laci.get<Record<string, string>>('linkPath');
    links.help = 'changed';
    expect(await laci.get('linkPath', 'help')).toBe('https://help.example.com');
  });

  it('reads another environment', async () => {
    await laci.define('linkPath', {
      ...linkPath,
      value: { help: 'https://staging.example.com' },
      environment: 'staging',
    });
    expect(await laci.get('linkPath', 'help', { environment: 'staging' })).toBe(
      'https://staging.example.com',
    );
    expect(await laci.get('linkPath', 'help')).toBe('https://help.example.com');
    await expect(laci.get('linkPath', { environment: 'development' })).rejects.toThrow(
      EntryNotFoundError,
    );
    await expect(laci.get('linkPath', { environment: 'qa' })).rejects.toThrow(
      UnknownEnvironmentError,
    );
  });

  it('only reads published entries', async () => {
    await laci.define('draftConfig', { schema: {}, value: 1, status: 'DRAFT' });
    await expect(laci.get('draftConfig')).rejects.toThrow(EntryNotFoundError);
    expect(await laci.get('draftConfig', { default: 0 })).toBe(0);
    await expect(laci.find('draftConfig', {})).rejects.toThrow(EntryNotFoundError);
    await expect(laci.isLive('draftConfig')).rejects.toThrow(EntryNotFoundError);
    expect((await laci.getEntry('draftConfig'))?.status).toBe('DRAFT');

    await laci.update('draftConfig', { status: 'PUBLISHED' });
    expect(await laci.get('draftConfig')).toBe(1);
    await laci.update('draftConfig', { status: 'DISABLED' });
    await expect(laci.get('draftConfig')).rejects.toThrow(EntryNotFoundError);
  });

  it('does not read templates as configs', async () => {
    await laci.define('approval-request', { ...approvalRequest, locale: 'en' });
    expect(await laci.getEntry('approval-request')).toBeNull();
    await expect(laci.get('approval-request')).rejects.toThrow(EntryNotFoundError);
  });
});

describe('find', () => {
  let laci: Laci;
  beforeEach(async () => {
    laci = setup().laci;
    await seed(laci);
  });

  it('finds an item of a list by its fields', async () => {
    expect(await laci.find('customerCategoryColor', { category: 'VIP' })).toEqual({
      category: 'VIP',
      label: 'VIP',
      background: '#8A5A44',
      text: '#FFFFFF',
    });
    expect(
      await laci.find('customerCategoryColor', { category: 'NEW', text: '#1D6B3A' }),
    ).toMatchObject({ label: 'Customer Baru' });
    expect(await laci.find('customerCategoryColor', { category: 'GOLD' })).toBeUndefined();
    expect(
      await laci.find('customerCategoryColor', { category: 'VIP', text: '#000000' }),
    ).toBeUndefined();
  });

  it('finds inside a nested list with `path`', async () => {
    expect(
      await laci.find('customerLiveStream', { title: 'Q&A' }, { path: '[1].sessions' }),
    ).toMatchObject({
      slots: [{ start: '2026-11-02T19:00:00+07:00' }],
    });
  });

  it('throws when the value is not a list', async () => {
    await expect(laci.find('linkPath', { help: 'x' })).rejects.toThrow(UnexpectedValueError);
    await expect(
      laci.find('customerLiveStream', { a: 1 }, { path: '[9].sessions' }),
    ).rejects.toThrow('at "[9].sessions" is missing');
    await expect(laci.find('missing', { a: 1 })).rejects.toThrow(EntryNotFoundError);
  });
});

describe('isLive', () => {
  it('compares now with the stored moment, independent of time zones', async () => {
    const { laci } = setup();
    await seed(laci);
    // 2026-11-01T00:00:00+07:00 is 2026-10-31T17:00:00Z.
    expect(await laci.isLive('setFeatureLive', { now: new Date('2026-10-31T16:59:59.999Z') })).toBe(
      false,
    );
    expect(await laci.isLive('setFeatureLive', { now: new Date('2026-10-31T17:00:00.000Z') })).toBe(
      true,
    );
    expect(
      await laci.isLive('setFeatureLive', { now: new Date('2026-11-01T00:00:00+07:00') }),
    ).toBe(true);
    expect(
      await laci.isLive('setFeatureLive', { now: new Date('2026-10-31T23:59:59+07:00') }),
    ).toBe(false);
  });

  it('uses the clock by default', async () => {
    const { laci, time } = setup();
    await seed(laci);
    expect(await laci.isLive('setFeatureLive')).toBe(false); // 2026-10-27
    time.advance(5 * 24 * 60 * 60 * 1000);
    expect(await laci.isLive('setFeatureLive')).toBe(true); // 2026-11-01
  });

  it('treats null as not live and reads a path', async () => {
    const { laci } = setup();
    await laci.define('flag', { schema: setFeatureLive.schema, value: null });
    expect(await laci.isLive('flag')).toBe(false);
    await laci.define('feature', { schema: {}, value: { liveAt: '2026-01-01T00:00:00Z' } });
    expect(await laci.isLive('feature', { path: 'liveAt' })).toBe(true);
  });

  it('throws for dates without an offset, unless missing with a default', async () => {
    const { laci } = setup();
    await laci.define('noOffset', { schema: {}, value: '2026-11-01T00:00:00' });
    await expect(laci.isLive('noOffset')).rejects.toThrow(UnexpectedValueError);
    await expect(laci.isLive('noOffset')).rejects.toThrow('is "2026-11-01T00:00:00"');
    await laci.define('obj', { schema: {}, value: {} });
    await expect(laci.isLive('obj', { path: 'liveAt' })).rejects.toThrow('at "liveAt" is missing');
    expect(await laci.isLive('missing', { default: true })).toBe(true);
    await expect(laci.isLive('missing')).rejects.toThrow(EntryNotFoundError);
  });
});

describe('set and update', () => {
  it('replaces the value as a new version', async () => {
    const { laci, time } = setup();
    await seed(laci);
    time.advance(1000);
    const value = structuredClone(customerLiveStream.value);
    value[0]!.sessions[0]!.slots.push({
      start: '2026-11-01T13:00:00+07:00',
      end: '2026-11-01T14:00:00+07:00',
      host: 'Rina',
    });
    const entry = await laci.set('customerLiveStream', value, { by: 'rina', note: 'Add a slot' });
    expect(entry).toMatchObject({
      version: 2,
      updatedBy: 'rina',
      createdBy: null,
      updatedAt: time.now(),
    });
    expect(await laci.get('customerLiveStream', '[0].sessions[0].slots')).toHaveLength(3);
    const history = await laci.history('customerLiveStream');
    expect(history.items.map((item) => [item.version, item.note])).toEqual([
      [2, 'Add a slot'],
      [1, null],
    ]);
  });

  it('validates the new value and keeps the old one when it fails', async () => {
    const { laci } = setup();
    await seed(laci);
    const value = [
      ...customerCategoryColor.value,
      { category: 'VIP', label: 'Dup', background: '#000', text: '#fff' },
    ];
    await expect(laci.set('customerCategoryColor', value)).rejects.toMatchObject({
      issues: [{ path: '[3].category', keyword: 'uniqueBy' }],
    });
    expect(await laci.get('customerCategoryColor')).toEqual(customerCategoryColor.value);
  });

  it('changes schema and value together', async () => {
    const { laci } = setup();
    await laci.define('maxUpload', { schema: { type: 'integer' }, value: 10 });
    await expect(laci.update('maxUpload', { schema: { type: 'string' } })).rejects.toThrow(
      LaciValidationError,
    );
    const entry = await laci.update('maxUpload', {
      schema: { type: 'string' },
      value: '10MB',
      description: 'Upload limit',
    });
    expect(entry).toMatchObject({ version: 2, value: '10MB', description: 'Upload limit' });
    expect((await laci.update('maxUpload', { description: null })).description).toBeNull();
  });

  it('does not create a version when nothing changes', async () => {
    const { laci } = setup();
    await seed(laci);
    const entry = await laci.set('linkPath', structuredClone(linkPath.value));
    expect(entry.version).toBe(1);
    expect((await laci.history('linkPath')).total).toBe(1);
  });

  it('throws for missing entries', async () => {
    const { laci } = setup();
    await expect(laci.set('nope', 1)).rejects.toThrow(EntryNotFoundError);
    await expect(laci.history('nope')).rejects.toThrow(EntryNotFoundError);
  });
});

describe('optimistic locking', () => {
  it('refuses a change based on an old version', async () => {
    const { laci } = setup();
    await seed(laci);
    await laci.set('linkPath', { help: 'https://a.example.com' }, { expectedVersion: 1 });
    const error = await laci
      .set('linkPath', { help: 'https://b.example.com' }, { expectedVersion: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VersionConflictError);
    expect(error).toMatchObject({ code: 'VERSION_CONFLICT', expectedVersion: 1, actualVersion: 2 });
    expect(await laci.get('linkPath', 'help')).toBe('https://a.example.com');
  });

  it('refuses the slower of two concurrent writes', async () => {
    const { laci, store } = setup();
    await seed(laci);
    const other = createLaci({ store });
    const write = store.write.bind(store);
    // The other instance saves between our read and our write.
    vi.spyOn(store, 'write').mockImplementationOnce(async (changes) => {
      await other.set('linkPath', { help: 'https://other.example.com' });
      return write(changes);
    });
    await expect(laci.set('linkPath', { help: 'https://mine.example.com' })).rejects.toThrow(
      VersionConflictError,
    );
    expect(await laci.get('linkPath', 'help')).toBe('https://other.example.com');
  });
});

describe('rollback', () => {
  it('restores the value and schema of an earlier version as a new version', async () => {
    const { laci } = setup();
    await laci.define('maxUpload', { schema: { type: 'integer' }, value: 10 });
    await laci.set('maxUpload', 20);
    await laci.update('maxUpload', { schema: { type: 'string' }, value: '30MB' });
    const entry = await laci.rollback('maxUpload', 1, { by: 'iyon' });
    expect(entry).toMatchObject({
      version: 4,
      value: 10,
      schema: { type: 'integer' },
      updatedBy: 'iyon',
    });
    expect(await laci.get('maxUpload')).toBe(10);
    const [latest] = (await laci.history('maxUpload')).items;
    expect(latest).toMatchObject({
      version: 4,
      note: 'Rolled back to version 1',
      changedBy: 'iyon',
    });

    await laci.rollback('maxUpload', 2, { note: 'Back to 20' });
    expect(await laci.get('maxUpload')).toBe(20);
    expect((await laci.history('maxUpload', { limit: 1 })).items[0]?.note).toBe('Back to 20');
  });

  it('keeps the current status and honours expectedVersion', async () => {
    const { laci } = setup();
    await laci.define('maxUpload', { schema: { type: 'integer' }, value: 10 });
    await laci.update('maxUpload', { value: 20, status: 'DISABLED' });
    expect((await laci.rollback('maxUpload', 1)).status).toBe('DISABLED');
    await expect(laci.rollback('maxUpload', 1, { expectedVersion: 2 })).rejects.toThrow(
      VersionConflictError,
    );
    await expect(laci.rollback('maxUpload', 9)).rejects.toThrow('has no version 9');
  });
});

describe('history', () => {
  it('pages newest first', async () => {
    const { laci } = setup();
    await laci.define('n', { schema: { type: 'integer' }, value: 0 });
    for (let i = 1; i <= 4; i++) await laci.set('n', i);
    const page = await laci.history('n', { limit: 2, offset: 1 });
    expect(page.total).toBe(5);
    expect(page.items.map((item) => item.value)).toEqual([3, 2]);
  });
});

describe('listEntries', () => {
  it('filters by kind, environment, status, and text', async () => {
    const { laci } = setup();
    await seed(laci);
    await laci.define('linkPath', { ...linkPath, environment: 'staging' });
    await laci.define('approval-request', { ...approvalRequest, description: 'Ask a manager' });
    expect((await laci.listEntries({ kind: 'CONFIG', environment: 'production' })).total).toBe(4);
    expect((await laci.listEntries({ search: 'LINK' })).items.map((e) => e.environment)).toEqual([
      'production',
      'staging',
    ]);
    expect((await laci.listEntries({ search: 'manager' })).items[0]?.key).toBe('approval-request');
    await expect(laci.listEntries({ environment: 'qa' })).rejects.toThrow(UnknownEnvironmentError);
  });
});

describe('cache', () => {
  function counted(options: Partial<LaciOptions> = {}) {
    const result = setup(options);
    const reads = vi.spyOn(result.store, 'getEntry');
    return { ...result, reads };
  }

  it('serves repeated reads from memory until the TTL ends', async () => {
    const { laci, reads, time } = counted({ cache: { ttlMs: 1000 } });
    await seed(laci);
    reads.mockClear();
    await laci.get('linkPath');
    await laci.get('linkPath', 'help');
    await laci.find('customerCategoryColor', { category: 'VIP' });
    await laci.find('customerCategoryColor', { category: 'NEW' });
    expect(reads).toHaveBeenCalledTimes(2);
    time.advance(1000);
    await laci.get('linkPath');
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it('caches missing entries too', async () => {
    const { laci, reads } = counted();
    expect(await laci.get('maxUpload', { default: 1 })).toBe(1);
    expect(await laci.get('maxUpload', { default: 1 })).toBe(1);
    expect(reads).toHaveBeenCalledTimes(1);
    await laci.define('maxUpload', { schema: {}, value: 5 });
    expect(await laci.get('maxUpload', { default: 1 })).toBe(5);
  });

  it('is invalidated by set, update, and rollback on the same instance', async () => {
    const { laci } = counted();
    await laci.define('n', { schema: {}, value: 1 });
    expect(await laci.get('n')).toBe(1);
    await laci.set('n', 2);
    expect(await laci.get('n')).toBe(2);
    await laci.update('n', { status: 'DISABLED' });
    expect(await laci.get('n', { default: 0 })).toBe(0);
    await laci.update('n', { status: 'PUBLISHED' });
    await laci.rollback('n', 1);
    expect(await laci.get('n')).toBe(1);
  });

  it('is invalidated after a version conflict', async () => {
    const { laci, store } = counted();
    await laci.define('n', { schema: {}, value: 1 });
    expect(await laci.get('n')).toBe(1);
    await createLaci({ store }).set('n', 2);
    expect(await laci.get('n')).toBe(1); // stale
    await expect(laci.set('n', 3, { expectedVersion: 1 })).rejects.toThrow(VersionConflictError);
    expect(await laci.get('n')).toBe(2);

    // Also when the store detects the conflict.
    const write = store.write.bind(store);
    vi.spyOn(store, 'write').mockImplementationOnce(async (changes) => {
      await createLaci({ store }).set('n', 4);
      return write(changes);
    });
    await expect(laci.set('n', 3)).rejects.toThrow(VersionConflictError);
    expect(await laci.get('n')).toBe(4);
  });

  it('keeps environments, locales, and channels apart', async () => {
    const { laci, reads } = counted();
    await laci.define('linkPath', linkPath);
    await laci.define('linkPath', {
      ...linkPath,
      value: { help: 'https://staging' },
      environment: 'staging',
    });
    expect(await laci.get('linkPath', 'help')).toBe('https://help.example.com');
    expect(await laci.get('linkPath', 'help', { environment: 'staging' })).toBe('https://staging');

    // Changing staging leaves the cached production value alone, and vice versa.
    reads.mockClear();
    await laci.set('linkPath', { help: 'https://staging2' }, { environment: 'staging' });
    expect(await laci.get('linkPath', 'help')).toBe('https://help.example.com');
    expect(await laci.get('linkPath', 'help', { environment: 'staging' })).toBe('https://staging2');
    // One read inside set (staging), one for the dropped staging value; production stays cached.
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('can be invalidated from outside, e.g. by another server instance', async () => {
    const { laci, store } = counted();
    const other = createLaci({ store });
    await laci.define('n', { schema: {}, value: 1 });
    await laci.define('n', { schema: {}, value: 10, environment: 'staging' });
    expect(await laci.get('n')).toBe(1);
    expect(await laci.get('n', { environment: 'staging' })).toBe(10);
    await other.set('n', 2);
    await other.set('n', 20, { environment: 'staging' });
    expect(await laci.get('n')).toBe(1); // stale until the TTL ends...
    laci.invalidate({ key: 'n', environment: 'production' });
    expect(await laci.get('n')).toBe(2); // ...or until invalidated
    expect(await laci.get('n', { environment: 'staging' })).toBe(10);
    laci.invalidate();
    expect(await laci.get('n', { environment: 'staging' })).toBe(20);
  });

  it('can be turned off', async () => {
    const { laci, reads } = counted({ cache: false });
    await laci.define('n', { schema: {}, value: 1 });
    reads.mockClear();
    await laci.get('n');
    await laci.get('n');
    expect(reads).toHaveBeenCalledTimes(2);
    laci.invalidate();
  });
});

describe('onChange', () => {
  it('reports every change', async () => {
    const events: ChangeEvent[] = [];
    const { laci } = setup({ onChange: (event) => void events.push(event) });
    await laci.define('n', { schema: {}, value: 1 });
    await laci.define('n', { schema: {}, value: 1 }); // exists: no event
    await laci.set('n', 2);
    await laci.set('n', 2); // unchanged: no event
    await laci.rollback('n', 1);
    expect(events.map((event) => [event.type, event.previousVersion, event.entry.version])).toEqual(
      [
        ['define', null, 1],
        ['update', 1, 2],
        ['rollback', 2, 3],
      ],
    );
  });

  it('reports handler errors without failing the change', async () => {
    const onChangeError = vi.fn();
    const { laci } = setup({
      onChange: () => {
        throw new Error('redis down');
      },
      onChangeError,
    });
    await laci.define('n', { schema: {}, value: 1 });
    expect(onChangeError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'redis down' }),
      expect.objectContaining({ type: 'define' }),
    );

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { laci: plain } = setup({ onChange: () => Promise.reject(new Error('x')) });
    await plain.define('n', { schema: {}, value: 1 });
    expect(consoleError).toHaveBeenCalledWith('Laci: onChange failed', expect.any(Error));
    consoleError.mockRestore();
  });
});

describe('error paths', () => {
  it('refuses an invalid status in update', async () => {
    const { laci } = setup();
    await laci.define('n', { schema: {}, value: 1 });
    await expect(laci.update('n', { status: 'LIVE' as never })).rejects.toMatchObject({
      target: 'entry',
      issues: [expect.objectContaining({ path: 'status' })],
    });
    expect((await laci.getEntry('n'))?.version).toBe(1);
  });

  it('passes store errors through from define', async () => {
    const { laci, store } = setup();
    vi.spyOn(store, 'write').mockRejectedValueOnce(new Error('disk full'));
    await expect(laci.define('n', { schema: {}, value: 1 })).rejects.toThrow('disk full');
  });

  it('rethrows a duplicate that cannot be read back as the same kind', async () => {
    const { laci, store } = setup();
    vi.spyOn(store, 'write').mockRejectedValueOnce(
      new EntryExistsError({ key: 'n', environment: 'production', locale: null, channel: null }),
    );
    await expect(laci.define('n', { schema: {}, value: 1 })).rejects.toThrow(EntryExistsError);
  });
});
