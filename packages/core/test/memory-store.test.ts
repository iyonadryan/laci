import { describe, expect, it } from 'vitest';
import { EntryExistsError, MemoryStore, VersionConflictError } from '../src';
import type { Entry, EntryHistory, EntryWrite } from '../src';

// The full behaviour is covered by the shared contract in @lacijs/store-tests; these tests cover
// the MemoryStore code paths from inside core.

let ids = 0;

function entry(overrides: Partial<Entry> = {}): Entry {
  const at = new Date('2026-10-27T00:00:00Z');
  return {
    id: `id-${++ids}`,
    key: 'linkPath',
    kind: 'CONFIG',
    environment: 'production',
    locale: null,
    channel: null,
    description: null,
    schema: {},
    value: { home: '/' },
    status: 'PUBLISHED',
    version: 1,
    createdBy: null,
    updatedBy: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function history(source: Entry): EntryHistory {
  return {
    id: `h-${source.id}-${source.version}`,
    entryId: source.id,
    version: source.version,
    value: source.value,
    schema: source.schema,
    status: source.status,
    changedBy: null,
    changedAt: source.updatedAt,
    note: null,
  };
}

const insert = (source: Entry): EntryWrite => ({
  type: 'insert',
  entry: source,
  history: history(source),
});
const update = (source: Entry, changes: Partial<Entry> = {}): EntryWrite => {
  const next = { ...source, version: source.version + 1, ...changes };
  return { type: 'update', entry: next, expectedVersion: source.version, history: history(next) };
};

describe('MemoryStore', () => {
  it('filters entries by every field', async () => {
    const store = new MemoryStore();
    await store.write([
      insert(entry({ key: 'b', description: 'Second' })),
      insert(entry({ key: 'a', environment: 'staging', status: 'DRAFT' })),
      insert(entry({ key: 't', kind: 'EMAIL_TEMPLATE', locale: 'en' })),
      insert(entry({ key: 't', kind: 'MESSAGE_TEMPLATE', locale: 'en', channel: 'SMS' })),
    ]);
    const keys = async (query: Parameters<MemoryStore['listEntries']>[0]) =>
      (await store.listEntries(query)).items.map((item) => `${item.key}/${item.kind}`);

    expect(await keys({})).toEqual([
      'a/CONFIG',
      'b/CONFIG',
      't/EMAIL_TEMPLATE',
      't/MESSAGE_TEMPLATE',
    ]);
    expect(await keys({ kind: 'EMAIL_TEMPLATE' })).toEqual(['t/EMAIL_TEMPLATE']);
    expect(await keys({ key: 'b' })).toEqual(['b/CONFIG']);
    expect(await keys({ environment: 'staging' })).toEqual(['a/CONFIG']);
    expect(await keys({ locale: 'en' })).toEqual(['t/EMAIL_TEMPLATE', 't/MESSAGE_TEMPLATE']);
    expect(await keys({ locale: null })).toEqual(['a/CONFIG', 'b/CONFIG']);
    expect(await keys({ channel: 'SMS' })).toEqual(['t/MESSAGE_TEMPLATE']);
    expect(await keys({ channel: null, locale: 'en' })).toEqual(['t/EMAIL_TEMPLATE']);
    expect(await keys({ status: 'DRAFT' })).toEqual(['a/CONFIG']);
    expect(await keys({ status: ['PUBLISHED'], kind: 'CONFIG' })).toEqual(['b/CONFIG']);
    expect(await keys({ search: 'SECOND' })).toEqual(['b/CONFIG']);
    expect(await keys({ search: 'zzz' })).toEqual([]);
    expect(await keys({ search: '' })).toHaveLength(4);
  });

  it('orders by key, then environment, locale, and channel', async () => {
    const store = new MemoryStore();
    await store.write([
      insert(entry({ key: 'a', environment: 'staging' })),
      insert(entry({ key: 'ab' })),
      insert(entry({ key: 'a', environment: 'production' })),
      insert(entry({ key: 'B' })),
    ]);
    const page = await store.listEntries();
    expect(page.items.map((item) => `${item.key}/${item.environment}`)).toEqual([
      'B/production',
      'a/production',
      'a/staging',
      'ab/production',
    ]);
  });

  it('checks several changes to one entry in one write in order', async () => {
    const store = new MemoryStore();
    const first = entry();
    const second = update(first, { value: 2 });
    await store.write([insert(first), second, update(second.entry, { value: 3 })]);
    expect((await store.listHistory(first.id)).items.map((item) => item.version)).toEqual([
      3, 2, 1,
    ]);

    const other = entry({ key: 'other' });
    await expect(store.write([insert(other), insert(entry({ key: 'other' }))])).rejects.toThrow(
      EntryExistsError,
    );
    await expect(store.write([insert(other), update(other), update(other)])).rejects.toThrow(
      VersionConflictError,
    );
    expect((await store.listEntries({ key: 'other' })).total).toBe(0);
  });

  it('has no history for unknown entries', async () => {
    const store = new MemoryStore();
    expect(await store.listHistory('missing')).toEqual({ items: [], total: 0 });
    expect(await store.getHistory('missing', 1)).toBeNull();
  });
});
