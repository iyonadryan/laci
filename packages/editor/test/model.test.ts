import type { JsonSchema } from '@lacijs/core';
import { hashToView, viewToHash } from '../src/LaciEditor';
import { formatBytes, relativeTime } from '../src/context';
import {
  changeType,
  CONFIG_PRESETS,
  flattenTree,
  freeName,
  newField,
  schemaToTree,
  treeToSchema,
  updateField,
} from '../src/model/builder';
import { contrastRatio, parseHex } from '../src/model/contrast';
import { diffValues, jsonDiff, lineDiff } from '../src/model/diff';
import { byteSize, formatPath, getAt, omit, sameJson, textOf } from '../src/model/json';
import {
  defaultValue,
  entryTypeLabel,
  fieldKind,
  inferSchema,
  sampleData,
  typeLabel,
  typeOf,
  variablesOf,
} from '../src/model/schema';
import { numberedText, visualHtml } from '../src/components/template';
import { colors, customers } from './harness';

describe('json helpers', () => {
  it('formats paths like Laci', () => {
    expect(formatPath([])).toBe('');
    expect(formatPath([0, 'sessions', 1, 'slots'])).toBe('[0].sessions[1].slots');
    expect(formatPath(['a b', 'c'])).toBe('["a b"].c');
  });

  it('reads paths, compares JSON, and more', () => {
    expect(getAt(customers.value, [0, 'sessions', 0, 'slots', 1])).toBe('14:00');
    expect(getAt(customers.value, ['x'])).toBeUndefined();
    expect(getAt({ a: 1 }, [0])).toBeUndefined();
    expect(sameJson({ a: 1, b: [1] }, { b: [1], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameJson([1], [2])).toBe(false);
    expect(sameJson(1, '1')).toBe(false);
    expect(omit({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
    expect([textOf(undefined), textOf('x'), textOf(1), textOf({ a: 1 })]).toEqual([
      '',
      'x',
      '1',
      '{"a":1}',
    ]);
    expect(byteSize('é')).toBe(4);
  });
});

describe('schema helpers', () => {
  it('knows types and their labels', () => {
    expect(typeOf({ type: ['string', 'null'] })).toEqual({ type: 'string', nullable: true });
    expect(typeOf({ type: ['string', 'number'] })).toEqual({ type: null, nullable: false });
    expect(typeOf({ type: 'null' })).toEqual({ type: 'null', nullable: true });
    expect(typeOf({})).toEqual({ type: null, nullable: false });
    expect(fieldKind({ enum: ['a'] })).toBe('enum');
    expect(fieldKind({ type: ['null'] })).toBe('null');
    expect(fieldKind({ type: 'object', additionalProperties: { type: 'string' } })).toBe('map');
    expect(fieldKind({ type: 'object' })).toBe('object');
    expect(fieldKind({ type: 'weird' })).toBe('unknown');
    expect(fieldKind({})).toBe('unknown');
    expect(typeLabel({ type: 'string', format: 'uri' })).toBe('url');
    expect(typeLabel({ type: 'string', format: 'date' })).toBe('date');
    expect(typeLabel(customers.schema)).toBe('list of object');
    expect(typeLabel({})).toBe('any');
    expect(
      [
        customers.schema,
        { type: ['string', 'null'], format: 'date-time' },
        { type: 'boolean' },
        { type: 'string', format: 'uri' },
        { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
        { type: 'integer' },
        { type: 'string' },
        { type: 'object' },
      ].map((schema) => entryTypeLabel(schema as JsonSchema)),
    ).toEqual(['List', 'Feature flag', 'Feature flag', 'Link', 'Link', 'Number', 'Text', 'Object']);
  });

  it('makes default values', () => {
    expect(defaultValue({ default: { a: 1 } })).toEqual({ a: 1 });
    expect(defaultValue({ const: 3 })).toBe(3);
    expect(defaultValue({ enum: ['x', 'y'] })).toBe('x');
    expect(defaultValue({ type: ['string', 'null'] })).toBeNull();
    expect(defaultValue({ type: 'string', format: 'color' })).toBe('#000000');
    expect(defaultValue({ type: 'string' })).toBe('');
    expect(defaultValue({ type: 'number', minimum: 5 })).toBe(5);
    expect(defaultValue({ type: 'integer' })).toBe(0);
    expect(defaultValue({ type: 'boolean' })).toBe(false);
    expect(defaultValue({ type: 'array', minItems: 2, items: { type: 'string' } })).toEqual([
      '',
      '',
    ]);
    expect(defaultValue(customers.schema.items)).toEqual({ customerCode: '', sessions: [] });
    expect(defaultValue({})).toBeNull();
  });

  it('makes sample data for templates', () => {
    expect(
      sampleData({
        type: 'object',
        properties: {
          name: { type: 'string' },
          due: { type: 'string', format: 'date' },
          at: { type: 'string', format: 'date-time' },
          link: { type: 'string', format: 'uri' },
          mail: { type: 'string', format: 'email' },
          color: { type: 'string', format: 'color' },
          amount: { type: 'number' },
          vip: { type: 'boolean' },
          items: { type: 'array', items: { type: 'string' } },
          level: { enum: ['gold'] },
          fixed: { default: 'x' },
          code: { type: 'string', examples: ['AB12'] },
          other: {},
        },
      }),
    ).toEqual({
      name: 'name',
      due: '2026-11-01',
      at: '2026-11-01T09:00:00+07:00',
      link: 'https://example.com',
      mail: 'name@example.com',
      color: '#8A5A44',
      amount: 1500,
      vip: true,
      items: ['items'],
      level: 'gold',
      fixed: 'x',
      code: 'AB12',
      other: null,
    });
  });

  it('guesses a schema from a sample', () => {
    expect(
      inferSchema([
        {
          code: 'A',
          at: '2026-11-01',
          when: '2026-11-01T09:00:00+07:00',
          color: '#FFF',
          url: 'https://x.y',
          n: 1,
          tags: [],
          note: null,
        },
        { code: 'B', n: 1.5, note: 'hi', ok: true },
      ]),
    ).toEqual({
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'n', 'note'],
        properties: {
          code: { type: 'string' },
          at: { type: 'string', format: 'date' },
          when: { type: 'string', format: 'date-time' },
          color: { type: 'string', format: 'color' },
          url: { type: 'string', format: 'uri' },
          n: { type: 'integer' },
          tags: { type: 'array', items: {} },
          note: { type: 'string' },
          ok: { type: 'boolean' },
        },
      },
    });
    expect(inferSchema([1, 2])).toEqual({ type: 'array', items: { type: 'integer' } });
    expect(inferSchema({})).toEqual({ type: 'object', properties: {} });
  });

  it('lists the variables of a template', () => {
    expect(
      variablesOf({
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'string' }, b: { type: 'number' } },
      }),
    ).toEqual([
      { name: 'a', type: 'string', required: true },
      { name: 'b', type: 'number', required: false },
    ]);
    expect(variablesOf({ type: 'object' })).toEqual([]);
  });
});

describe('diff', () => {
  it('lists changes by path', () => {
    expect(
      diffValues(customers.value, [
        {
          ...customers.value[0],
          isLive: false,
          sessions: [{ date: '2026-11-01', slots: ['10:00', '14:00', '19:00'] }],
        },
        { customerCode: 'X' },
      ]),
    ).toEqual([
      { kind: 'modified', path: '[0].isLive', before: true, after: false },
      { kind: 'added', path: '[0].sessions[0].slots[2]', after: '19:00' },
      { kind: 'added', path: '[1]', after: { customerCode: 'X' } },
    ]);
    expect(diffValues({ a: 1 }, {})).toEqual([{ kind: 'removed', path: 'a', before: 1 }]);
    expect(diffValues(1, 1)).toEqual([]);
  });

  it('diffs lines side by side', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      {
        left: { text: 'a', number: 1, changed: false },
        right: { text: 'a', number: 1, changed: false },
      },
      {
        left: { text: 'b', number: 2, changed: true },
        right: { text: 'B', number: 2, changed: true },
      },
      {
        left: { text: 'c', number: 3, changed: false },
        right: { text: 'c', number: 3, changed: false },
      },
      { left: null, right: { text: 'd', number: 4, changed: true } },
    ]);
    expect(lineDiff('x\ny', 'y')).toEqual([
      { left: { text: 'x', number: 1, changed: true }, right: null },
      {
        left: { text: 'y', number: 2, changed: false },
        right: { text: 'y', number: 1, changed: false },
      },
    ]);
    expect(jsonDiff({ a: 1 }, { a: 2 })[1]).toMatchObject({
      left: { changed: true },
      right: { changed: true },
    });
  });

  it('compares long texts by position', () => {
    const long = Array.from({ length: 2001 }, (_, index) => `line ${index}`);
    const rows = lineDiff(
      long.join('\n'),
      [...long.slice(0, 1000), 'changed', ...long.slice(1001), 'extra'].join('\n'),
    );
    expect(rows).toHaveLength(2002);
    expect(rows[1000]).toMatchObject({ left: { changed: true }, right: { text: 'changed' } });
    expect(rows[2001]).toMatchObject({ left: null, right: { text: 'extra' } });
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('red')).toBeNull();
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21);
    expect(contrastRatio('#1D6B3A', '#E5F3EA')).toBeGreaterThan(4.5);
    expect(contrastRatio('#FFFFFF', '#FFFF00')).toBeLessThan(4.5);
    expect(contrastRatio('x', '#FFF')).toBeNull();
  });
});

describe('schema builder model', () => {
  it('round-trips schemas, keeping unknown keywords', () => {
    for (const schema of [
      colors.schema,
      customers.schema,
      ...Object.values(CONFIG_PRESETS),
      { type: 'string', format: 'hostname', minLength: 1, title: 'Host', description: 'A host' },
      { enum: [1, 2] },
      { type: ['string', 'null'], enum: ['a', null] },
      { oneOf: [{ type: 'string' }, { type: 'number' }] },
      { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
    ] as JsonSchema[]) {
      expect(treeToSchema(schemaToTree(schema))).toEqual(schema);
    }
  });

  it('edits fields', () => {
    const tree = schemaToTree(customers.schema);
    const item = tree.inner!;
    expect(freeName(item)).toBe('field');
    expect(
      freeName({ ...item, children: [newField('string', 'field'), newField('string', 'field2')] }),
    ).toBe('field3');
    const name = item.children.find((field) => field.name === 'name')!;
    const removed = updateField(tree, name.id, () => null);
    expect(Object.keys(treeToSchema(removed.inner!).properties as object)).toEqual([
      'customerCode',
      'isLive',
      'sessions',
    ]);
    const renamed = updateField(tree, name.id, (field) => ({
      ...field,
      name: 'label',
      required: true,
    }));
    expect(treeToSchema(renamed.inner!).required).toEqual(['customerCode', 'label', 'sessions']);
    expect(treeToSchema(changeType(name, 'array'))).toEqual({
      type: 'array',
      description: 'Shown to viewers',
      items: { type: 'string' },
    });
    expect(treeToSchema(changeType(newField('object'), 'map'))).toEqual({
      type: 'object',
      additionalProperties: { type: 'string' },
    });
    expect(treeToSchema(newField('enum'))).toEqual({ type: 'string', enum: ['option'] });
    expect(treeToSchema({ ...newField('date'), nullable: true, rules: { minLength: 1 } })).toEqual({
      type: ['string', 'null'],
      format: 'date',
    });
  });

  it('flattens the tree with paths', () => {
    expect(
      flattenTree(schemaToTree(customers.schema), 'customerLiveStream').map(
        (row) => `${row.depth}:${row.path}`,
      ),
    ).toEqual([
      '0:customerLiveStream',
      '1:[]',
      '2:[].customerCode',
      '2:[].name',
      '2:[].isLive',
      '2:[].sessions',
      '3:[].sessions[]',
      '4:[].sessions[].date',
      '4:[].sessions[].slots',
      '5:[].sessions[].slots[]',
    ]);
    expect(
      flattenTree(schemaToTree(CONFIG_PRESETS.links!), 'links').map((row) => row.path),
    ).toEqual(['links', '{}']);
    expect(
      flattenTree(schemaToTree({ type: 'object', properties: { a: {} } }), 'k').map(
        (row) => row.path,
      ),
    ).toEqual(['k', 'a']);
  });
});

describe('template helpers', () => {
  it('shows variables as chips and numbers them for providers', () => {
    expect(visualHtml('<p>Hi {{ name | upcase }}{% if x %}!{% endif %} <b>&</b></p>')).toBe(
      '<p>Hi <span style="padding:1px 6px;border-radius:4px;background:#F5EDE8;color:#5E3A28;font-family:monospace;font-size:12px">name | upcase</span><span style="padding:1px 6px;border-radius:4px;background:#EDEDE8;color:#44474D;font-family:monospace;font-size:11px">if x</span>!<span style="padding:1px 6px;border-radius:4px;background:#EDEDE8;color:#44474D;font-family:monospace;font-size:11px">endif</span> <b>&</b></p>',
    );
    expect(visualHtml('{{ "<x>" }}')).toContain('&quot;&lt;x&gt;&quot;');
    expect(numberedText('Hi {{ a }}, {{- b }}')).toBe('Hi {{1}}, {{2}}');
  });
});

describe('views and formatting', () => {
  it('turns views into URL hashes and back', () => {
    for (const view of [
      { page: 'config' },
      { page: 'config', key: 'a/b' },
      { page: 'email', key: 'approval', locale: 'en' },
      { page: 'message', channel: 'SMS' },
      { page: 'message', channel: 'WHATSAPP', key: 'r', locale: 'id-ID' },
      { page: 'history' },
      { page: 'new' },
      { page: 'new', kind: 'MESSAGE_TEMPLATE', channel: 'PUSH' },
    ] as const) {
      expect(hashToView(viewToHash(view))).toEqual(view);
    }
    expect(viewToHash({ page: 'config', key: 'a/b' })).toBe('#/config/a%2Fb');
    expect(hashToView('')).toBeUndefined();
    expect(hashToView('#/message')).toBeUndefined();
    expect(hashToView('#/nope')).toBeUndefined();
  });

  it('formats times and sizes', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    expect(relativeTime('2026-10-27T08:00:00Z', now)).toBe('2 hours ago');
    expect(relativeTime('2026-10-26T10:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-10-27T09:59:50Z', now)).toBe('now');
    expect(relativeTime('2025-10-27T09:59:50Z', now)).toBe('last year');
    expect([formatBytes(10), formatBytes(3100), formatBytes(2_500_000)]).toEqual([
      '10 B',
      '3.1 KB',
      '2.5 MB',
    ]);
  });
});
