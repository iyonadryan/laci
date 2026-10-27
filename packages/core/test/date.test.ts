import { describe, expect, it } from 'vitest';
import { parseInstant } from '../src';

describe('parseInstant', () => {
  it('reads ISO 8601 with an offset as an absolute moment', () => {
    expect(parseInstant('2026-11-01T00:00:00+07:00')).toBe(Date.UTC(2026, 9, 31, 17));
    expect(parseInstant('2026-10-31T17:00:00Z')).toBe(Date.UTC(2026, 9, 31, 17));
    expect(parseInstant('2026-10-31T12:00:00-05:00')).toBe(Date.UTC(2026, 9, 31, 17));
    expect(parseInstant('2026-10-31T17:00:00.250z')).toBe(Date.UTC(2026, 9, 31, 17, 0, 0, 250));
  });

  it.each([
    '2026-11-01',
    '2026-11-01T00:00:00',
    '2026-11-01 00:00:00+07:00',
    '2026-11-01T00:00+07:00',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-11-01T24:30:00Z',
    'soon',
  ])('rejects %j', (text) => {
    expect(parseInstant(text)).toBeNull();
  });
});
