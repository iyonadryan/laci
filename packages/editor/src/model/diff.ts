import type { JsonValue } from '@lacijs/core';
import { formatPath, isObject, pretty, sameJson } from './json';
import type { PathSegment } from './json';

/** One difference between two values. */
export interface FieldChange {
  kind: 'added' | 'removed' | 'modified';
  /** `""` for the value itself. */
  path: string;
  before?: JsonValue;
  after?: JsonValue;
}

/**
 * The differences between `before` and `after`, as deep as both sides are objects or lists of
 * the same length. A list that grew or shrank reports its items one by one.
 */
export function diffValues(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  prefix: readonly PathSegment[] = [],
): FieldChange[] {
  if (sameJson(before, after)) return [];
  const path = formatPath(prefix);
  if (before === undefined) return [{ kind: 'added', path, after }];
  if (after === undefined) return [{ kind: 'removed', path, before }];
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    return Array.from({ length }, (_, index) =>
      diffValues(before[index], after[index], [...prefix, index]),
    ).flat();
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => diffValues(before[key], after[key], [...prefix, key]));
  }
  return [{ kind: 'modified', path, before, after }];
}

/** One line of a side of a {@link lineDiff}. */
export interface DiffLine {
  text: string;
  /** Line number in its side. */
  number: number;
  changed: boolean;
}

/** One row of a side-by-side diff; a side is `null` where the other side has extra lines. */
export interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Above this many lines per side, lines are compared by position only. */
const MAX_LCS_LINES = 2000;

/** A side-by-side diff of two texts, line by line (longest common subsequence). */
export function lineDiff(beforeText: string, afterText: string): DiffRow[] {
  const left = beforeText.split('\n');
  const right = afterText.split('\n');
  if (left.length > MAX_LCS_LINES || right.length > MAX_LCS_LINES) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
      const a = left[index];
      const b = right[index];
      const changed = a !== b;
      return {
        left: a === undefined ? null : { text: a, number: index + 1, changed },
        right: b === undefined ? null : { text: b, number: index + 1, changed },
      };
    });
  }
  // common(i, j): how many lines left[i..] and right[j..] have in common.
  const width = right.length + 1;
  const lengths = new Array<number>((left.length + 1) * width).fill(0);
  const common = (i: number, j: number) => lengths[i * width + j] as number;
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        left[i] === right[j]
          ? common(i + 1, j + 1) + 1
          : Math.max(common(i + 1, j), common(i, j + 1));
    }
  }
  const rows: DiffRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  // Removed and added lines next to each other share rows, as a modified block.
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
      rows.push({ left: removed[index] ?? null, right: added[index] ?? null });
    }
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      flush();
      rows.push({
        left: { text: left[i] as string, number: i + 1, changed: false },
        right: { text: right[j] as string, number: j + 1, changed: false },
      });
      i++;
      j++;
    } else if (j >= right.length || (i < left.length && common(i + 1, j) >= common(i, j + 1))) {
      removed.push({ text: left[i] as string, number: i + 1, changed: true });
      i++;
    } else {
      added.push({ text: right[j] as string, number: j + 1, changed: true });
      j++;
    }
  }
  flush();
  return rows;
}

/** {@link lineDiff} of two values as pretty JSON. */
export const jsonDiff = (before: unknown, after: unknown): DiffRow[] =>
  lineDiff(pretty(before), pretty(after));
