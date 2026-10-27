import { LaciError, LaciValidationError } from '../errors';
import type { ValidationIssue } from '../errors';
import type { JsonObject, JsonSchema } from '../types';
import { validateAgainstSchema } from '../validation/schema';
import { analyzeTemplate, renderTemplate } from './engine';
import type { FormatContext, TemplateMode } from './engine';

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
 * Problems with one template `source` at `path`: its syntax error, or variables missing from
 * `declared`.
 */
export function checkTemplateSource(
  path: string,
  source: string,
  mode: TemplateMode,
  declared: ReadonlySet<string>,
): ValidationIssue[] {
  const { error, variables } = analyzeTemplate(source, mode);
  if (error !== null) {
    return [{ path, message: `has a template error: ${error}`, keyword: 'template' }];
  }
  return variables
    .filter((variable) => !declared.has(variable))
    .map((variable) => ({
      path,
      message: `uses the variable "${variable}", which the schema does not define`,
      keyword: 'variable',
    }));
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
  return fields.flatMap(([field, mode]) => {
    const source = value[field];
    return typeof source === 'string' ? checkTemplateSource(field, source, mode, declared) : [];
  });
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

/** Runs `render`, wrapping failures in a {@link TemplateRenderError} for `field`. */
export async function guardRender<T>(
  subject: string,
  field: string,
  render: () => Promise<T>,
): Promise<T> {
  try {
    return await render();
  } catch (error) {
    throw new TemplateRenderError(subject, field, error);
  }
}

/** Renders one template field, wrapping failures in a {@link TemplateRenderError}. */
export function renderField(
  subject: string,
  field: string,
  source: string,
  data: JsonObject,
  mode: TemplateMode,
  context: FormatContext,
): Promise<string> {
  return guardRender(subject, field, () => renderTemplate(source, data, mode, context));
}

/** `text` on one line: line breaks become spaces, so data cannot inject headers. */
export const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim();
