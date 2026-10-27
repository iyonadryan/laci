import type { JsonObject, JsonSchema, JsonValue } from '@lacijs/core';
import { isObject } from './json';

/** How the form edits a schema. */
export type FieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null'
  | 'enum'
  | 'object'
  | 'map'
  | 'array'
  | 'unknown';

/** The schema of a property, list item, or map value; `{}` when there is none. */
export function child(schema: JsonValue | undefined): JsonSchema {
  return isObject(schema) ? schema : {};
}

/** The non-null type of `schema`, and whether `null` is allowed too. */
export function typeOf(schema: JsonSchema): { type: string | null; nullable: boolean } {
  const type = schema.type;
  if (typeof type === 'string') return { type, nullable: type === 'null' };
  if (Array.isArray(type)) {
    const types = type.filter((item): item is string => typeof item === 'string');
    const others = types.filter((item) => item !== 'null');
    return {
      type: others.length === 1 ? (others[0] as string) : null,
      nullable: types.includes('null'),
    };
  }
  return { type: null, nullable: false };
}

/** Which input edits `schema`. */
export function fieldKind(schema: JsonSchema): FieldKind {
  if (Array.isArray(schema.enum)) return 'enum';
  const { type, nullable } = typeOf(schema);
  if (type === null) return nullable ? 'null' : 'unknown';
  if (type === 'object') {
    return isObject(schema.additionalProperties) && !isObject(schema.properties) ? 'map' : 'object';
  }
  if (['string', 'number', 'integer', 'boolean', 'null', 'array'].includes(type)) {
    return type as FieldKind;
  }
  return 'unknown';
}

const format = (schema: JsonSchema) => (typeof schema.format === 'string' ? schema.format : null);

/** A short type name for people: `string`, `date`, `color`, `list of object`, … */
export function typeLabel(schema: JsonSchema): string {
  const kind = fieldKind(schema);
  if (kind === 'string') {
    const name = format(schema);
    return name === 'uri' ? 'url' : (name ?? 'string');
  }
  if (kind === 'array') return `list of ${typeLabel(child(schema.items))}`;
  if (kind === 'unknown') return 'any';
  return kind;
}

/** The label of a config in lists: what kind of value it holds. */
export function entryTypeLabel(schema: JsonSchema): string {
  const kind = fieldKind(schema);
  const name = format(schema);
  if (kind === 'array') return 'List';
  if (kind === 'boolean' || (kind === 'string' && (name === 'date-time' || name === 'date'))) {
    return 'Feature flag';
  }
  if (
    (kind === 'string' && name === 'uri') ||
    (kind === 'map' && format(child(schema.additionalProperties)) === 'uri')
  ) {
    return 'Link';
  }
  if (kind === 'number' || kind === 'integer') return 'Number';
  if (kind === 'string' || kind === 'enum') return 'Text';
  return 'Object';
}

/** A new value for `schema`: its default, or an empty value of its type. */
export function defaultValue(schema: JsonSchema): JsonValue {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.const !== undefined) return structuredClone(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0] as JsonValue;
  const { type, nullable } = typeOf(schema);
  if (nullable && type !== 'object' && type !== 'array') return null;
  switch (type) {
    case 'string':
      return format(schema) === 'color' ? '#000000' : '';
    case 'number':
    case 'integer':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return false;
    case 'array': {
      const count = typeof schema.minItems === 'number' ? schema.minItems : 0;
      return Array.from({ length: count }, () => defaultValue(child(schema.items)));
    }
    case 'object': {
      const value: JsonObject = {};
      const properties = child(schema.properties);
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const name of required) {
        if (typeof name === 'string') value[name] = defaultValue(child(properties[name]));
      }
      return value;
    }
    default:
      return null;
  }
}

/** Data that fits a template's variable schema, for previews. */
export function sampleData(schema: JsonSchema, name = 'value'): JsonValue {
  if (schema.default !== undefined) return structuredClone(schema.default);
  // The examples of the whole template are the sample data sets; a variable's are its values.
  if (Array.isArray(schema.examples) && schema.examples.length > 0 && name !== 'value') {
    return structuredClone(schema.examples[0] as JsonValue);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0] as JsonValue;
  const { type } = typeOf(schema);
  switch (type) {
    case 'string':
      switch (format(schema)) {
        case 'date':
          return '2026-11-01';
        case 'date-time':
          return '2026-11-01T09:00:00+07:00';
        case 'uri':
          return 'https://example.com';
        case 'email':
          return 'name@example.com';
        case 'color':
          return '#8A5A44';
        default:
          return name;
      }
    case 'number':
    case 'integer':
      return 1500;
    case 'boolean':
      return true;
    case 'array':
      return [sampleData(child(schema.items), name)];
    case 'object': {
      const value: JsonObject = {};
      for (const [key, property] of Object.entries(child(schema.properties))) {
        value[key] = sampleData(child(property), key);
      }
      return value;
    }
    default:
      return null;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const URL_PATTERN = /^https?:\/\/\S+$/;

/** A schema for the shape of `sample`, as a starting point. */
export function inferSchema(sample: JsonValue): JsonSchema {
  if (sample === null) return { type: 'null' };
  if (typeof sample === 'boolean') return { type: 'boolean' };
  if (typeof sample === 'number') return { type: Number.isInteger(sample) ? 'integer' : 'number' };
  if (typeof sample === 'string') {
    if (DATE.test(sample)) return { type: 'string', format: 'date' };
    if (DATE_TIME.test(sample)) return { type: 'string', format: 'date-time' };
    if (COLOR.test(sample)) return { type: 'string', format: 'color' };
    if (URL_PATTERN.test(sample)) return { type: 'string', format: 'uri' };
    return { type: 'string' };
  }
  if (Array.isArray(sample)) {
    if (sample.length === 0) return { type: 'array', items: {} };
    if (sample.every(isObject)) return { type: 'array', items: inferObjects(sample) };
    return { type: 'array', items: inferSchema(sample[0] as JsonValue) };
  }
  return inferObjects([sample]);
}

/** One object schema for several objects: a property is required when all of them have it. */
function inferObjects(samples: JsonObject[]): JsonSchema {
  const properties: JsonObject = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample)) {
      const known = properties[key];
      // A `null` tells little: a later sample with a value decides.
      if (known === undefined || (isObject(known) && known.type === 'null' && value !== null)) {
        properties[key] = inferSchema(value);
      }
    }
  }
  const required = Object.keys(properties).filter((key) =>
    samples.every((sample) => key in sample),
  );
  return { type: 'object', ...(required.length > 0 ? { required } : {}), properties };
}

/** The variables a template schema declares, for the variables panel and insert buttons. */
export function variablesOf(
  schema: JsonSchema,
): { name: string; type: string; required: boolean }[] {
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(child(schema.properties)).map(([name, property]) => ({
    name,
    type: typeLabel(child(property)),
    required: required.has(name),
  }));
}
