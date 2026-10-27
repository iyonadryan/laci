import { InvalidPathError } from './errors';
import type { JsonValue } from './types';

/** One step of a path: an object key or a list index. */
export type PathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Parses a path such as `[0].sessions[1].slots`, `links.home`, or `["key with spaces"]`.
 * Numbers in brackets are list indexes; names after a dot (or quoted in brackets) are object
 * keys. `""` is the value itself.
 */
export function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let i = 0;
  const fail = (reason: string): never => {
    throw new InvalidPathError(path, reason);
  };

  while (i < path.length) {
    const char = path[i];
    if (char === '[') {
      const close = path.indexOf(']', i);
      if (close === -1) fail(`missing "]" after position ${i}`);
      const inner = path.slice(i + 1, close).trim();
      if (/^\d+$/.test(inner)) {
        segments.push(Number(inner));
      } else if (inner.startsWith('"')) {
        let key: unknown;
        try {
          key = JSON.parse(inner);
        } catch {
          key = undefined;
        }
        if (typeof key !== 'string') fail(`${inner} is not a valid quoted key`);
        segments.push(key as string);
      } else {
        fail(`"[${inner}]" must be a list index like [0] or a quoted key like ["name"]`);
      }
      i = close + 1;
    } else {
      if (char === '.') {
        if (segments.length === 0) fail('a path cannot start with "."');
        i++;
      } else if (segments.length > 0) {
        fail(`expected "." or "[" at position ${i}`);
      }
      const match = /^[^.[\]]+/.exec(path.slice(i));
      if (!match) fail(`expected a key at position ${i}`);
      segments.push((match as RegExpExecArray)[0]);
      i += (match as RegExpExecArray)[0].length;
    }
  }
  return segments;
}

/** The path of `segments` in the syntax {@link parsePath} reads. */
export function formatPath(segments: readonly PathSegment[]): string {
  let path = '';
  for (const segment of segments) {
    if (typeof segment === 'number') path += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) path += path === '' ? segment : `.${segment}`;
    else path += `[${JSON.stringify(segment)}]`;
  }
  return path;
}

/**
 * Converts a JSON Pointer (as in Ajv's `instancePath`, e.g. `/0/sessions/1`) to segments, using
 * `data` to tell list indexes from object keys that look like numbers.
 */
export function pointerToSegments(pointer: string, data: unknown): PathSegment[] {
  if (pointer === '') return [];
  const segments: PathSegment[] = [];
  let current = data;
  for (const raw of pointer.slice(1).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current) && /^\d+$/.test(token)) {
      segments.push(Number(token));
      current = current[Number(token)];
    } else {
      segments.push(token);
      current =
        typeof current === 'object' && current !== null
          ? (current as Record<string, unknown>)[token]
          : undefined;
    }
  }
  return segments;
}

/** The value at `segments`, or `undefined` when any step does not exist. */
export function getAtPath(
  value: JsonValue,
  segments: readonly PathSegment[],
): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index =
        typeof segment === 'number' ? segment : /^\d+$/.test(segment) ? Number(segment) : NaN;
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object' && current !== null) {
      const key = String(segment);
      current = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined;
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}
