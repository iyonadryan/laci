import { createLaci, EntryExistsError, VersionConflictError } from '@lacijs/core';
import type { Entry, LaciStore } from '@lacijs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entry, historyOf, insert, time, update } from './fixtures';

export { entry, historyOf, insert, time, update } from './fixtures';

/** How the contract suite gets a store. */
export interface StoreHarness {
  /** Prepares the backend once (e.g. connect and migrate). */
  setup?(): Promise<void>;
  /** Returns a store over empty storage. Called before every test. */
  create(): Promise<LaciStore> | LaciStore;
  /** Releases resources after the suite. */
  teardown?(): Promise<void>;
}

const address = (source: Entry) => ({
  key: source.key,
  environment: source.environment,
  locale: source.locale,
  channel: source.channel,
});

/**
 * The behaviour every `LaciStore` must have. Call it from a test file of an adapter:
 * `describeStoreContract('PostgresStore', harness)`.
 */
export function describeStoreContract(name: string, harness: StoreHarness): void {
  describe(`${name} (store contract)`, () => {
    let store: LaciStore;

    beforeAll(async () => {
      await harness.setup?.();
    });
    beforeEach(async () => {
      store = await harness.create();
    });
    afterAll(async () => {
      await harness.teardown?.();
    });

    describe('entries', () => {
      it('returns null for a missing entry', async () => {
        expect(
          await store.getEntry({
            key: 'nope',
            environment: 'production',
            locale: null,
            channel: null,
          }),
        ).toBeNull();
      });

      it('round-trips every field exactly, including the order of object keys', async () => {
        const stored = entry();
        await store.write([insert(stored)]);
        const loaded = await store.getEntry(address(stored));
        expect(loaded).toEqual(stored);
        expect(JSON.stringify(loaded?.value)).toBe(JSON.stringify(stored.value));
        expect(JSON.stringify(loaded?.schema)).toBe(JSON.stringify(stored.schema));
        expect(loaded?.createdAt).toBeInstanceOf(Date);
      });

      it('round-trips scalar values, empty containers, and null fields', async () => {
        const values = ['text', 42, 1.5, true, false, null, [], {}, ''];
        for (const [index, value] of values.entries()) {
          const stored = entry({
            key: `scalar${index}`,
            value,
            description: null,
            createdBy: null,
            updatedBy: null,
          });
          await store.write([insert(stored)]);
          expect(await store.getEntry(address(stored))).toEqual(stored);
        }
      });

      it('round-trips templates with locale and channel', async () => {
        const email = entry({
          key: 'approval-request',
          kind: 'EMAIL_TEMPLATE',
          locale: 'id-ID',
          value: { subject: 'Halo {{ name }}' },
        });
        const sms = entry({
          key: 'reminder',
          kind: 'MESSAGE_TEMPLATE',
          locale: 'en',
          channel: 'SMS',
          status: 'DRAFT',
        });
        await store.write([insert(email), insert(sms)]);
        expect(await store.getEntry(address(email))).toEqual(email);
        expect(await store.getEntry(address(sms))).toEqual(sms);
        expect(await store.getEntry({ ...address(sms), channel: 'PUSH' })).toBeNull();
        expect(await store.getEntry({ ...address(email), locale: null })).toBeNull();
      });

      it('keeps a large value with multi-byte text', async () => {
        const value = Array.from({ length: 2000 }, (_, i) => ({
          i,
          text: `Ñandú ${'é'.repeat(100)} 🚀`,
        }));
        const stored = entry({ value });
        await store.write([insert(stored)]);
        expect((await store.getEntry(address(stored)))?.value).toEqual(value);
      });

      it('returns copies that do not share state with the store', async () => {
        const stored = entry();
        await store.write([insert(stored)]);
        const loaded = (await store.getEntry(address(stored)))!;
        (loaded.value as unknown[]).push('changed');
        loaded.createdAt.setFullYear(2000);
        expect(await store.getEntry(address(stored))).toEqual(stored);
      });
    });

    describe('uniqueness of (key, environment, locale, channel)', () => {
      it('treats a null locale and channel as one value', async () => {
        await store.write([insert(entry())]);
        await expect(store.write([insert(entry())])).rejects.toThrow(EntryExistsError);
      });

      it('allows the same key in another environment, locale, or channel', async () => {
        await store.write([
          insert(entry()),
          insert(entry({ environment: 'staging' })),
          insert(entry({ key: 't', kind: 'EMAIL_TEMPLATE', locale: 'en' })),
          insert(entry({ key: 't', kind: 'EMAIL_TEMPLATE', locale: 'id-ID' })),
          insert(entry({ key: 't', kind: 'MESSAGE_TEMPLATE', locale: 'en', channel: 'SMS' })),
          insert(entry({ key: 't', kind: 'MESSAGE_TEMPLATE', locale: 'en', channel: 'WHATSAPP' })),
        ]);
        expect((await store.listEntries()).total).toBe(6);
        await expect(
          store.write([
            insert(entry({ key: 't', kind: 'MESSAGE_TEMPLATE', locale: 'en', channel: 'SMS' })),
          ]),
        ).rejects.toThrow(EntryExistsError);
        await expect(
          store.write([insert(entry({ key: 't', kind: 'EMAIL_TEMPLATE', locale: 'id-ID' }))]),
        ).rejects.toThrow(EntryExistsError);
      });

      it('treats keys as case-sensitive', async () => {
        await store.write([insert(entry({ key: 'linkPath' })), insert(entry({ key: 'linkpath' }))]);
        expect((await store.listEntries()).total).toBe(2);
      });

      it('reports a duplicate with the key', async () => {
        await store.write([insert(entry())]);
        await expect(store.write([insert(entry())])).rejects.toMatchObject({
          code: 'ENTRY_EXISTS',
          key: 'customerLiveStream',
        });
      });
    });

    describe('updates and optimistic locking', () => {
      it('applies an update based on the stored version', async () => {
        const stored = entry();
        await store.write([insert(stored)]);
        const next = update(
          stored,
          { value: { changed: true }, status: 'DISABLED', description: null, updatedBy: 'rina' },
          'Why',
        );
        await store.write([next.write]);
        expect(await store.getEntry(address(stored))).toEqual(next.entry);
      });

      it('refuses an update based on another version and changes nothing', async () => {
        const stored = entry();
        await store.write([insert(stored)]);
        const first = update(stored, { value: 1 });
        await store.write([first.write]);
        const stale = update(stored, { value: 2 });
        const error = await store.write([stale.write]).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(VersionConflictError);
        expect(error).toMatchObject({ key: stored.key, expectedVersion: 1 });
        expect((await store.getEntry(address(stored)))?.value).toBe(1);
        expect((await store.listHistory(stored.id)).total).toBe(2);
      });

      it('refuses an update of a missing entry', async () => {
        await expect(store.write([update(entry()).write])).rejects.toThrow(VersionConflictError);
      });

      it('lets exactly one of two concurrent updates win', async () => {
        const stored = entry();
        await store.write([insert(stored)]);
        const results = await Promise.allSettled([
          store.write([update(stored, { value: 'a' }).write]),
          store.write([update(stored, { value: 'b' }).write]),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(VersionConflictError);
        expect((await store.listHistory(stored.id)).total).toBe(2);
      });
    });

    describe('atomic writes', () => {
      it('writes several changes at once', async () => {
        const a = entry({ key: 'a' });
        const b = entry({ key: 'b' });
        await store.write([insert(a)]);
        await store.write([update(a, { value: 'a2' }).write, insert(b)]);
        expect((await store.getEntry(address(a)))?.value).toBe('a2');
        expect((await store.getEntry(address(b)))?.version).toBe(1);
      });

      it('writes nothing when one insert is a duplicate', async () => {
        const a = entry({ key: 'a' });
        await store.write([insert(a)]);
        const b = entry({ key: 'b' });
        await expect(store.write([insert(b), insert(entry({ key: 'a' }))])).rejects.toThrow(
          EntryExistsError,
        );
        expect(await store.getEntry(address(b))).toBeNull();
      });

      it('writes nothing when one update conflicts', async () => {
        const a = entry({ key: 'a' });
        const b = entry({ key: 'b' });
        await store.write([insert(a), insert(b)]);
        await store.write([update(b, { value: 'b2' }).write]);
        await expect(
          store.write([update(a, { value: 'a2' }).write, update(b, { value: 'b3' }).write]),
        ).rejects.toThrow(VersionConflictError);
        expect((await store.getEntry(address(a)))?.value).toEqual(a.value);
        expect((await store.listHistory(a.id)).total).toBe(1);
      });

      it('accepts an empty list of changes', async () => {
        await store.write([]);
        expect((await store.listEntries()).total).toBe(0);
      });
    });

    describe('listEntries', () => {
      beforeEach(async () => {
        await store.write([
          insert(entry({ key: 'linkPath', description: 'Access links' })),
          insert(entry({ key: 'linkPath', environment: 'staging', status: 'DRAFT' })),
          insert(
            entry({
              key: 'approval',
              kind: 'EMAIL_TEMPLATE',
              locale: 'id-ID',
              description: 'Ask 50%_off',
            }),
          ),
          insert(
            entry({ key: 'approval', kind: 'EMAIL_TEMPLATE', locale: 'en-US', description: null }),
          ),
          insert(
            entry({
              key: 'reminder',
              kind: 'MESSAGE_TEMPLATE',
              locale: 'en-US',
              channel: 'WHATSAPP',
              status: 'DISABLED',
            }),
          ),
          insert(
            entry({ key: 'reminder', kind: 'MESSAGE_TEMPLATE', locale: 'en-US', channel: 'SMS' }),
          ),
        ]);
      });

      const keys = (entries: Entry[]) =>
        entries.map((item) =>
          [item.key, item.environment, item.locale, item.channel]
            .filter((part) => part !== null)
            .join('/'),
        );

      it('orders by key, environment, locale, and channel', async () => {
        const page = await store.listEntries();
        expect(page.total).toBe(6);
        expect(keys(page.items)).toEqual([
          'approval/production/en-US',
          'approval/production/id-ID',
          'linkPath/production',
          'linkPath/staging',
          'reminder/production/en-US/SMS',
          'reminder/production/en-US/WHATSAPP',
        ]);
      });

      it('filters', async () => {
        expect(keys((await store.listEntries({ kind: 'CONFIG' })).items)).toEqual([
          'linkPath/production',
          'linkPath/staging',
        ]);
        expect((await store.listEntries({ key: 'approval' })).total).toBe(2);
        expect((await store.listEntries({ environment: 'staging' })).total).toBe(1);
        expect((await store.listEntries({ locale: null })).total).toBe(2);
        expect((await store.listEntries({ locale: 'en-US' })).total).toBe(3);
        expect((await store.listEntries({ channel: null })).total).toBe(4);
        expect(keys((await store.listEntries({ channel: 'SMS' })).items)).toEqual([
          'reminder/production/en-US/SMS',
        ]);
        expect((await store.listEntries({ status: 'DRAFT' })).total).toBe(1);
        expect((await store.listEntries({ status: ['DRAFT', 'DISABLED'] })).total).toBe(2);
        expect((await store.listEntries({ status: [] })).total).toBe(0);
        expect(
          (
            await store.listEntries({
              kind: 'MESSAGE_TEMPLATE',
              status: 'PUBLISHED',
              locale: 'en-US',
            })
          ).total,
        ).toBe(1);
      });

      it('searches key and description, ignoring case', async () => {
        expect(keys((await store.listEntries({ search: 'LINK' })).items)).toEqual([
          'linkPath/production',
          'linkPath/staging',
        ]);
        expect(keys((await store.listEntries({ search: 'access' })).items)).toEqual([
          'linkPath/production',
        ]);
        expect((await store.listEntries({ search: '' })).total).toBe(6);
      });

      it('treats % and _ in the search text literally', async () => {
        expect(keys((await store.listEntries({ search: '50%_' })).items)).toEqual([
          'approval/production/id-ID',
        ]);
        expect((await store.listEntries({ search: '%' })).total).toBe(1);
        expect((await store.listEntries({ search: '_' })).total).toBe(1);
      });

      it('pages', async () => {
        const page = await store.listEntries({ limit: 2, offset: 1 });
        expect(page.total).toBe(6);
        expect(keys(page.items)).toEqual(['approval/production/id-ID', 'linkPath/production']);
        expect((await store.listEntries({ offset: 10 })).items).toEqual([]);
      });
    });

    describe('history', () => {
      it('lists versions newest first, with paging', async () => {
        let current = entry();
        await store.write([insert(current)]);
        for (let i = 2; i <= 5; i++) {
          const next = update(current, { value: i, updatedBy: `user${i}` }, `change ${i}`);
          await store.write([next.write]);
          current = next.entry;
        }
        const all = await store.listHistory(current.id);
        expect(all.total).toBe(5);
        expect(all.items.map((item) => item.version)).toEqual([5, 4, 3, 2, 1]);
        expect(all.items[0]).toEqual(
          historyOf(current, { id: all.items[0]!.id, note: 'change 5' }),
        );
        const page = await store.listHistory(current.id, { limit: 2, offset: 1 });
        expect(page.total).toBe(5);
        expect(page.items.map((item) => item.value)).toEqual([4, 3]);
      });

      it('gets one version, with value and schema in their original key order', async () => {
        const stored = entry();
        const first = insert(stored);
        await store.write([first]);
        const next = update(stored, { value: { z: 1, a: 2 } }, 'reordered');
        await store.write([next.write]);
        const v1 = await store.getHistory(stored.id, 1);
        expect(v1).toEqual(first.history);
        expect(JSON.stringify(v1?.schema)).toBe(JSON.stringify(stored.schema));
        expect(JSON.stringify((await store.getHistory(stored.id, 2))?.value)).toBe('{"z":1,"a":2}');
        expect(await store.getHistory(stored.id, 3)).toBeNull();
      });

      it('is empty for an unknown entry', async () => {
        expect(await store.listHistory(entry().id)).toEqual({ items: [], total: 0 });
        expect(await store.getHistory(entry().id, 1)).toBeNull();
      });

      it('keeps the time of each change', async () => {
        const stored = entry({ updatedAt: time(5) });
        await store.write([insert(stored)]);
        expect((await store.getHistory(stored.id, 1))?.changedAt).toEqual(time(5));
      });
    });

    describe('with createLaci', () => {
      it('runs define, set, rollback, and reads', async () => {
        const laci = createLaci({ store, cache: false, environments: ['production', 'staging'] });
        await laci.define('linkPath', {
          schema: { type: 'object' },
          value: { home: '/', docs: '/docs' },
        });
        await laci.set('linkPath', { home: '/home' }, { by: 'rina' });
        await laci.rollback('linkPath', 1);
        expect(JSON.stringify(await laci.get('linkPath'))).toBe('{"home":"/","docs":"/docs"}');
        expect((await laci.history('linkPath')).items.map((item) => item.version)).toEqual([
          3, 2, 1,
        ]);
      });
    });
  });
}
