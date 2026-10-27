import type { JsonObject, JsonValue } from '@lacijs/core';

/** A step of a path: a property name or a list index. */
export type PathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `[0].sessions[1].slots`: the path syntax of Laci's validation issues and `laci.get`. */
export function formatPath(segments: readonly PathSegment[]): string {
  let path = '';
  for (const segment of segments) {
    if (typeof segment === 'number') path += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) path += path === '' ? segment : `.${segment}`;
    else path += `[${JSON.stringify(segment)}]`;
  }
  return path;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at `segments`, or `undefined`. */
export function getAt(
  value: JsonValue | undefined,
  segments: readonly PathSegment[],
): JsonValue | undefined {
  let current = value;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isObject(current)) return undefined;
      current = current[segment];
    }
  }
  return current;
}

/** JSON equality; object key order does not matter. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameJson(a[key], b[key]))
    );
  }
  return false;
}

/** `object` without `key`. */
export function omit(object: JsonObject, key: string): JsonObject {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
}

/** A JSON value as plain text: strings as they are, the rest as JSON. */
export function textOf(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Pretty JSON for editors and diffs. */
export const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/** UTF-8 size of `value` as JSON. */
export const byteSize = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;
