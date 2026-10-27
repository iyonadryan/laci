import type { ValidationIssue } from './errors';
import { countSmsSegments } from './sms';
import type { SmsSegments } from './sms';
import {
  checkTemplateSource,
  declaredVariables,
  guardRender,
  prepareData,
  renderField,
} from './template/common';
import { renderPieces, splitTemplate } from './template/engine';
import type { FormatContext, TemplatePiece } from './template/engine';
import type { JsonObject, JsonSchema, MessageChannel } from './types';
import { validateAgainstSchema } from './validation/schema';

export const PROVIDER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
/** Whether the provider (e.g. Meta) approved a WhatsApp template. */
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const WHATSAPP_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
/** Category of a WhatsApp template, as registered with the provider. */
export type WhatsAppCategory = (typeof WHATSAPP_CATEGORIES)[number];

/** A WhatsApp button. The text is fixed; a URL may end with one `{{ variable }}`. */
export type WhatsAppButton =
  { type: 'URL'; text: string; url: string } | { type: 'QUICK_REPLY'; text: string };

/**
 * A WhatsApp template. `header`, `body`, and button URLs are fixed text with `{{ variables }}`
 * (no `{% tags %}`); each `{{ }}` becomes a numbered parameter at the provider. `footer` and
 * button texts are fixed text.
 */
export type WhatsAppTemplateValue = {
  /** The template's name at the provider: lowercase letters, digits, and underscores. */
  providerTemplateName: string;
  category: WhatsAppCategory;
  header?: string;
  body: string;
  footer?: string;
  buttons?: WhatsAppButton[];
  /**
   * Set by you or by `laci.syncProviderStatus`. Changing the reviewed content (name, category,
   * header, body, footer, buttons) of an `APPROVED` template sets it back to `PENDING`.
   */
  providerStatus?: ProviderStatus;
  /** When `laci.syncProviderStatus` stored the current status (ISO 8601). */
  providerSyncedAt?: string;
};

/** An SMS template. `body` is a Liquid template; `senderId` is fixed. */
export type SmsTemplateValue = { body: string; senderId?: string };

/** A push notification template. Every field is a Liquid template. */
export type PushTemplateValue = {
  title: string;
  body: string;
  deepLink?: string;
  imageUrl?: string;
};

/** An in-app message template. Every field is a Liquid template. */
export type InAppTemplateValue = { title?: string; body: string; deepLink?: string };

/** The value of a message template, per channel. */
export interface MessageTemplateValues {
  WHATSAPP: WhatsAppTemplateValue;
  SMS: SmsTemplateValue;
  PUSH: PushTemplateValue;
  IN_APP: InAppTemplateValue;
}

export type MessageTemplateValue = MessageTemplateValues[MessageChannel];

/** Something worth knowing that does not stop saving or sending, e.g. a title that is cut off. */
export interface MessageWarning {
  /** The field, e.g. `title` or `buttons[0].url`. */
  path: string;
  message: string;
  /** `length`, `encoding`, `parameter`, `providerStatus`, or `approvalReset`. */
  code: string;
}

interface RenderedMessageBase {
  /** The locale of the template that was used. */
  locale: string;
  warnings: MessageWarning[];
}

export interface RenderedWhatsAppButton {
  type: WhatsAppButton['type'];
  text: string;
  /** `null` for a quick reply. */
  url: string | null;
  /** The value of the URL's `{{ variable }}`, if it has one: the button's provider parameter. */
  params: string[];
}

/**
 * A rendered WhatsApp template. `header`, `body`, and `buttons` are for previews; to send it,
 * pass `providerTemplateName` and the parameters to the provider: `headerParams` fill `{{1}}`…
 * of the header and `bodyParams` those of the body, in order.
 */
export interface RenderedWhatsApp extends RenderedMessageBase {
  channel: 'WHATSAPP';
  providerTemplateName: string;
  category: WhatsAppCategory;
  providerStatus: ProviderStatus | null;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: RenderedWhatsAppButton[];
  /** `headerParams` followed by `bodyParams`. */
  params: string[];
  /** Value of every `{{ }}` of the header, in order. */
  headerParams: string[];
  /** Value of every `{{ }}` of the body, in order. */
  bodyParams: string[];
}

export interface RenderedSms extends RenderedMessageBase {
  channel: 'SMS';
  body: string;
  senderId: string | null;
  segments: SmsSegments;
}

export interface RenderedPush extends RenderedMessageBase {
  channel: 'PUSH';
  title: string;
  body: string;
  deepLink: string | null;
  imageUrl: string | null;
}

export interface RenderedInApp extends RenderedMessageBase {
  channel: 'IN_APP';
  title: string | null;
  body: string;
  deepLink: string | null;
}

/** What `renderMessage` returns, per channel. */
export interface RenderedMessages {
  WHATSAPP: RenderedWhatsApp;
  SMS: RenderedSms;
  PUSH: RenderedPush;
  IN_APP: RenderedInApp;
}

export type RenderedMessage = RenderedMessages[MessageChannel];

/** `Omit` for each member of a union. */
type WithoutLocale<T> = T extends unknown ? Omit<T, 'locale'> : never;

const text = { type: 'string' };
const required = { type: 'string', minLength: 1 };

/** JSON Schema of the value of each channel. */
export const MESSAGE_VALUE_SCHEMAS: Record<MessageChannel, JsonSchema> = {
  WHATSAPP: {
    type: 'object',
    required: ['providerTemplateName', 'category', 'body'],
    additionalProperties: false,
    properties: {
      providerTemplateName: required,
      category: { enum: [...WHATSAPP_CATEGORIES] },
      header: text,
      body: required,
      footer: text,
      buttons: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'text'],
          additionalProperties: false,
          properties: { type: { enum: ['URL', 'QUICK_REPLY'] }, text: required, url: required },
        },
      },
      providerStatus: { enum: [...PROVIDER_STATUSES] },
      providerSyncedAt: { type: 'string', format: 'date-time' },
    },
  },
  SMS: {
    type: 'object',
    required: ['body'],
    additionalProperties: false,
    properties: { body: required, senderId: { type: 'string', minLength: 1, maxLength: 15 } },
  },
  PUSH: {
    type: 'object',
    required: ['title', 'body'],
    additionalProperties: false,
    properties: { title: required, body: required, deepLink: text, imageUrl: text },
  },
  IN_APP: {
    type: 'object',
    required: ['body'],
    additionalProperties: false,
    properties: { title: text, body: required, deepLink: text },
  },
};

/** Fields rendered as Liquid templates, for the channels other than WhatsApp. */
const TEMPLATE_FIELDS = {
  SMS: ['body'],
  PUSH: ['title', 'body', 'deepLink', 'imageUrl'],
  IN_APP: ['title', 'body', 'deepLink'],
} as const;

const PROVIDER_TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

/** What the provider reviews; changing any of it needs a new approval. */
const REVIEWED_FIELDS = [
  'providerTemplateName',
  'category',
  'header',
  'body',
  'footer',
  'buttons',
] as const;

/** Where push notifications usually get cut off on a phone screen, in characters. */
const PUSH_LIMITS = { title: 40, body: 178 } as const;

/** Limits of WhatsApp templates at Meta, in characters. */
const WHATSAPP_LIMITS = { header: 60, body: 1024, footer: 60, buttonText: 25, buttons: 10 };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function split(source: string): TemplatePiece[] | null {
  try {
    return splitTemplate(source);
  } catch {
    return null;
  }
}

/**
 * Problems with a WhatsApp field: `fixed` fields may not use Liquid at all; the others may use
 * `{{ }}` (each a parameter) but no `{% tags %}`.
 */
function checkWhatsAppSource(
  path: string,
  source: string,
  declared: ReadonlySet<string>,
  fixed: boolean,
): ValidationIssue[] {
  let pieces: TemplatePiece[];
  try {
    pieces = splitTemplate(source);
  } catch (error) {
    // LiquidJS throws Errors.
    const message = `has a template error: ${(error as Error).message}`;
    return [{ path, message, keyword: 'template' }];
  }
  if (fixed) {
    return pieces.every((piece) => piece.kind === 'text')
      ? []
      : [
          {
            path,
            message: 'must be fixed text without {{ }} or {% %}: WhatsApp allows no variables here',
            keyword: 'whatsapp',
          },
        ];
  }
  if (pieces.some((piece) => piece.kind === 'tag')) {
    return [
      {
        path,
        message:
          'must only use {{ variables }}, not {% tags %}: a WhatsApp template is fixed text with numbered parameters',
        keyword: 'whatsapp',
      },
    ];
  }
  return checkTemplateSource(path, source, 'text', declared);
}

function checkWhatsApp(value: WhatsAppTemplateValue, declared: ReadonlySet<string>) {
  const issues: ValidationIssue[] = [];
  if (!PROVIDER_TEMPLATE_NAME.test(value.providerTemplateName)) {
    issues.push({
      path: 'providerTemplateName',
      message: 'must be lowercase letters, digits, and underscores, as at the provider',
      keyword: 'pattern',
    });
  }
  if (value.header !== undefined) {
    issues.push(...checkWhatsAppSource('header', value.header, declared, false));
  }
  issues.push(...checkWhatsAppSource('body', value.body, declared, false));
  if (value.footer !== undefined) {
    issues.push(...checkWhatsAppSource('footer', value.footer, declared, true));
  }
  for (const [index, button] of (value.buttons ?? []).entries()) {
    const path = `buttons[${index}]`;
    issues.push(...checkWhatsAppSource(`${path}.text`, button.text, declared, true));
    // The JSON Schema cannot tell which button type needs a url.
    const url = (button as Fields).url;
    if (button.type === 'QUICK_REPLY') {
      if (url !== undefined) {
        issues.push({
          path: `${path}.url`,
          message: 'must not be set for a QUICK_REPLY button',
          keyword: 'additionalProperties',
        });
      }
    } else if (typeof url === 'string') {
      issues.push(...checkWhatsAppSource(`${path}.url`, url, declared, false));
    } else {
      issues.push({
        path: `${path}.url`,
        message: 'is required for a URL button',
        keyword: 'required',
      });
    }
  }
  return issues;
}

/**
 * Problems with a message template value for `channel`: its shape, template syntax, variables
 * that `schema` does not declare, and WhatsApp's rules.
 */
export function checkMessageTemplate(
  channel: MessageChannel,
  value: unknown,
  schema: JsonSchema,
): ValidationIssue[] {
  const shape = validateAgainstSchema(MESSAGE_VALUE_SCHEMAS[channel], value);
  if (shape.length > 0) return shape;
  const declared = new Set(declaredVariables(schema));
  if (channel === 'WHATSAPP') return checkWhatsApp(value as WhatsAppTemplateValue, declared);
  const fields = value as Fields;
  return TEMPLATE_FIELDS[channel].flatMap((field) => {
    const source = fields[field];
    return typeof source === 'string' ? checkTemplateSource(field, source, 'text', declared) : [];
  });
}

/** The parts of a WhatsApp template as registered with the provider: `{{ }}` become `{{1}}`… */
export interface WhatsAppProviderTemplate {
  header: string | null;
  body: string;
  footer: string | null;
  buttons: { type: WhatsAppButton['type']; text: string; url: string | null }[];
}

/** `source` with its `{{ }}` numbered from `{{1}}`, and how many there are. */
function numbered(source: string): { text: string; count: number } {
  let count = 0;
  const pieces = split(source) ?? [{ kind: 'text', source, text: source }];
  const text = pieces
    .map((piece) => (piece.kind === 'output' ? `{{${++count}}}` : (piece.text ?? piece.source)))
    .join('');
  return { text, count };
}

/**
 * A WhatsApp template as the provider (e.g. Meta) expects it: every `{{ }}` of the header, the
 * body, and each button URL numbered from `{{1}}`, in order. Register it under
 * `providerTemplateName`; `renderMessage` returns the parameters in the same order.
 *
 * `Hi {{ name }}, see you {{ startAt | formatDate: "long" }}` becomes `Hi {{1}}, see you {{2}}`.
 */
export function whatsAppProviderTemplate(value: WhatsAppTemplateValue): WhatsAppProviderTemplate {
  return {
    header: value.header === undefined ? null : numbered(value.header).text,
    body: numbered(value.body).text,
    footer: value.footer ?? null,
    buttons: (value.buttons ?? []).map((button) => ({
      type: button.type,
      text: button.text,
      url: button.type === 'URL' ? numbered(button.url).text : null,
    })),
  };
}

/** Key order does not matter. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isFields(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function reviewedChanged(previous: Fields, next: Fields): boolean {
  return REVIEWED_FIELDS.some(
    (field) =>
      JSON.stringify(canonical(previous[field])) !== JSON.stringify(canonical(next[field])),
  );
}

/**
 * `next` with `providerStatus` set back to `PENDING` when an `APPROVED` WhatsApp template
 * changed what the provider reviewed, since the provider must approve it again.
 */
export function resetProviderApproval(
  previous: WhatsAppTemplateValue,
  next: WhatsAppTemplateValue,
): WhatsAppTemplateValue {
  if (previous.providerStatus !== 'APPROVED' || next.providerStatus !== 'APPROVED') return next;
  return reviewedChanged(previous, next) ? { ...next, providerStatus: 'PENDING' } : next;
}

function providerStatusWarning(status: ProviderStatus | undefined): MessageWarning[] {
  if (status === 'APPROVED') return [];
  const message =
    status === 'PENDING'
      ? 'is PENDING: the provider has not approved this template, so sending it fails until it does'
      : status === 'REJECTED'
        ? 'is REJECTED: the provider refused this template; change it and submit it again'
        : 'is not set: submit the template to the provider, then set or sync its status';
  return [{ path: 'providerStatus', message, code: 'providerStatus' }];
}

/** A warning when `length` is over `limit`: "is[ at least] 45 characters; {rule} 40". */
function tooLong(
  path: string,
  length: number,
  limit: number,
  rule: string,
  atLeast = false,
): MessageWarning[] {
  if (length <= limit) return [];
  const message = `is ${atLeast ? 'at least ' : ''}${length} characters; ${rule} ${limit}`;
  return [{ path, message, code: 'length' }];
}

/** Characters of the fixed text of `source`: a lower bound of its rendered length. */
function fixedLength(source: string): number {
  const pieces = split(source) ?? [];
  return Array.from(pieces.map((piece) => piece.text ?? '').join('')).length;
}

/** Push texts that phones likely cut off; for a template, its fixed text is measured. */
function pushWarnings(title: string, body: string, rendered: boolean): MessageWarning[] {
  const length = (source: string) => (rendered ? Array.from(source).length : fixedLength(source));
  const rule = (field: string) => `phones usually cut the ${field} of a push notification after`;
  return [
    ...tooLong('title', length(title), PUSH_LIMITS.title, rule('title'), !rendered),
    ...tooLong('body', length(body), PUSH_LIMITS.body, rule('body'), !rendered),
  ];
}

function encodingWarning(source: string, rendered: boolean): MessageWarning[] {
  const fixed = rendered ? source : (split(source) ?? []).map((piece) => piece.text ?? '').join('');
  const { nonGsmCharacters } = countSmsSegments(fixed);
  if (nonGsmCharacters.length === 0) return [];
  return [
    {
      path: 'body',
      message: `uses characters outside GSM-7 (${nonGsmCharacters.join(' ')}), so it is sent as UCS-2: 70 characters per SMS instead of 160`,
      code: 'encoding',
    },
  ];
}

function whatsAppWarnings(value: WhatsAppTemplateValue, previous: unknown): MessageWarning[] {
  const provider = whatsAppProviderTemplate(value);
  const warnings: MessageWarning[] = [];
  if (provider.header !== null) {
    warnings.push(
      ...tooLong('header', provider.header.length, WHATSAPP_LIMITS.header, 'WhatsApp allows'),
    );
    const { count } = numbered(value.header as string);
    if (count > 1) {
      warnings.push({
        path: 'header',
        message: `has ${count} variables; WhatsApp allows one in a header`,
        code: 'parameter',
      });
    }
  }
  warnings.push(...tooLong('body', provider.body.length, WHATSAPP_LIMITS.body, 'WhatsApp allows'));
  if (provider.footer !== null) {
    warnings.push(
      ...tooLong('footer', provider.footer.length, WHATSAPP_LIMITS.footer, 'WhatsApp allows'),
    );
  }
  if (provider.buttons.length > WHATSAPP_LIMITS.buttons) {
    warnings.push({
      path: 'buttons',
      message: `has ${provider.buttons.length} buttons; WhatsApp allows ${WHATSAPP_LIMITS.buttons}`,
      code: 'length',
    });
  }
  provider.buttons.forEach((button, index) => {
    const path = `buttons[${index}]`;
    warnings.push(
      ...tooLong(`${path}.text`, button.text.length, WHATSAPP_LIMITS.buttonText, 'WhatsApp allows'),
    );
    if (button.url !== null && /\{\{\d+\}\}/.test(button.url.replace(/\{\{1\}\}$/, ''))) {
      warnings.push({
        path: `${path}.url`,
        message: 'WhatsApp allows one variable in a URL, at its end',
        code: 'parameter',
      });
    }
  });
  if (
    isFields(previous) &&
    previous.providerStatus === 'APPROVED' &&
    value.providerStatus === 'PENDING' &&
    reviewedChanged(previous, value)
  ) {
    warnings.push({
      path: 'providerStatus',
      message:
        'went back from APPROVED to PENDING because the template changed: submit it to the provider for approval again',
      code: 'approvalReset',
    });
  } else {
    warnings.push(...providerStatusWarning(value.providerStatus));
  }
  return warnings;
}

/**
 * Warnings about a message template value: likely cut-off push texts, SMS sent as UCS-2,
 * WhatsApp's limits, and a WhatsApp template that is not approved. Pass the value before a
 * change as `previous` to also warn when the change reset an approval. Returns nothing for a
 * value that is not valid (see {@link checkMessageTemplate}).
 */
export function messageWarnings(
  channel: MessageChannel,
  value: unknown,
  previous?: unknown,
): MessageWarning[] {
  if (validateAgainstSchema(MESSAGE_VALUE_SCHEMAS[channel], value).length > 0) return [];
  switch (channel) {
    case 'WHATSAPP':
      return whatsAppWarnings(value as WhatsAppTemplateValue, previous);
    case 'SMS':
      return encodingWarning((value as SmsTemplateValue).body, false);
    case 'PUSH': {
      const push = value as PushTemplateValue;
      return pushWarnings(push.title, push.body, false);
    }
    case 'IN_APP':
      return [];
  }
}

/** Input of {@link renderMessageTemplate}. */
export interface RenderMessageInput<
  C extends MessageChannel = MessageChannel,
> extends FormatContext {
  channel: C;
  value: MessageTemplateValues[C];
  /** The variable schema; `data` is validated against it. */
  schema: JsonSchema;
  data?: unknown;
  /** Names the template in error messages. Default `"message template"`. */
  name?: string;
}

/** Problems WhatsApp has with a parameter value. */
function parameterWarnings(path: string, params: string[]): MessageWarning[] {
  return params.flatMap((param, index) => {
    const problem =
      param.trim() === ''
        ? 'is empty'
        : /[\n\t]| {5}/.test(param)
          ? 'has a line break, a tab, or more than 4 spaces in a row'
          : null;
    return problem === null
      ? []
      : [
          {
            path,
            message: `parameter {{${index + 1}}} ${problem}, which WhatsApp refuses`,
            code: 'parameter',
          },
        ];
  });
}

async function renderWhatsApp(
  name: string,
  value: WhatsAppTemplateValue,
  data: JsonObject,
  context: FormatContext,
): Promise<Omit<RenderedWhatsApp, 'locale'>> {
  const parameters = async (path: string, source: string) => {
    const pieces = await guardRender(name, path, () => renderPieces(source, data, context));
    return {
      text: pieces.map((piece) => piece.rendered).join(''),
      params: pieces.filter((piece) => piece.kind === 'output').map((piece) => piece.rendered),
    };
  };
  const header = value.header === undefined ? null : await parameters('header', value.header);
  const body = await parameters('body', value.body);
  const buttons: RenderedWhatsAppButton[] = [];
  for (const [index, button] of (value.buttons ?? []).entries()) {
    const url =
      button.type === 'URL' ? await parameters(`buttons[${index}].url`, button.url) : null;
    buttons.push({
      type: button.type,
      text: button.text,
      url: url?.text ?? null,
      params: url?.params ?? [],
    });
  }
  const headerParams = header?.params ?? [];
  return {
    channel: 'WHATSAPP',
    providerTemplateName: value.providerTemplateName,
    category: value.category,
    providerStatus: value.providerStatus ?? null,
    header: header?.text ?? null,
    body: body.text,
    footer: value.footer ?? null,
    buttons,
    params: [...headerParams, ...body.params],
    headerParams,
    bodyParams: body.params,
    warnings: [
      ...providerStatusWarning(value.providerStatus),
      ...parameterWarnings('header', headerParams),
      ...parameterWarnings('body', body.params),
      ...buttons.flatMap((button, index) =>
        parameterWarnings(`buttons[${index}].url`, button.params),
      ),
    ],
  };
}

/**
 * Renders a message template value as plain text (no HTML escaping): what `laci.renderMessage`
 * does after loading the published entry. Useful for previews of unsaved changes.
 */
export async function renderMessageTemplate<C extends MessageChannel>(
  input: RenderMessageInput<C>,
): Promise<RenderedMessages[C]> {
  const name = input.name ?? 'message template';
  const data = prepareData(name, input.schema, input.data);
  const context = { locale: input.locale, timeZone: input.timeZone };
  const render = (field: string, source: string) =>
    renderField(name, field, source, data, 'text', context);
  const optional = async (field: string, source: string | undefined) =>
    source === undefined ? null : render(field, source);

  let rendered: WithoutLocale<RenderedMessage>;
  const channel: MessageChannel = input.channel;
  switch (channel) {
    case 'WHATSAPP':
      rendered = await renderWhatsApp(name, input.value as WhatsAppTemplateValue, data, context);
      break;
    case 'SMS': {
      const value = input.value as SmsTemplateValue;
      const body = await render('body', value.body);
      rendered = {
        channel,
        body,
        senderId: value.senderId ?? null,
        segments: countSmsSegments(body),
        warnings: encodingWarning(body, true),
      };
      break;
    }
    case 'PUSH': {
      const value = input.value as PushTemplateValue;
      const [title, body, deepLink, imageUrl] = await Promise.all([
        render('title', value.title),
        render('body', value.body),
        optional('deepLink', value.deepLink),
        optional('imageUrl', value.imageUrl),
      ]);
      rendered = {
        channel,
        title,
        body,
        deepLink,
        imageUrl,
        warnings: pushWarnings(title, body, true),
      };
      break;
    }
    case 'IN_APP': {
      const value = input.value as InAppTemplateValue;
      const [title, body, deepLink] = await Promise.all([
        optional('title', value.title),
        render('body', value.body),
        optional('deepLink', value.deepLink),
      ]);
      rendered = { channel, title, body, deepLink, warnings: [] };
      break;
    }
  }
  return { ...rendered, locale: input.locale } as RenderedMessages[C];
}
