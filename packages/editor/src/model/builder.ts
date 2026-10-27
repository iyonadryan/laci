import type { JsonObject, JsonSchema, JsonValue } from '@lacijs/core';
import { isObject } from './json';
import { child, typeOf } from './schema';

/** Field types of the schema builder; several map to `string` with a `format`. */
export const BUILDER_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'date-time',
  'enum',
  'url',
  'email',
  'color',
  'object',
  'map',
  'array',
  'any',
] as const;
export type BuilderType = (typeof BUILDER_TYPES)[number];

const FORMATS: Partial<Record<BuilderType, string>> = {
  date: 'date',
  'date-time': 'date-time',
  url: 'uri',
  email: 'email',
  color: 'color',
};

/** Validation rules the properties panel edits, per type. */
export const RULES: Partial<Record<BuilderType, readonly string[]>> = {
  string: ['minLength', 'maxLength', 'pattern'],
  url: ['minLength', 'maxLength'],
  email: ['minLength', 'maxLength'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
  array: ['minItems', 'maxItems', 'uniqueBy'],
};

const RULE_KEYS = new Set(Object.values(RULES).flat());

/**
 * One field of the builder's tree: the root, a property of an object, the item of a list, or
 * the value of a map.
 */
export interface FieldNode {
  id: string;
  role: 'root' | 'property' | 'item' | 'value';
  /** The property name; `""` for the other roles. */
  name: string;
  type: BuilderType;
  required: boolean;
  nullable: boolean;
  /** The label shown in the form (`title`). */
  title: string;
  /** The help text shown in the form (`description`). */
  description: string;
  /** Values of an `enum`. */
  options: JsonValue[];
  rules: JsonObject;
  /** Keywords the builder does not edit, kept as they are. */
  extra: JsonObject;
  /** Properties of an object. */
  children: FieldNode[];
  /** Item of a list, value of a map. */
  inner: FieldNode | null;
}

let nextId = 0;
const newId = () => `field-${++nextId}`;

/** A new field of `type`. */
export function newField(
  type: BuilderType,
  name = '',
  role: FieldNode['role'] = 'property',
): FieldNode {
  return {
    id: newId(),
    role,
    name,
    type,
    required: false,
    nullable: false,
    title: '',
    description: '',
    options: type === 'enum' ? ['option'] : [],
    rules: {},
    extra: {},
    children: [],
    inner:
      type === 'array'
        ? newField('string', '', 'item')
        : type === 'map'
          ? newField('string', '', 'value')
          : null,
  };
}

function builderType(schema: JsonSchema): BuilderType {
  if (Array.isArray(schema.enum)) return 'enum';
  const { type } = typeOf(schema);
  const format = typeof schema.format === 'string' ? schema.format : null;
  if (type === 'string') {
    const known = (Object.entries(FORMATS) as [BuilderType, string][]).find(
      ([, name]) => name === format,
    );
    return known ? known[0] : 'string';
  }
  if (type === 'object') {
    return isObject(schema.additionalProperties) && !isObject(schema.properties) ? 'map' : 'object';
  }
  if (type === 'number' || type === 'integer' || type === 'boolean' || type === 'array')
    return type;
  return 'any';
}

/** The builder's tree of `schema`. */
export function schemaToTree(
  schema: JsonSchema,
  role: FieldNode['role'] = 'root',
  name = '',
  required = false,
): FieldNode {
  const type = builderType(schema);
  const node = newField(type, name, role);
  node.required = required;
  node.nullable = typeOf(schema).nullable;
  const consumed = new Set(['title', 'description']);
  if (typeof schema.title === 'string') node.title = schema.title;
  if (typeof schema.description === 'string') node.description = schema.description;
  if (type !== 'any') consumed.add('type');
  if (FORMATS[type]) consumed.add('format');
  if (type === 'enum') {
    // A nullable enum lists `null`; the builder adds it back from `nullable`.
    node.options = (schema.enum as JsonValue[]).filter(
      (option) => !(node.nullable && option === null),
    );
    consumed.add('enum');
  }
  for (const rule of RULES[type] ?? []) {
    if (schema[rule] !== undefined) {
      node.rules[rule] = schema[rule];
      consumed.add(rule);
    }
  }
  if (type === 'object') {
    const requiredNames = new Set(Array.isArray(schema.required) ? schema.required : []);
    node.children = Object.entries(child(schema.properties)).map(([key, property]) =>
      schemaToTree(child(property), 'property', key, requiredNames.has(key)),
    );
    consumed.add('properties').add('required');
  }
  if (type === 'array') {
    node.inner = schemaToTree(child(schema.items), 'item');
    consumed.add('items');
  }
  if (type === 'map') {
    node.inner = schemaToTree(child(schema.additionalProperties), 'value');
    consumed.add('additionalProperties');
  }
  if (type === 'any') node.nullable = false;
  for (const [key, value] of Object.entries(schema)) {
    if (!consumed.has(key)) node.extra[key] = value;
  }
  return node;
}

/** The JSON Schema of a builder tree. */
export function treeToSchema(node: FieldNode): JsonSchema {
  const schema: JsonSchema = {};
  if (node.title) schema.title = node.title;
  if (node.description) schema.description = node.description;
  const typed =
    node.type !== 'any' &&
    (node.type !== 'enum' ||
      node.options.every((option) => typeof option === 'string' || option === null));
  if (typed) {
    const base =
      node.type in FORMATS || node.type === 'enum'
        ? 'string'
        : node.type === 'map'
          ? 'object'
          : node.type;
    schema.type = node.nullable ? [base, 'null'] : base;
    const format = FORMATS[node.type];
    if (format) schema.format = format;
  }
  if (node.type === 'enum') schema.enum = node.nullable ? [...node.options, null] : node.options;
  for (const [rule, value] of Object.entries(node.rules)) {
    if (RULE_KEYS.has(rule) && (RULES[node.type] ?? []).includes(rule)) schema[rule] = value;
  }
  Object.assign(schema, node.extra);
  if (node.type === 'object') {
    const required = node.children.filter((field) => field.required).map((field) => field.name);
    if (required.length > 0) schema.required = required;
    schema.properties = Object.fromEntries(
      node.children.map((field) => [field.name, treeToSchema(field)]),
    );
  }
  if (node.type === 'array' && node.inner) schema.items = treeToSchema(node.inner);
  if (node.type === 'map' && node.inner) schema.additionalProperties = treeToSchema(node.inner);
  return schema;
}

/** `node` with the field `id` replaced by `update(field)`. */
export function updateField(
  node: FieldNode,
  id: string,
  update: (field: FieldNode) => FieldNode | null,
): FieldNode {
  if (node.id === id) return update(node) ?? node;
  const children = node.children.flatMap((field) => {
    if (field.id === id) {
      const next = update(field);
      return next ? [next] : [];
    }
    return [updateField(field, id, update)];
  });
  const inner = node.inner ? updateField(node.inner, id, update) : null;
  return { ...node, children, inner };
}

/** `field` changed to `type`, keeping what still applies. */
export function changeType(field: FieldNode, type: BuilderType): FieldNode {
  const fresh = newField(type, field.name, field.role);
  return {
    ...fresh,
    id: field.id,
    required: field.required,
    nullable: field.nullable,
    title: field.title,
    description: field.description,
    extra: field.extra,
    children: type === 'object' ? field.children : [],
    inner: (type === 'array' || type === 'map') && field.inner ? field.inner : fresh.inner,
  };
}

/** A name for a new property of `object` that it does not have yet. */
export function freeName(object: FieldNode, base = 'field'): string {
  const taken = new Set(object.children.map((field) => field.name));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}${index}`)) index++;
  return `${base}${index}`;
}

/** One row of the tree view. */
export interface FieldRow {
  field: FieldNode;
  depth: number;
  /** E.g. `[].sessions[].slots`, or the key for the root. */
  path: string;
}

/** The tree as rows, depth first. */
export function flattenTree(node: FieldNode, rootLabel: string): FieldRow[] {
  const rows: FieldRow[] = [];
  const walk = (field: FieldNode, depth: number, path: string) => {
    rows.push({ field, depth, path });
    for (const property of field.children) {
      walk(property, depth + 1, field.role === 'root' ? property.name : `${path}.${property.name}`);
    }
    if (field.inner) {
      const base = field.role === 'root' ? '' : path;
      walk(field.inner, depth + 1, field.inner.role === 'item' ? `${base}[]` : `${base}{}`);
    }
  };
  walk(node, 0, rootLabel);
  return rows;
}

/** Starting points for a new config. */
export const CONFIG_PRESETS: Record<string, JsonSchema> = {
  single: { type: 'string' },
  flag: { type: ['string', 'null'], format: 'date-time', title: 'Go-live date' },
  links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
  strings: { type: 'array', items: { type: 'string' } },
  objects: {
    type: 'array',
    items: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  },
  colors: {
    type: 'array',
    uniqueBy: 'category',
    items: {
      type: 'object',
      required: ['category', 'label', 'background', 'text'],
      properties: {
        category: { type: 'string' },
        label: { type: 'string' },
        background: { type: 'string', format: 'color' },
        text: { type: 'string', format: 'color' },
      },
    },
  },
};

/** The variable schema a new template starts with. */
export const TEMPLATE_PRESET: JsonSchema = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' } },
};
