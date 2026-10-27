import { describe, expect, it } from 'vitest';
import { formatPath, getAtPath, InvalidPathError, parsePath } from '../src';
import { pointerToSegments } from '../src/path';
import { customerLiveStream } from './fixtures';

describe('parsePath', () => {
  it.each([
    ['', []],
    ['[0]', [0]],
    ['[0].sessions[1].slots', [0, 'sessions', 1, 'slots']],
    ['links.home', ['links', 'home']],
    ['["key with spaces"].x', ['key with spaces', 'x']],
    ['a[ 2 ]', ['a', 2]],
    ['a.0', ['a', '0']],
  ])('parses %j', (path, segments) => {
    expect(parsePath(path)).toEqual(segments);
  });

  it.each([
    ['[0', 'missing "]"'],
    ['.a', 'cannot start with "."'],
    ['a..b', 'expected a key'],
    ['[x]', 'must be a list index'],
    ['["unclosed]', 'not a valid quoted key'],
    ['[0]a', 'expected "." or "["'],
  ])('rejects %j', (path, reason) => {
    expect(() => parsePath(path)).toThrow(InvalidPathError);
    expect(() => parsePath(path)).toThrow(reason);
  });
});

describe('formatPath', () => {
  it('writes the syntax parsePath reads', () => {
    const segments = [0, 'sessions', 1, 'odd key', 'x'];
    expect(formatPath(segments)).toBe('[0].sessions[1]["odd key"].x');
    expect(parsePath(formatPath(segments))).toEqual(segments);
    expect(formatPath(['links', 'home'])).toBe('links.home');
    expect(formatPath([])).toBe('');
  });
});

describe('getAtPath', () => {
  const value = customerLiveStream.value;

  it('reads values nested three lists deep', () => {
    expect(getAtPath(value, parsePath('[0].sessions[0].slots[1].start'))).toBe(
      '2026-11-01T10:30:00+07:00',
    );
    expect(getAtPath(value, parsePath('[1].sessions'))).toHaveLength(2);
  });

  it('returns undefined for missing steps', () => {
    expect(getAtPath(value, parsePath('[5].sessions'))).toBeUndefined();
    expect(getAtPath(value, parsePath('[0].nope.deeper'))).toBeUndefined();
    expect(getAtPath(value, parsePath('[0].name.length'))).toBeUndefined();
    expect(getAtPath(value, ['x'])).toBeUndefined();
    expect(getAtPath({ a: 1 }, ['toString'])).toBeUndefined();
  });

  it('accepts numeric keys for list indexes', () => {
    expect(getAtPath([10, 20], ['1'])).toBe(20);
    expect(getAtPath({ '1': 'one' }, [1])).toBe('one');
  });
});

describe('pointerToSegments', () => {
  it('tells list indexes from numeric object keys', () => {
    const data = { list: [{ '2024': { 'a/b': { '~': 1 } } }] };
    expect(pointerToSegments('/list/0/2024/a~1b/~0', data)).toEqual([
      'list',
      0,
      '2024',
      'a/b',
      '~',
    ]);
    expect(pointerToSegments('', data)).toEqual([]);
    expect(pointerToSegments('/missing/0', data)).toEqual(['missing', '0']);
  });
});
