import { LaciError, LaciValidationError } from './errors';
import type { ValidationIssue } from './errors';
import { analyzeTemplate, renderTemplate } from './template/engine';
import type { FormatContext, TemplateMode } from './template/engine';
import type { JsonObject, JsonSchema } from './types';
import { validateAgainstSchema } from './validation/schema';

/**
 * The value of an email template entry. Every field is a Liquid template. (A type, not an
 * interface, so that it can be passed where a `JsonValue` is expected.)
 */
export type EmailTemplateValue = {
  /** Display name of the sender, e.g. `"{{ company }} Billing"`. */
  fromName?: string;
  subject: string;
  /** HTML body. `{{ output }}` is HTML-escaped; `{{ output | raw }}` is not. */
  html: string;
  /** Plain-text body, for clients that do not show HTML. */
  text: string;
};

/** What `renderEmail` returns. Sending it is up to your app. */
export interface RenderedEmail {
  /** `null` when the template has no `fromName`. */
  fromName: string | null;
  /** Line breaks are replaced by spaces, so data cannot inject email headers. */
  subject: string;
  html: string;
  text: string;
  /** The locale of the template that was used. */
  locale: string;
}

/** JSON Schema of {@link EmailTemplateValue}. */
export const EMAIL_VALUE_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['subject', 'html', 'text'],
  additionalProperties: false,
  properties: {
    fromName: { type: 'string' },
    subject: { type: 'string', minLength: 1 },
    html: { type: 'string' },
    text: { type: 'string' },
  },
};

const FIELDS: [keyof EmailTemplateValue, TemplateMode][] = [
  ['fromName', 'text'],
  ['subject', 'text'],
  ['html', 'html'],
  ['text', 'text'],
];

/** Thrown when a template fails while rendering, e.g. a filter gets a value it cannot use. */
export class TemplateRenderError extends LaciError {
  /** The field that failed, e.g. `html` or `body`. */
  readonly field: string;

  constructor(subject: string, field: string, cause: unknown) {
    super(
      'TEMPLATE_RENDER_FAILED',
      `Could not render ${field} of ${subject}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.field = field;
  }
}

/** Problems with the variable schema of a template: it must describe an object. */
export function checkVariableSchema(schema: JsonSchema): ValidationIssue[] {
  return schema.type === 'object'
    ? []
    : [
        {
          path: 'type',
          message: 'must be "object": the schema of a template describes its variables',
          keyword: 'type',
        },
      ];
}

/** The variables a template schema declares. */
export function declaredVariables(schema: JsonSchema): string[] {
  const properties = schema.properties;
  return typeof properties === 'object' && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties)
    : [];
}

/**
 * Problems with the templates of `fields` of `value`: syntax errors, and variables that `schema`
 * does not declare. `value` must already have the right shape.
 */
export function checkTemplates(
  value: Record<string, unknown>,
  fields: readonly (readonly [string, TemplateMode])[],
  schema: JsonSchema,
): ValidationIssue[] {
  const declared = new Set(declaredVariables(schema));
  const issues: ValidationIssue[] = [];
  for (const [field, mode] of fields) {
    const source = value[field];
    if (typeof source !== 'string') continue;
    const { error, variables } = analyzeTemplate(source, mode);
    if (error !== null) {
      issues.push({ path: field, message: `has a template error: ${error}`, keyword: 'template' });
      continue;
    }
    for (const variable of variables) {
      if (!declared.has(variable)) {
        issues.push({
          path: field,
          message: `uses the variable "${variable}", which the schema does not define`,
          keyword: 'variable',
        });
      }
    }
  }
  return issues;
}

/** Problems with an email template value: its shape, template syntax, and variables. */
export function checkEmailTemplate(value: unknown, schema: JsonSchema): ValidationIssue[] {
  const shape = validateAgainstSchema(EMAIL_VALUE_SCHEMA, value);
  if (shape.length > 0) return shape;
  return checkTemplates(value as Record<string, unknown>, FIELDS, schema);
}

/**
 * `data` as plain JSON (dates become ISO strings), validated against the variable `schema`.
 * Throws a {@link LaciValidationError} with `target: "data"`, so a missing required variable
 * is an error instead of an empty gap in the message.
 */
export function prepareData(subject: string, schema: JsonSchema, data: unknown): JsonObject {
  const json: unknown = data === undefined ? {} : JSON.parse(JSON.stringify(data));
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new LaciValidationError(subject, 'data', [
      { path: '', message: 'must be an object of template variables', keyword: 'type' },
    ]);
  }
  const issues = validateAgainstSchema(schema, json);
  if (issues.length > 0) throw new LaciValidationError(subject, 'data', issues);
  return json as JsonObject;
}

/** Renders one template field, wrapping failures in a {@link TemplateRenderError}. */
export async function renderField(
  subject: string,
  field: string,
  source: string,
  data: JsonObject,
  mode: TemplateMode,
  context: FormatContext,
): Promise<string> {
  try {
    return await renderTemplate(source, data, mode, context);
  } catch (error) {
    throw new TemplateRenderError(subject, field, error);
  }
}

const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

/** Input of {@link renderEmailTemplate}. */
export interface RenderEmailInput extends FormatContext {
  value: EmailTemplateValue;
  /** The variable schema; `data` is validated against it. */
  schema: JsonSchema;
  data?: unknown;
  /** Names the template in error messages. Default `"email template"`. */
  name?: string;
}

/**
 * Renders an email template value: what `laci.renderEmail` does after loading the published
 * entry. Useful for previews of unsaved changes.
 */
export async function renderEmailTemplate(input: RenderEmailInput): Promise<RenderedEmail> {
  const name = input.name ?? 'email template';
  const data = prepareData(name, input.schema, input.data);
  const context = { locale: input.locale, timeZone: input.timeZone };
  const render = (field: keyof EmailTemplateValue, mode: TemplateMode) =>
    renderField(name, field, input.value[field] ?? '', data, mode, context);
  const [fromName, subject, html, text] = await Promise.all(
    FIELDS.map(([field, mode]) => render(field, mode)),
  );
  return {
    fromName: input.value.fromName === undefined ? null : oneLine(fromName as string),
    subject: oneLine(subject as string),
    html: html as string,
    text: text as string,
    locale: input.locale,
  };
}
