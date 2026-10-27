import { describe, expect, it } from 'vitest';
import {
  EntryExistsError,
  EntryNotFoundError,
  InvalidPathError,
  LaciError,
  LaciValidationError,
  UnexpectedValueError,
  UnknownEnvironmentError,
  VersionConflictError,
} from '../src';
import type { EntryAddress } from '../src';
import { describeAddress } from '../src/errors';

const sms: EntryAddress = {
  key: 'reminder',
  environment: 'staging',
  locale: 'en-US',
  channel: 'SMS',
};

describe('describeAddress', () => {
  it('names the key and every part of the address that is set', () => {
    expect(describeAddress({ key: 'linkPath' })).toBe('"linkPath"');
    expect(describeAddress({ key: 'linkPath', environment: 'production', locale: null })).toBe(
      '"linkPath" (production)',
    );
    expect(describeAddress(sms)).toBe('"reminder" (staging, en-US, SMS)');
    expect(describeAddress({ key: 'x', environment: '', locale: '' })).toBe('"x"');
  });
});

describe('errors', () => {
  it('all extend LaciError with a name and a stable code', () => {
    const errors: [LaciError, string, string][] = [
      [new EntryNotFoundError(sms), 'EntryNotFoundError', 'ENTRY_NOT_FOUND'],
      [new EntryExistsError(sms), 'EntryExistsError', 'ENTRY_EXISTS'],
      [new VersionConflictError(sms, 1), 'VersionConflictError', 'VERSION_CONFLICT'],
      [
        new UnknownEnvironmentError('qa', ['production']),
        'UnknownEnvironmentError',
        'UNKNOWN_ENVIRONMENT',
      ],
      [new InvalidPathError('[', 'missing "]"'), 'InvalidPathError', 'INVALID_PATH'],
      [new UnexpectedValueError('not a list'), 'UnexpectedValueError', 'UNEXPECTED_VALUE'],
      [new LaciValidationError('"x"', 'value', []), 'LaciValidationError', 'VALIDATION_FAILED'],
      [new LaciValidationError('"x"', 'schema', []), 'LaciValidationError', 'INVALID_SCHEMA'],
    ];
    for (const [error, name, code] of errors) {
      expect(error).toBeInstanceOf(LaciError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
      expect(error.code).toBe(code);
    }
  });

  it('describe the problem', () => {
    expect(new EntryNotFoundError(sms).message).toBe(
      'Entry "reminder" (staging, en-US, SMS) does not exist or is not published.',
    );
    expect(new EntryNotFoundError({ key: 'x' }, 3)).toMatchObject({
      key: 'x',
      version: 3,
      message: 'Entry "x" has no version 3.',
    });
    expect(new EntryExistsError(sms).message).toBe(
      'Entry "reminder" (staging, en-US, SMS) already exists.',
    );
    expect(new VersionConflictError(sms, 2, 3).message).toBe(
      'Entry "reminder" (staging, en-US, SMS) was changed by someone else: expected version 2, but it is at version 3.',
    );
    expect(new VersionConflictError(sms, 2)).toMatchObject({
      expectedVersion: 2,
      actualVersion: undefined,
      message:
        'Entry "reminder" (staging, en-US, SMS) was changed by someone else: expected version 2.',
    });
    expect(new UnknownEnvironmentError('qa', ['production', 'staging']).message).toBe(
      'Unknown environment "qa"; configured: "production", "staging".',
    );
    expect(new InvalidPathError('[', 'missing "]"').message).toBe('Invalid path "[": missing "]"');
  });

  it('list every validation issue, with "(root)" for the value itself', () => {
    const error = new LaciValidationError('"x"', 'entry', [
      { path: '', message: 'must be object', keyword: 'type' },
      { path: 'key', message: 'is invalid', keyword: 'pattern' },
    ]);
    expect(error.message).toBe(
      'Entry of "x" is invalid (2 issues):\n  - (root): must be object\n  - key: is invalid',
    );
    expect(error.target).toBe('entry');
    expect(
      new LaciValidationError('"x"', 'schema', [{ path: '', message: 'bad', keyword: 'x' }])
        .message,
    ).toBe('Schema of "x" is invalid (1 issue):\n  - (root): bad');
  });
});
