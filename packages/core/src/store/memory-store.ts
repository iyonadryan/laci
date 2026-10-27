import { EntryExistsError, VersionConflictError } from '../errors';
import type { Entry, EntryAddress, EntryHistory } from '../types';
import type { EntryQuery, EntryWrite, LaciStore, PageQuery, Paginated } from './types';

const DEFAULT_LIMIT = 50;

function addressKey(address: EntryAddress): string {
  return JSON.stringify([
    address.key,
    address.environment,
    address.locale ?? '',
    address.channel ?? '',
  ]);
}

function paginate<T>(items: T[], page: PageQuery = {}): Paginated<T> {
  const offset = page.offset ?? 0;
  const limit = page.limit ?? DEFAULT_LIMIT;
  return { items: items.slice(offset, offset + limit), total: items.length };
}

function compareEntries(a: Entry, b: Entry): number {
  const left = [a.key, a.environment, a.locale ?? '', a.channel ?? ''];
  const right = [b.key, b.environment, b.locale ?? '', b.channel ?? ''];
  for (let i = 0; i < left.length; i++) {
    const l = left[i] as string;
    const r = right[i] as string;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

function matches(entry: Entry, query: EntryQuery): boolean {
  if (query.kind !== undefined && entry.kind !== query.kind) return false;
  if (query.key !== undefined && entry.key !== query.key) return false;
  if (query.environment !== undefined && entry.environment !== query.environment) return false;
  if (query.locale !== undefined && entry.locale !== query.locale) return false;
  if (query.channel !== undefined && entry.channel !== query.channel) return false;
  if (query.status !== undefined) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    if (!statuses.includes(entry.status)) return false;
  }
  if (query.search !== undefined && query.search !== '') {
    const text = query.search.toLowerCase();
    if (
      !entry.key.toLowerCase().includes(text) &&
      !(entry.description ?? '').toLowerCase().includes(text)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * In-memory {@link LaciStore} for tests, examples, and prototypes. Data lives in the process
 * and is lost on restart. Every read and write copies data, so callers never share state with
 * the store.
 */
export class MemoryStore implements LaciStore {
  private readonly entries = new Map<string, Entry>();
  private readonly histories = new Map<string, EntryHistory[]>();

  getEntry(address: EntryAddress): Promise<Entry | null> {
    const entry = this.entries.get(addressKey(address));
    return Promise.resolve(entry ? structuredClone(entry) : null);
  }

  listEntries(query: EntryQuery = {}): Promise<Paginated<Entry>> {
    const items = [...this.entries.values()]
      .filter((entry) => matches(entry, query))
      .sort(compareEntries)
      .map((entry) => structuredClone(entry));
    return Promise.resolve(paginate(items, query));
  }

  write(changes: readonly EntryWrite[]): Promise<void> {
    // Check everything first, so that a failing change leaves the store untouched.
    const pending = new Map<string, number>();
    for (const change of changes) {
      const key = addressKey(change.entry);
      const stored = pending.has(key) ? pending.get(key) : this.entries.get(key)?.version;
      if (change.type === 'insert') {
        if (stored !== undefined) return Promise.reject(new EntryExistsError(change.entry));
      } else if (stored !== change.expectedVersion) {
        return Promise.reject(
          new VersionConflictError(change.entry, change.expectedVersion, stored),
        );
      }
      pending.set(key, change.entry.version);
    }
    for (const change of changes) {
      this.entries.set(addressKey(change.entry), structuredClone(change.entry));
      const history = this.histories.get(change.entry.id) ?? [];
      history.push(structuredClone(change.history));
      this.histories.set(change.entry.id, history);
    }
    return Promise.resolve();
  }

  listHistory(entryId: string, page?: PageQuery): Promise<Paginated<EntryHistory>> {
    const items = [...(this.histories.get(entryId) ?? [])]
      .sort((a, b) => b.version - a.version)
      .map((history) => structuredClone(history));
    return Promise.resolve(paginate(items, page));
  }

  getHistory(entryId: string, version: number): Promise<EntryHistory | null> {
    const history = this.histories.get(entryId)?.find((item) => item.version === version);
    return Promise.resolve(history ? structuredClone(history) : null);
  }
}
