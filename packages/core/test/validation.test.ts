import { describe, expect, it } from 'vitest';
import {
  checkAddress,
  checkSchema,
  checkValue,
  DEFAULT_LIMITS,
  validateAgainstSchema,
} from '../src';
import { customerCategoryColor, customerLiveStream, linkPath, setFeatureLive } from './fixtures';

describe('checkSchema', () => {
  it('accepts the example schemas', () => {
    for (const fixture of [customerLiveStream, setFeatureLive, linkPath, customerCategoryColor]) {
      expect(checkSchema(fixture.schema)).toEqual([]);
    }
  });

  it('rejects non-objects, invalid keywords, and unknown keywords', () => {
    expect(checkSchema('string')[0]?.message).toBe('must be a JSON Schema object');
    expect(checkSchema(null)).toHaveLength(1);
    expect(checkSchema([])).toHaveLength(1);
    expect(checkSchema({ type: 'strng' }).length).toBeGreaterThan(0);
    expect(checkSchema({ type: 'string', requird: true })[0]?.message).toContain('unknown keyword');
    expect(checkSchema({ type: 'array', uniqueBy: '' }).length).toBeGreaterThan(0);
  });

  it('ignores a root $id, so two schemas with the same $id both compile', () => {
    expect(checkSchema({ $id: 'x', type: 'string' })).toEqual([]);
    expect(checkSchema({ $id: 'x', type: 'number' })).toEqual([]);
    expect(validateAgainstSchema({ $id: 'x', type: 'number' }, 1)).toEqual([]);
  });
});

describe('validateAgainstSchema', () => {
  it('accepts the example values', () => {
    for (const fixture of [customerLiveStream, setFeatureLive, linkPath, customerCategoryColor]) {
      expect(validateAgainstSchema(fixture.schema, fixture.value)).toEqual([]);
    }
  });

  it('reports the exact path of a problem three lists deep', () => {
    const value = structuredClone(customerLiveStream.value);
    value[1]!.sessions[1]!.slots[0]!.start = 'tomorrow';
    delete (value[0]!.sessions[0]!.slots[1] as { end?: string }).end;
    (value[0] as Record<string, unknown>).extra = true;

    expect(validateAgainstSchema(customerLiveStream.schema, value)).toEqual([
      {
        path: '[0].extra',
        message: 'is not allowed: the schema has no such field',
        keyword: 'additionalProperties',
      },
      { path: '[0].sessions[0].slots[1].end', message: 'is required', keyword: 'required' },
      {
        path: '[1].sessions[1].slots[0].start',
        message: 'must be a date and time with an offset, like "2026-11-01T09:00:00+07:00"',
        keyword: 'format',
      },
    ]);
  });

  it('validates "format": "color" as #RGB or #RRGGBB', () => {
    const schema = { type: 'string', format: 'color' };
    for (const color of ['#FFF', '#fff', '#8A5A44', '#8a5a44']) {
      expect(validateAgainstSchema(schema, color)).toEqual([]);
    }
    for (const color of ['FFF', '#FFFF', '#8A5A4', '#GGGGGG', 'red', '#8A5A44FF', 'rgb(0,0,0)']) {
      expect(validateAgainstSchema(schema, color)[0]?.message).toBe(
        'must be a color like "#8A5A44" (#RGB or #RRGGBB)',
      );
    }
  });

  it('reports the field of an invalid color in a list', () => {
    const value = structuredClone(customerCategoryColor.value);
    value[2]!.background = '#12345';
    expect(validateAgainstSchema(customerCategoryColor.schema, value)).toEqual([
      expect.objectContaining({ path: '[2].background', keyword: 'format' }),
    ]);
  });

  it('requires an offset in "format": "date-time"', () => {
    const schema = { type: 'string', format: 'date-time' };
    expect(validateAgainstSchema(schema, '2026-11-01T00:00:00+07:00')).toEqual([]);
    expect(validateAgainstSchema(schema, '2026-11-01T00:00:00Z')).toEqual([]);
    expect(validateAgainstSchema(schema, '2026-11-01T00:00:00')).toHaveLength(1);
    expect(validateAgainstSchema(schema, '2026-11-01')).toHaveLength(1);
  });

  it('checks uniqueBy on one or more fields', () => {
    const value = [
      ...structuredClone(customerCategoryColor.value),
      { ...customerCategoryColor.value[0]!, label: 'Again' },
    ];
    expect(validateAgainstSchema(customerCategoryColor.schema, value)).toEqual([
      {
        path: '[3].category',
        message: 'must be unique: item 0 has the same "category"',
        keyword: 'uniqueBy',
      },
    ]);

    const schema = { type: 'array', uniqueBy: ['a', 'b'] };
    expect(
      validateAgainstSchema(schema, [{ a: 1, b: 1 }, { a: 1, b: 2 }, 'x', null, {}, {}]),
    ).toEqual([]);
    expect(
      validateAgainstSchema(schema, [
        { a: 1, b: 1 },
        { a: 1, b: 1 },
      ])[0]?.message,
    ).toBe('must be unique: item 0 has the same "a" + "b"');
  });

  it('reports the path of uniqueBy inside nested lists', () => {
    const schema = {
      type: 'object',
      properties: { groups: { type: 'array', items: { type: 'array', uniqueBy: 'id' } } },
    };
    const issues = validateAgainstSchema(schema, { groups: [[{ id: 1 }], [{ id: 2 }, { id: 2 }]] });
    expect(issues[0]?.path).toBe('groups[1][1].id');
  });

  it('names the allowed values of an enum', () => {
    expect(validateAgainstSchema({ enum: ['A', 1] }, 'B')[0]?.message).toBe(
      'must be one of: "A", 1',
    );
  });
});

describe('checkValue', () => {
  it('accepts plain JSON', () => {
    expect(checkValue(customerLiveStream.value, DEFAULT_LIMITS)).toEqual([]);
    expect(checkValue(null, DEFAULT_LIMITS)).toEqual([]);
    expect(checkValue(Object.create(null), DEFAULT_LIMITS)).toEqual([]);
  });

  it('rejects values that are not JSON', () => {
    const value = { a: undefined, b: [Number.NaN], c: new Date(), d: () => 1 };
    expect(checkValue(value, DEFAULT_LIMITS).map((issue) => issue.path)).toEqual([
      'a',
      'b[0]',
      'c',
      'd',
    ]);
    expect(checkValue(new Map(), DEFAULT_LIMITS)[0]?.message).toContain('not a class instance');
  });

  it('limits the nesting depth', () => {
    const limits = { ...DEFAULT_LIMITS, maxDepth: 3 };
    expect(checkValue([[[1]]], limits)).toEqual([]);
    expect(checkValue([[[[1]], [[2]]]], limits)).toEqual([
      {
        path: '[0][0][0]',
        message: 'is nested too deeply (more than 3 levels of lists and objects)',
        keyword: 'maxDepth',
      },
    ]);
    // customerLiveStream: list > customer > sessions > session > slots > slot = 6 levels.
    expect(checkValue(customerLiveStream.value, { ...DEFAULT_LIMITS, maxDepth: 6 })).toEqual([]);
    expect(checkValue(customerLiveStream.value, { ...DEFAULT_LIMITS, maxDepth: 5 })).toHaveLength(
      1,
    );
  });

  it('limits the size in UTF-8 bytes', () => {
    const limits = { ...DEFAULT_LIMITS, maxValueBytes: 10 };
    expect(checkValue('12345678', limits)).toEqual([]); // 10 bytes with the quotes
    expect(checkValue('é'.repeat(5), limits)[0]).toEqual({
      path: '',
      message: 'is 12 bytes as JSON, more than the limit of 10',
      keyword: 'maxBytes',
    });
  });
});

describe('checkAddress', () => {
  it('accepts valid addresses', () => {
    expect(
      checkAddress({ key: 'customerLiveStream', kind: 'CONFIG', locale: null, channel: null }),
    ).toEqual([]);
    expect(
      checkAddress({
        key: 'approval-request',
        kind: 'EMAIL_TEMPLATE',
        locale: 'id-ID',
        channel: null,
      }),
    ).toEqual([]);
    expect(
      checkAddress({
        key: 'reminder',
        kind: 'MESSAGE_TEMPLATE',
        locale: 'en',
        channel: 'SMS',
        status: 'DRAFT',
      }),
    ).toEqual([]);
  });

  it('reports every problem', () => {
    expect(
      checkAddress({
        key: '-bad key',
        kind: 'CONFIG',
        locale: 'en',
        channel: 'SMS',
        status: 'LIVE',
      }).map((i) => i.path),
    ).toEqual(['key', 'locale', 'channel', 'status']);
    expect(
      checkAddress({ key: 'x', kind: 'EMAIL_TEMPLATE', locale: null, channel: 'SMS' }).map(
        (i) => i.path,
      ),
    ).toEqual(['locale', 'channel']);
    expect(
      checkAddress({
        key: 'x',
        kind: 'MESSAGE_TEMPLATE',
        locale: 'not a locale',
        channel: 'FAX',
      }).map((i) => i.path),
    ).toEqual(['locale', 'channel']);
    expect(
      checkAddress({ key: 'x'.repeat(192), kind: 'CONFIG', locale: null, channel: null }),
    ).toHaveLength(1);
  });
});
