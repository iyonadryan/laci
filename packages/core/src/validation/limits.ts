import type { ValidationIssue } from '../errors';
import { formatPath } from '../path';
import type { PathSegment } from '../path';

/** Limits applied to every stored value. */
export interface ValueLimits {
  /** Maximum size of the value as UTF-8 JSON. Default 1 MB (1 000 000 bytes). */
  maxValueBytes?: number;
  /**
   * Maximum nesting of lists and objects. A list of objects is depth 2; a list of customers,
   * each with a list of sessions, each with a list of slots, is depth 6. Default 10.
   */
  maxDepth?: number;
}

export const DEFAULT_LIMITS: Required<ValueLimits> = { maxValueBytes: 1_000_000, maxDepth: 10 };

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Problems that make `value` unstorable: anything that is not plain JSON (`undefined`, `NaN`,
 * dates, class instances, ...), nesting deeper than `maxDepth`, or more than `maxValueBytes`.
 */
export function checkValue(value: unknown, limits: Required<ValueLimits>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let tooDeep = false;

  const visit = (node: unknown, path: PathSegment[], depth: number): void => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) {
        issues.push({
          path: formatPath(path),
          message: `must be a finite number`,
          keyword: 'json',
        });
      }
      return;
    }
    if (typeof node !== 'object' || !(Array.isArray(node) || isPlainObject(node))) {
      const type = typeof node === 'object' ? 'a class instance' : typeof node;
      issues.push({
        path: formatPath(path),
        message: `must be JSON (string, number, boolean, null, list, or object), not ${type}`,
        keyword: 'json',
      });
      return;
    }
    if (depth + 1 > limits.maxDepth) {
      if (!tooDeep) {
        issues.push({
          path: formatPath(path),
          message: `is nested too deeply (more than ${limits.maxDepth} levels of lists and objects)`,
          keyword: 'maxDepth',
        });
      }
      tooDeep = true;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        visit(item, [...path, index], depth + 1);
      });
    } else {
      for (const [key, item] of Object.entries(node)) visit(item, [...path, key], depth + 1);
    }
  };

  visit(value, [], 0);
  if (issues.length > 0) return issues;

  const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
  if (bytes > limits.maxValueBytes) {
    issues.push({
      path: '',
      message: `is ${bytes} bytes as JSON, more than the limit of ${limits.maxValueBytes}`,
      keyword: 'maxBytes',
    });
  }
  return issues;
}
