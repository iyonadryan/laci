import type { EntryAddress, EntryKind } from './types';

/** What to drop from the cache; omitted fields match everything. */
export interface InvalidateFilter {
  key?: string;
  environment?: string;
  locale?: string | null;
  channel?: string | null;
}

interface Slot<T> {
  value: T;
  expiresAt: number;
  address: EntryAddress;
}

/**
 * In-memory read cache with a time-to-live. The cache key holds the kind, environment, key,
 * locale, and channel, so e.g. the staging and production versions of an entry are separate.
 */
export class TtlCache<T> {
  private readonly slots = new Map<string, Slot<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  static keyOf(kind: EntryKind, address: EntryAddress): string {
    return JSON.stringify([
      kind,
      address.environment,
      address.key,
      address.locale ?? '',
      address.channel ?? '',
    ]);
  }

  get(kind: EntryKind, address: EntryAddress): { value: T } | undefined {
    const key = TtlCache.keyOf(kind, address);
    const slot = this.slots.get(key);
    if (!slot) return undefined;
    if (slot.expiresAt <= this.now()) {
      this.slots.delete(key);
      return undefined;
    }
    return { value: slot.value };
  }

  set(kind: EntryKind, address: EntryAddress, value: T): void {
    this.slots.set(TtlCache.keyOf(kind, address), {
      value,
      expiresAt: this.now() + this.ttlMs,
      address,
    });
  }

  /** Drops every cached entry matching `filter` (everything when it is empty). */
  invalidate(filter: InvalidateFilter = {}): void {
    for (const [key, { address }] of this.slots) {
      if (filter.key !== undefined && address.key !== filter.key) continue;
      if (filter.environment !== undefined && address.environment !== filter.environment) continue;
      if (filter.locale !== undefined && address.locale !== filter.locale) continue;
      if (filter.channel !== undefined && address.channel !== filter.channel) continue;
      this.slots.delete(key);
    }
  }
}
