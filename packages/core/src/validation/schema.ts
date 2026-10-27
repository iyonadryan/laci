import Ajv from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { DataValidationCxt } from 'ajv/dist/types';
import addFormats from 'ajv-formats';
import type { ValidationIssue } from '../errors';
import { formatPath, pointerToSegments } from '../path';
import type { JsonSchema } from '../types';

/** `#RGB` or `#RRGGBB`, the values accepted by `"format": "color"`. */
export const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Compiled validators kept before the cache is cleared. */
const MAX_COMPILED = 500;

let ajv: Ajv | undefined;
const compiled = new Map<string, ValidateFunction>();

function fieldsOf(schema: unknown): string[] {
  return typeof schema === 'string' ? [schema] : (schema as string[]);
}

/**
 * `uniqueBy`: items of a list must differ in the given field(s), e.g.
 * `{ "type": "array", "uniqueBy": "category" }`. Items that are not objects are ignored.
 */
function validateUniqueBy(
  schema: unknown,
  data: unknown,
  _parentSchema?: unknown,
  context?: DataValidationCxt,
): boolean {
  if (!Array.isArray(data)) return true;
  const fields = fieldsOf(schema);
  const seen = new Map<string, number>();
  const errors: Partial<ErrorObject>[] = [];
  data.forEach((item: unknown, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return;
    const values = fields.map((field) => (item as Record<string, unknown>)[field]);
    if (values.every((value) => value === undefined)) return;
    const signature = JSON.stringify(values);
    const first = seen.get(signature);
    if (first === undefined) {
      seen.set(signature, index);
      return;
    }
    const field = fields[0] as string;
    const label =
      fields.length === 1 ? `"${field}"` : fields.map((name) => `"${name}"`).join(' + ');
    errors.push({
      keyword: 'uniqueBy',
      instancePath: `${context?.instancePath ?? ''}/${index}/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      params: { fields, duplicateOf: first },
      message: `must be unique: item ${first} has the same ${label}`,
    });
  });
  if (errors.length === 0) return true;
  (validateUniqueBy as { errors?: Partial<ErrorObject>[] }).errors = errors;
  return false;
}

function instance(): Ajv {
  if (ajv) return ajv;
  ajv = new Ajv({ allErrors: true, strictTypes: false, strictTuples: false });
  addFormats(ajv);
  ajv.addFormat('color', COLOR_PATTERN);
  ajv.addKeyword({
    keyword: 'uniqueBy',
    type: 'array',
    schemaType: ['string', 'array'],
    metaSchema: {
      anyOf: [
        { type: 'string', minLength: 1 },
        { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
      ],
    },
    errors: true,
    validate: validateUniqueBy,
  });
  return ajv;
}

const FORMAT_MESSAGES: Record<string, string> = {
  color: 'must be a color like "#8A5A44" (#RGB or #RRGGBB)',
  'date-time': 'must be a date and time with an offset, like "2026-11-01T09:00:00+07:00"',
  date: 'must be a date like "2026-11-01"',
  time: 'must be a time with an offset, like "09:00:00+07:00"',
  email: 'must be an email address',
  uri: 'must be an absolute URL, like "https://example.com/path"',
};

function toIssue(error: ErrorObject, data: unknown): ValidationIssue {
  const segments = pointerToSegments(error.instancePath, data);
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'required':
      return {
        path: formatPath([...segments, String(params.missingProperty)]),
        message: 'is required',
        keyword: 'required',
      };
    case 'additionalProperties':
      return {
        path: formatPath([...segments, String(params.additionalProperty)]),
        message: 'is not allowed: the schema has no such field',
        keyword: 'additionalProperties',
      };
    case 'format': {
      const format = String(params.format);
      return {
        path: formatPath(segments),
        message: FORMAT_MESSAGES[format] ?? `must match format "${format}"`,
        keyword: 'format',
      };
    }
    case 'enum':
      return {
        path: formatPath(segments),
        message: `must be one of: ${(params.allowedValues as unknown[]).map((value) => JSON.stringify(value)).join(', ')}`,
        keyword: 'enum',
      };
    default:
      return {
        path: formatPath(segments),
        message: error.message ?? 'is invalid',
        keyword: error.keyword,
      };
  }
}

function compile(schema: JsonSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  const cached = compiled.get(key);
  if (cached) return cached;
  const ajv = instance();
  if (compiled.size >= MAX_COMPILED) {
    compiled.clear();
    ajv.removeSchema();
  }
  // A root `$id` would clash when two versions of a schema are compiled.
  const { $id: _id, ...rest } = schema;
  const validate = ajv.compile(rest);
  compiled.set(key, validate);
  return validate;
}

/** Problems with `schema` itself (not a JSON Schema, unknown keywords, ...); empty when usable. */
export function checkSchema(schema: unknown): ValidationIssue[] {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return [{ path: '', message: 'must be a JSON Schema object', keyword: 'type' }];
  }
  const ajv = instance();
  if (!ajv.validateSchema(schema)) {
    return (ajv.errors ?? []).map((error) => toIssue(error, schema));
  }
  try {
    compile(schema as JsonSchema);
  } catch (error) {
    return [
      {
        path: '',
        message: error instanceof Error ? error.message : String(error),
        keyword: 'schema',
      },
    ];
  }
  return [];
}

/** Problems of `value` against `schema`, which must pass {@link checkSchema}. */
export function validateAgainstSchema(schema: JsonSchema, value: unknown): ValidationIssue[] {
  const validate = compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => toIssue(error, value));
}
