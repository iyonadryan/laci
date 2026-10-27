import { describe, expect, it } from 'vitest';
import type { EntryAddress } from '../src';
import { TtlCache } from '../src/cache';

const address = (overrides: Partial<EntryAddress> = {}): EntryAddress => ({
  key: 'reminder',
  environment: 'production',
  locale: 'en-US',
  channel: 'SMS',
  ...overrides,
});

describe('TtlCache', () => {
  it('expires entries after the TTL', () => {
    let now = 0;
    const cache = new TtlCache<string>(100, () => now);
    cache.set('MESSAGE_TEMPLATE', address(), 'hit');
    now = 99;
    expect(cache.get('MESSAGE_TEMPLATE', address())).toEqual({ value: 'hit' });
    now = 100;
    expect(cache.get('MESSAGE_TEMPLATE', address())).toBeUndefined();
  });

  it('keeps kinds, environments, locales, and channels apart', () => {
    const cache = new TtlCache<string>(1000, () => 0);
    cache.set('MESSAGE_TEMPLATE', address(), 'sms');
    expect(cache.get('EMAIL_TEMPLATE', address())).toBeUndefined();
    expect(cache.get('MESSAGE_TEMPLATE', address({ environment: 'staging' }))).toBeUndefined();
    expect(cache.get('MESSAGE_TEMPLATE', address({ locale: 'id-ID' }))).toBeUndefined();
    expect(cache.get('MESSAGE_TEMPLATE', address({ channel: 'WHATSAPP' }))).toBeUndefined();
    expect(cache.get('MESSAGE_TEMPLATE', address())).toEqual({ value: 'sms' });
  });

  it('treats a null locale and channel like empty ones in the key', () => {
    expect(TtlCache.keyOf('CONFIG', address({ locale: null, channel: null }))).toBe(
      TtlCache.keyOf('CONFIG', address({ locale: '', channel: '' as never })),
    );
  });

  it('invalidates by key, environment, locale, and channel', () => {
    const cache = new TtlCache<string>(1000, () => 0);
    const all = [
      address(),
      address({ channel: 'WHATSAPP' }),
      address({ locale: 'id-ID' }),
      address({ environment: 'staging' }),
      address({ key: 'other' }),
    ];
    const fill = () => {
      for (const item of all) cache.set('MESSAGE_TEMPLATE', item, item.key);
    };
    const left = () => all.filter((item) => cache.get('MESSAGE_TEMPLATE', item) !== undefined);

    fill();
    cache.invalidate({ key: 'reminder', channel: 'WHATSAPP' });
    expect(left()).toHaveLength(4);
    expect(cache.get('MESSAGE_TEMPLATE', address({ channel: 'WHATSAPP' }))).toBeUndefined();

    fill();
    cache.invalidate({ locale: 'id-ID' });
    expect(cache.get('MESSAGE_TEMPLATE', address({ locale: 'id-ID' }))).toBeUndefined();
    expect(left()).toHaveLength(4);

    fill();
    cache.invalidate({ environment: 'staging' });
    expect(left()).toHaveLength(4);

    fill();
    cache.invalidate({ key: 'reminder' });
    expect(left()).toEqual([address({ key: 'other' })]);

    fill();
    cache.invalidate();
    expect(left()).toEqual([]);
  });
});
