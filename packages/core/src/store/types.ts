import type {
  Entry,
  EntryAddress,
  EntryHistory,
  EntryKind,
  EntryStatus,
  MessageChannel,
} from '../types';

/** Offset pagination. */
export interface PageQuery {
  /** Maximum number of items. Default 50. */
  limit?: number;
  /** Number of items to skip. Default 0. */
  offset?: number;
}

/** One page of results. */
export interface Paginated<T> {
  items: T[];
  /** Number of matching items across all pages. */
  total: number;
}

/** Filters for {@link LaciStore.listEntries}. All given filters must match. */
export interface EntryQuery extends PageQuery {
  kind?: EntryKind;
  key?: string;
  environment?: string;
  /** `null` matches entries without a locale (configs). */
  locale?: string | null;
  /** `null` matches entries without a channel (configs and email templates). */
  channel?: MessageChannel | null;
  status?: EntryStatus | EntryStatus[];
  /** Case-insensitive text found in the key or the description. */
  search?: string;
}

/** One change for {@link LaciStore.write}. */
export type EntryWrite =
  | {
      type: 'insert';
      /** The new entry, at version 1. */
      entry: Entry;
      /** Its first history row. */
      history: EntryHistory;
    }
  | {
      type: 'update';
      /** The entry after the change, with `version` incremented. */
      entry: Entry;
      /** The version the change was based on: the stored row must still be at this version. */
      expectedVersion: number;
      history: EntryHistory;
    };

/**
 * Persistence used by Laci. Implementations: `MemoryStore` (in core), `@lacijs/postgres`,
 * `@lacijs/mysql`.
 *
 * Contract:
 * - `(key, environment, locale, channel)` is unique, with a `null` locale or channel counting as
 *   one value (two configs with the same key and environment are a duplicate).
 * - `write` applies all its changes atomically, or none of them. It throws `EntryExistsError`
 *   when an insert would duplicate an entry, and `VersionConflictError` when an update's
 *   `expectedVersion` is not the stored version (somebody else saved first).
 * - The history is append-only: every write adds one history row and none is ever changed.
 * - Values and schemas come back exactly as written, including the order of object keys.
 * - Lists are ordered by key, environment, locale, and channel; histories newest first.
 * - Returned objects must not be shared with the store's internal state.
 */
export interface LaciStore {
  getEntry(address: EntryAddress): Promise<Entry | null>;
  listEntries(query?: EntryQuery): Promise<Paginated<Entry>>;
  write(changes: readonly EntryWrite[]): Promise<void>;
  /** Versions of one entry, newest first; empty when the entry does not exist. */
  listHistory(entryId: string, page?: PageQuery): Promise<Paginated<EntryHistory>>;
  getHistory(entryId: string, version: number): Promise<EntryHistory | null>;
}
