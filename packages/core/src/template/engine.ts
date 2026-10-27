import { Liquid } from 'liquidjs';

/** `html` escapes every `{{ output }}` (use `| raw` to opt out); `text` outputs as is. */
export type TemplateMode = 'html' | 'text';

/** Locale and time zone that the formatting filters use. */
export interface FormatContext {
  /** BCP 47 locale, e.g. `id-ID`. */
  locale: string;
  /** IANA time zone, e.g. `Asia/Jakarta` or `UTC`. */
  timeZone: string;
}

/** Filters Laci adds to LiquidJS's standard ones. */
export const TEMPLATE_FILTERS = ['formatDate', 'formatNumber'] as const;

/** Tags that would read other templates; Laci templates are self-contained. */
const BLOCKED_TAGS = ['include', 'render', 'layout', 'block'] as const;

/** Time and memory a single render may use, against runaway loops. */
const RENDER_LIMIT_MS = 1000;
const MEMORY_LIMIT = 10_000_000;

const DATE_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short' },
  medium: { dateStyle: 'medium' },
  long: { dateStyle: 'long' },
  full: { dateStyle: 'full' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `{{ value | formatDate: "long", "Asia/Jakarta" }}`. Styles: short, medium (default), long,
 * full, datetime, time. The time zone defaults to the render's time zone. A date without a time
 * (`2026-11-01`) is a calendar date and is never shifted by a time zone. A missing value (an
 * optional variable) gives an empty string.
 */
function formatDate(context: FormatContext, value: unknown, style = 'medium', timeZone?: string) {
  if (value === undefined || value === null) return '';
  const options = DATE_STYLES[style];
  if (!options) {
    throw new Error(
      `formatDate: unknown style "${style}"; use ${Object.keys(DATE_STYLES).join(', ')}`,
    );
  }
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const time =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(dateOnly ? `${value}T00:00:00Z` : value)
        : NaN;
  if (Number.isNaN(time)) throw new Error(`formatDate: ${JSON.stringify(value)} is not a date`);
  return new Intl.DateTimeFormat(context.locale, {
    ...options,
    timeZone: dateOnly ? 'UTC' : (timeZone ?? context.timeZone),
  }).format(time);
}

/**
 * `{{ value | formatNumber }}`, `{{ value | formatNumber: "decimal", 2 }}` (fraction digits),
 * `{{ value | formatNumber: "currency", "IDR" }}`, `{{ value | formatNumber: "percent" }}`. A missing
 * value (an optional variable) gives an empty string.
 */
function formatNumber(context: FormatContext, value: unknown, style = 'decimal', option?: unknown) {
  if (value === undefined || value === null) return '';
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`formatNumber: ${JSON.stringify(value)} is not a number`);
  }
  let options: Intl.NumberFormatOptions;
  if (style === 'decimal') {
    options =
      option === undefined
        ? {}
        : { minimumFractionDigits: Number(option), maximumFractionDigits: Number(option) };
  } else if (style === 'currency') {
    if (typeof option !== 'string') {
      throw new Error(
        'formatNumber: "currency" needs a currency code, e.g. formatNumber: "currency", "IDR"',
      );
    }
    options = { style: 'currency', currency: option };
  } else if (style === 'percent') {
    options = { style: 'percent' };
  } else {
    throw new Error(`formatNumber: unknown style "${style}"; use decimal, currency, percent`);
  }
  return new Intl.NumberFormat(context.locale, options).format(number);
}

/** Engines kept (one per mode, locale, and time zone) before the cache is cleared. */
const MAX_ENGINES = 100;
const engines = new Map<string, Liquid>();

/** A LiquidJS engine for `mode` whose formatting filters use `context`. */
function engine(mode: TemplateMode, context: FormatContext): Liquid {
  const key = JSON.stringify([mode, context.locale, context.timeZone]);
  const cached = engines.get(key);
  if (cached) return cached;
  if (engines.size >= MAX_ENGINES) engines.clear();
  const liquid = new Liquid({
    ...(mode === 'html' ? { outputEscape: 'escape' as const } : {}),
    strictFilters: true,
    ownPropertyOnly: true,
    // No file system: templates cannot read files.
    templates: {},
    renderLimit: RENDER_LIMIT_MS,
    memoryLimit: MEMORY_LIMIT,
  });
  for (const tag of BLOCKED_TAGS) {
    liquid.registerTag(tag, {
      parse() {
        throw new Error(`{% ${tag} %} is not supported: Laci templates are self-contained`);
      },
      // Never runs: parse always throws.
      /* v8 ignore next 3 */
      render() {
        return '';
      },
    });
  }
  liquid.registerFilter('formatDate', (value: unknown, style?: string, timeZone?: string) =>
    formatDate(context, value, style, timeZone),
  );
  liquid.registerFilter('formatNumber', (value: unknown, style?: string, option?: unknown) =>
    formatNumber(context, value, style, option),
  );
  engines.set(key, liquid);
  return liquid;
}

/** For parsing only: the filters' context does not matter. */
const PARSE_CONTEXT: FormatContext = { locale: 'en-US', timeZone: 'UTC' };

/** What {@link analyzeTemplate} found. */
export interface TemplateAnalysis {
  /** The parse error, e.g. `undefined filter: nope, line:1, col:9`; `null` when it parses. */
  error: string | null;
  /** Top-level variables the template reads, e.g. `customer` for `{{ customer.name }}`. */
  variables: string[];
}

/** Parses `source` and lists the variables it reads, without rendering. */
export function analyzeTemplate(source: string, mode: TemplateMode = 'text'): TemplateAnalysis {
  const liquid = engine(mode, PARSE_CONTEXT);
  try {
    const parsed = liquid.parse(source);
    return { error: null, variables: liquid.globalVariablesSync(parsed) };
  } catch (error) {
    return { error: (error as Error).message, variables: [] };
  }
}

/** Renders `source` with `data`. Throws LiquidJS's error when the template fails. */
export function renderTemplate(
  source: string,
  data: Record<string, unknown>,
  mode: TemplateMode,
  context: FormatContext,
): Promise<string> {
  return engine(mode, context).parseAndRender(source, data) as Promise<string>;
}
