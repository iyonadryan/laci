import type { ValidationIssue } from './errors';
import { checkTemplates, oneLine, prepareData, renderField } from './template/common';
import type { FormatContext, TemplateMode } from './template/engine';
import type { JsonSchema } from './types';
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

/** Problems with an email template value: its shape, template syntax, and variables. */
export function checkEmailTemplate(value: unknown, schema: JsonSchema): ValidationIssue[] {
  const shape = validateAgainstSchema(EMAIL_VALUE_SCHEMA, value);
  if (shape.length > 0) return shape;
  return checkTemplates(value as Record<string, unknown>, FIELDS, schema);
}

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
