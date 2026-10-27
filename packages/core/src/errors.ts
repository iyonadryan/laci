import type { EntryAddress } from './types';

/** Base class of every error thrown by Laci. Check `code` to tell errors apart. */
export class LaciError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Human-readable description of an entry, e.g. `"linkPath" (staging)`. */
export function describeAddress(address: Partial<EntryAddress> & { key: string }): string {
  const parts = [address.environment, address.locale, address.channel].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
  return parts.length === 0 ? `"${address.key}"` : `"${address.key}" (${parts.join(', ')})`;
}

/** One problem found while validating. */
export interface ValidationIssue {
  /**
   * Where the problem is, e.g. `[0].sessions[1].slots[0].start`; `""` for the value itself.
   * Same syntax as the paths accepted by `laci.get(key, path)`.
   */
  path: string;
  message: string;
  /** The JSON Schema keyword (or Laci check, e.g. `maxBytes`) that failed. */
  keyword: string;
}

/** What failed validation. */
export type ValidationTarget = 'value' | 'schema' | 'entry' | 'data';

/**
 * Thrown when a value does not match its schema, a schema is not a valid JSON Schema, an entry
 * is malformed (e.g. a template without a locale), or the data passed to a template does not
 * match its variable schema.
 */
export class LaciValidationError extends LaciError {
  readonly target: ValidationTarget;
  /** Every problem found, not just the first. */
  readonly issues: readonly ValidationIssue[];

  constructor(subject: string, target: ValidationTarget, issues: readonly ValidationIssue[]) {
    const details = issues
      .map((issue) => `  - ${issue.path === '' ? '(root)' : issue.path}: ${issue.message}`)
      .join('\n');
    const what = { value: 'Value', schema: 'Schema', entry: 'Entry', data: 'Data' }[target];
    super(
      target === 'schema' ? 'INVALID_SCHEMA' : 'VALIDATION_FAILED',
      `${what} of ${subject} is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${details}`,
    );
    this.target = target;
    this.issues = issues;
  }
}

/** The entry (or the requested version of it) does not exist, or is not published. */
export class EntryNotFoundError extends LaciError {
  readonly key: string;
  readonly version: number | undefined;

  constructor(address: Partial<EntryAddress> & { key: string }, version?: number) {
    super(
      'ENTRY_NOT_FOUND',
      version === undefined
        ? `Entry ${describeAddress(address)} does not exist or is not published.`
        : `Entry ${describeAddress(address)} has no version ${version}.`,
    );
    this.key = address.key;
    this.version = version;
  }
}

/** Thrown when creating an entry whose `(key, environment, locale, channel)` already exists. */
export class EntryExistsError extends LaciError {
  readonly key: string;

  constructor(address: EntryAddress) {
    super('ENTRY_EXISTS', `Entry ${describeAddress(address)} already exists.`);
    this.key = address.key;
  }
}

/**
 * Thrown when an entry changed since it was read: someone else saved first. Reload the entry
 * and apply the change again.
 */
export class VersionConflictError extends LaciError {
  readonly key: string;
  readonly expectedVersion: number;
  /** The stored version, when known. */
  readonly actualVersion: number | undefined;

  constructor(address: EntryAddress, expectedVersion: number, actualVersion?: number) {
    super(
      'VERSION_CONFLICT',
      `Entry ${describeAddress(address)} was changed by someone else: expected version ` +
        `${expectedVersion}${actualVersion === undefined ? '' : `, but it is at version ${actualVersion}`}.`,
    );
    this.key = address.key;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

/** A data environment that is not in `createLaci({ environments })`. */
export class UnknownEnvironmentError extends LaciError {
  readonly environment: string;

  constructor(environment: string, environments: readonly string[]) {
    super(
      'UNKNOWN_ENVIRONMENT',
      `Unknown environment "${environment}"; configured: ${environments.map((name) => `"${name}"`).join(', ')}.`,
    );
    this.environment = environment;
  }
}

/** A path passed to `get` (or another method) that cannot be parsed. */
export class InvalidPathError extends LaciError {
  readonly path: string;

  constructor(path: string, reason: string) {
    super('INVALID_PATH', `Invalid path "${path}": ${reason}`);
    this.path = path;
  }
}

/** A stored value that does not have the shape a helper needs (e.g. `find` on a non-list). */
export class UnexpectedValueError extends LaciError {
  constructor(message: string) {
    super('UNEXPECTED_VALUE', message);
  }
}
