import { uuidv7 } from '@lacijs/core';
import type { Entry, EntryHistory, EntryWrite } from '@lacijs/core';

/** A fixed moment with milliseconds, which every adapter must keep. */
export function time(offsetMs = 0): Date {
  return new Date(Date.parse('2026-10-27T03:04:05.678Z') + offsetMs);
}

/** A config entry at version 1; override any field. */
export function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: uuidv7(),
    key: 'customerLiveStream',
    kind: 'CONFIG',
    environment: 'production',
    locale: null,
    channel: null,
    description: 'Customers that are live',
    // Keys deliberately not in alphabetical order: stores must keep the order.
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sessions: { type: 'array' },
          active: { type: 'boolean' },
        },
      },
    },
    value: [
      {
        name: 'Toko Sinar ☀️',
        sessions: [
          { title: 'Morning', slots: [{ start: '2026-11-01T09:00:00+07:00', end: null }] },
        ],
        active: true,
      },
    ],
    status: 'PUBLISHED',
    version: 1,
    createdBy: 'iyon',
    updatedBy: 'iyon',
    createdAt: time(),
    updatedAt: time(),
    ...overrides,
  };
}

/** The history row of `entry`'s current version. */
export function historyOf(source: Entry, overrides: Partial<EntryHistory> = {}): EntryHistory {
  return {
    id: uuidv7(),
    entryId: source.id,
    version: source.version,
    value: source.value,
    schema: source.schema,
    status: source.status,
    changedBy: source.updatedBy,
    changedAt: source.updatedAt,
    note: null,
    ...overrides,
  };
}

/** An insert of `source` with its first history row. */
export function insert(source: Entry): EntryWrite {
  return { type: 'insert', entry: source, history: historyOf(source) };
}

/** An update of `source` to the next version with `changes`. */
export function update(
  source: Entry,
  changes: Partial<Entry> = {},
  note: string | null = null,
): { write: EntryWrite; entry: Entry } {
  const next: Entry = {
    ...source,
    version: source.version + 1,
    updatedAt: new Date(source.updatedAt.getTime() + 1000),
    ...changes,
  };
  return {
    entry: next,
    write: {
      type: 'update',
      entry: next,
      expectedVersion: source.version,
      history: historyOf(next, { note }),
    },
  };
}
