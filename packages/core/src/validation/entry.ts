import { checkEmailTemplate, checkVariableSchema } from '../email';
import { LaciValidationError } from '../errors';
import type { ValidationIssue } from '../errors';
import { ENTRY_STATUSES, MESSAGE_CHANNELS } from '../types';
import type { EntryKind, JsonSchema, JsonValue } from '../types';
import { checkValue } from './limits';
import type { ValueLimits } from './limits';
import { checkSchema, validateAgainstSchema } from './schema';

/** Letters, digits, `.`, `_`, `-`, and `:`, starting with a letter or digit; at most 191. */
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;

/** A BCP 47 language tag such as `id-ID`, `en`, or `zh-Hant-TW`; at most 35 characters. */
export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** Problems with the identifying fields of an entry. */
export function checkAddress(input: {
  key: string;
  kind: EntryKind;
  locale: string | null;
  channel: string | null;
  status?: string;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string, keyword: string): void => {
    issues.push({ path, message, keyword });
  };
  if (!KEY_PATTERN.test(input.key)) {
    issue(
      'key',
      'must be 1-191 letters, digits, ".", "_", "-", or ":", starting with a letter or digit',
      'pattern',
    );
  }
  if (input.kind === 'CONFIG') {
    if (input.locale !== null) issue('locale', 'must not be set: configs have no locale', 'locale');
    if (input.channel !== null) issue('channel', 'must not be set for a config', 'channel');
  } else {
    if (input.locale === null || input.locale.length > 35 || !LOCALE_PATTERN.test(input.locale)) {
      issue('locale', 'must be a language tag such as "id-ID" or "en"', 'locale');
    }
    if (input.kind === 'EMAIL_TEMPLATE' && input.channel !== null) {
      issue('channel', 'must not be set for an email template', 'channel');
    }
    if (
      input.kind === 'MESSAGE_TEMPLATE' &&
      !(MESSAGE_CHANNELS as readonly (string | null)[]).includes(input.channel)
    ) {
      issue('channel', `must be one of: ${MESSAGE_CHANNELS.join(', ')}`, 'channel');
    }
  }
  if (input.status !== undefined && !(ENTRY_STATUSES as readonly string[]).includes(input.status)) {
    issue('status', `must be one of: ${ENTRY_STATUSES.join(', ')}`, 'status');
  }
  return issues;
}

/**
 * Validates what an entry stores. Throws a {@link LaciValidationError} for an unusable schema,
 * a value that is not plain JSON or exceeds the limits, a config value that does not match its
 * schema, or a template value with the wrong fields, template errors, or undeclared variables.
 */
export function validateContent(
  subject: string,
  kind: EntryKind,
  schema: unknown,
  value: unknown,
  limits: Required<ValueLimits>,
): asserts value is JsonValue {
  const schemaIssues = checkSchema(schema);
  if (schemaIssues.length > 0) throw new LaciValidationError(subject, 'schema', schemaIssues);
  const valueIssues = checkValue(value, limits);
  if (valueIssues.length > 0) throw new LaciValidationError(subject, 'value', valueIssues);
  if (kind !== 'CONFIG') {
    const variableIssues = checkVariableSchema(schema as JsonSchema);
    if (variableIssues.length > 0) throw new LaciValidationError(subject, 'schema', variableIssues);
  }
  const issues =
    kind === 'CONFIG'
      ? validateAgainstSchema(schema as JsonSchema, value)
      : kind === 'EMAIL_TEMPLATE'
        ? checkEmailTemplate(value, schema as JsonSchema)
        : [];
  if (issues.length > 0) throw new LaciValidationError(subject, 'value', issues);
}
