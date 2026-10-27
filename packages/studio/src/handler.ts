import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkEmailTemplate,
  checkMessageTemplate,
  checkVariableSchema,
  ENTRY_KINDS,
  ENTRY_STATUSES,
  EntryExistsError,
  EntryNotFoundError,
  LaciError,
  LaciValidationError,
  MESSAGE_CHANNELS,
  messageWarnings,
  renderEmailTemplate,
  renderMessageTemplate,
  TemplateRenderError,
  UnexpectedValueError,
  UnknownEnvironmentError,
  VersionConflictError,
} from '@lacijs/core';
import type {
  EmailTemplateValue,
  Entry,
  EntryChanges,
  EntryKind,
  EntryQuery,
  EntrySelector,
  EntryStatus,
  JsonSchema,
  JsonValue,
  Laci,
  MessageChannel,
  MessageTemplateValue,
  MessageWarning,
  PromoteChange,
  RenderedEmail,
  RenderedMessage,
} from '@lacijs/core';
import { CSRF_HEADER } from './shared';
import type { StudioUser } from './shared';

export { CSRF_HEADER } from './shared';
export type { StudioUser } from './shared';

/** Options shared by `startStudio` and the framework adapters. */
export interface StudioOptions {
  /** Your Laci instance. The studio reads and writes through it, so through its store. */
  laci: Laci;
  /**
   * Which database the studio writes to, e.g. "PRODUCTION" or "staging". Shown in the header
   * and the save dialog; a label containing "prod" is shown in red.
   */
  label?: string;
  /** Turns the studio on or off. Default: on, unless `NODE_ENV` is `production`. */
  enabled?: boolean;
  /**
   * Sends a test of a rendered template, e.g. with your mail service. Without it, the studio
   * has no "Send test" button and `POST api/send-test` is refused.
   */
  sendTest?: SendTest;
}

/** A rendered email for {@link StudioOptions.sendTest}. */
export interface SendTestEmail {
  kind: 'EMAIL_TEMPLATE';
  channel: null;
  /** The template's key, or `null` for a template that has not been saved. */
  key: string | null;
  rendered: RenderedEmail;
  /** Where to send it, as typed in the studio. */
  to: string;
}

/** A rendered message template (WhatsApp, SMS, push, in-app) for {@link StudioOptions.sendTest}. */
export interface SendTestMessageTemplate {
  kind: 'MESSAGE_TEMPLATE';
  channel: MessageChannel;
  /** The template's key, or `null` for a template that has not been saved. */
  key: string | null;
  rendered: RenderedMessage;
  /** Where to send it, as typed in the studio: a phone number, a device, a user ID... */
  to: string;
}

/** What {@link StudioOptions.sendTest} is asked to send. */
export type SendTestMessage = SendTestEmail | SendTestMessageTemplate;

/** An entry as the studio API returns it. */
export type StudioEntry = Entry & {
  /**
   * Message templates: see `messageWarnings` of `@lacijs/core`. Templates also warn with code
   * `schemaMismatch` when another locale of the template has a different variable schema.
   * Empty for configs.
   */
  warnings: MessageWarning[];
};

/** What `POST api/entries/:key/promote` returns. */
export interface StudioPromoteResult {
  changes: (PromoteChange & { entry: StudioEntry })[];
}

/** Sends a test message; throw to report a failure to the studio user. */
export type SendTest = (message: SendTestMessage) => void | Promise<void>;

/** What the caller of a {@link StudioHandler} knows about the request. */
export interface StudioRequestContext {
  /** Path below the mount point, starting with `/` (e.g. `/api/entries`). */
  path: string;
  /** The authorized user, or `null` when the caller allows anonymous access. */
  user: StudioUser | null;
}

/** Serves the studio UI and its API for an already authorized request. */
export type StudioHandler = (request: Request, context: StudioRequestContext) => Promise<Response>;

/** A value may be 1 MB; its schema and the JSON around them come on top. */
const MAX_BODY_BYTES = 5_000_000;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

/** Whether the studio runs: `enabled`, or on unless `NODE_ENV` is `production`. */
export function isStudioEnabled(options: Pick<StudioOptions, 'enabled'>): boolean {
  return options.enabled ?? process.env.NODE_ENV !== 'production';
}

/** The notice logged instead of starting the studio. */
export const DISABLED_MESSAGE =
  'Laci Studio is off because NODE_ENV is "production". Pass `enabled: true` to turn it on.';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'The request body is too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
  if (!isObject(body)) throw new HttpError(400, 'The request body must be a JSON object.');
  return body;
}

/** `value` if it is one of `allowed`; `undefined` when missing; 400 otherwise. */
function oneOf<T extends string>(
  name: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new HttpError(400, `"${name}" must be one of: ${allowed.join(', ')}.`);
}

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `"${name}" must be a string.`);
  return value;
}

function integer(name: string, value: unknown, { min = 0 } = {}): number {
  const number = typeof value === 'string' && value !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min) {
    throw new HttpError(400, `"${name}" must be an integer of at least ${min}.`);
  }
  return number;
}

/** Which entry a request is about, from query parameters (or a body). */
function selectorOf(source: (name: string) => unknown): EntrySelector {
  const kind = oneOf<EntryKind>('kind', source('kind'), ENTRY_KINDS);
  const environment = optionalString('environment', source('environment'));
  const locale = optionalString('locale', source('locale'));
  const channel = oneOf<MessageChannel>('channel', source('channel'), MESSAGE_CHANNELS);
  return {
    ...(kind ? { kind } : {}),
    ...(environment ? { environment } : {}),
    ...(locale ? { locale } : {}),
    ...(channel ? { channel } : {}),
  };
}

function listQuery(params: URLSearchParams): EntryQuery {
  const query: EntryQuery = {};
  const get = (name: string) => params.get(name) ?? undefined;
  const kind = oneOf<EntryKind>('kind', get('kind'), ENTRY_KINDS);
  if (kind) query.kind = kind;
  const environment = optionalString('environment', get('environment'));
  if (environment) query.environment = environment;
  // "none" lists the entries without a locale (configs) or channel (configs and emails).
  const locale = get('locale');
  if (locale) query.locale = locale === 'none' ? null : locale;
  const channel = get('channel');
  if (channel) {
    query.channel =
      channel === 'none' ? null : oneOf<MessageChannel>('channel', channel, MESSAGE_CHANNELS);
  }
  const status = get('status');
  if (status) {
    query.status = status
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => oneOf<EntryStatus>('status', part, ENTRY_STATUSES) as EntryStatus);
  }
  const key = get('key');
  if (key) query.key = key;
  const search = get('search');
  if (search) query.search = search;
  const limit = get('limit');
  if (limit !== undefined) query.limit = integer('limit', limit, { min: 1 });
  const offset = get('offset');
  if (offset !== undefined) query.offset = integer('offset', offset);
  return query;
}

/** JSON of `value` with sorted object keys, to compare schemas. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );
}

/** What a preview or test renders: a stored template, or an unsaved one. */
interface TemplateSource {
  /** Names the template in error messages. */
  name: string;
  value: unknown;
  schema: JsonSchema;
  locale: string;
  timeZone: string;
  data: unknown;
}

function changesOf(body: Record<string, unknown>): EntryChanges {
  const changes: EntryChanges = {};
  if ('value' in body) changes.value = body.value as JsonValue;
  if (body.schema !== undefined) {
    if (!isObject(body.schema)) throw new HttpError(400, '"schema" must be a JSON Schema object.');
    changes.schema = body.schema as JsonSchema;
  }
  const status = oneOf<EntryStatus>('status', body.status, ENTRY_STATUSES);
  if (status) changes.status = status;
  if (body.description === null) changes.description = null;
  else if (body.description !== undefined) {
    const description = optionalString('description', body.description);
    changes.description = description ?? null;
  }
  return changes;
}

/**
 * The studio's request handler: the UI files and a JSON API over `laci`. It does not check who
 * is calling; `startStudio` and the framework adapters do that before calling it. When the
 * studio is disabled (see {@link isStudioEnabled}) every request gets a plain 404.
 *
 * API (below the mount point), with the entry selected by the query parameters `kind`,
 * `environment`, `locale`, and `channel`:
 *
 * - `GET api/session`: the label, the user, and Laci's environments and locales
 * - `GET api/entries`: list, filtered by `kind`, `key`, `environment`, `locale`, `channel`,
 *   `status` (comma-separated), `search`, `limit`, `offset`
 * - `POST api/entries`: create (409 when it exists)
 * - `GET api/entries/:key`: one entry, in any status
 * - `PUT api/entries/:key`: change value, schema, status, or description (`expectedVersion`
 *   required)
 * - `GET api/entries/:key/history`: versions, newest first
 * - `POST api/entries/:key/rollback`: restore a version (`version`, `expectedVersion`)
 * - `POST api/entries/:key/promote`: copy to another data environment (`from`, `to`, `kind`,
 *   `locale`, `channel`; `all` for every locale and channel; `expectedVersion`, `sourceVersion`;
 *   `dryRun` to only plan it)
 * - `POST api/entries/:key/sync-provider-status`: ask `syncProviderStatus` for the status of
 *   a WhatsApp template and store it
 * - `POST api/preview/email`: render a stored (`key`) or unsaved (`value`, `schema`) email with
 *   `data`; drafts too
 * - `POST api/preview/message`: the same for a message template of `channel`
 * - `POST api/send-test`: render like a preview (`kind` picks email or message) and pass it to
 *   `sendTest` with `to`
 *
 * Responses with one entry add its `warnings` (see `messageWarnings`).
 */
export function createStudioHandler(options: StudioOptions & { uiDir?: string }): StudioHandler {
  if (!isStudioEnabled(options)) {
    console.warn(DISABLED_MESSAGE);
    return () => Promise.resolve(new Response('Not found.', { status: 404 }));
  }
  const { laci } = options;

  /** A warning when other locales of the template `entry` have a different variable schema. */
  async function schemaMismatch(entry: Entry): Promise<MessageWarning[]> {
    if (entry.kind === 'CONFIG') return [];
    const { items } = await laci.listEntries({
      key: entry.key,
      kind: entry.kind,
      environment: entry.environment,
      channel: entry.channel,
      limit: 500,
    });
    const schema = canonicalJson(entry.schema);
    const locales = items
      .filter((other) => other.id !== entry.id && canonicalJson(other.schema) !== schema)
      .map((other) => other.locale as string);
    if (locales.length === 0) return [];
    return [
      {
        path: 'schema',
        message: `differs from the schema of locale ${locales.join(', ')}: every locale of a template should have the same variables`,
        code: 'schemaMismatch',
      },
    ];
  }

  /** `entry` with its warnings; with `previous`, also whether the change reset an approval. */
  async function withWarnings(entry: Entry, previous: Entry | null = null): Promise<StudioEntry> {
    const message =
      entry.kind === 'MESSAGE_TEMPLATE' && entry.channel !== null
        ? messageWarnings(entry.channel, entry.value, previous?.value)
        : [];
    return { ...entry, warnings: [...message, ...(await schemaMismatch(entry))] };
  }

  const uiDir = normalize(options.uiDir ?? fileURLToPath(new URL('../dist/ui/', import.meta.url)));

  async function api(request: Request, path: string, user: StudioUser | null): Promise<Response> {
    const segments = path.split('/').slice(1).map(decodeURIComponent);
    const method = request.method;
    if (method !== 'GET' && request.headers.get(CSRF_HEADER) !== '1') {
      throw new HttpError(403, `Missing the ${CSRF_HEADER} header.`);
    }
    const params = new URL(request.url).searchParams;
    const by = user ? { by: user.id } : {};
    const [resource, key, sub] = segments;

    if (method === 'GET' && segments.length === 1 && resource === 'session') {
      return json(200, {
        label: options.label ?? null,
        user,
        // The runtime environment: where this server runs, not which data it edits.
        runtime: process.env.NODE_ENV ?? 'development',
        environment: laci.environment,
        environments: laci.environments,
        defaultLocale: laci.defaultLocale,
        kinds: ENTRY_KINDS,
        statuses: ENTRY_STATUSES,
        channels: MESSAGE_CHANNELS,
        timeZone: laci.timeZone,
        sendTest: options.sendTest !== undefined,
        providerSync: laci.canSyncProviderStatus,
      });
    }
    if (method === 'POST' && segments.length === 2 && resource === 'preview' && key === 'email') {
      return json(200, await renderEmail(await readJson(request)));
    }
    if (method === 'POST' && segments.length === 2 && resource === 'preview' && key === 'message') {
      return json(200, await renderMessage(await readJson(request)));
    }
    if (method === 'POST' && segments.length === 1 && resource === 'send-test') {
      return json(200, await sendTest(await readJson(request)));
    }
    if (resource !== 'entries') throw new HttpError(404, 'Not found.');

    if (segments.length === 1) {
      if (method === 'GET') return json(200, await laci.listEntries(listQuery(params)));
      if (method === 'POST') {
        const body = await readJson(request);
        const entryKey = optionalString('key', body.key);
        if (!entryKey) throw new HttpError(400, '"key" is required.');
        if (!isObject(body.schema))
          throw new HttpError(400, '"schema" must be a JSON Schema object.');
        if (!('value' in body)) throw new HttpError(400, '"value" is required.');
        const selector = selectorOf((name) => body[name]);
        // `define` returns an existing entry; creating from the studio must not.
        const existing = await laci.getEntry(entryKey, selector);
        if (existing) throw new EntryExistsError(existing);
        const description = optionalString('description', body.description);
        const note = optionalString('note', body.note);
        const status = oneOf<EntryStatus>('status', body.status, ENTRY_STATUSES);
        const entry = await laci.define(entryKey, {
          ...selector,
          schema: body.schema as JsonSchema,
          value: body.value as JsonValue,
          ...(description ? { description } : {}),
          ...(status ? { status } : {}),
          ...(note ? { note } : {}),
          ...by,
        });
        return json(201, await withWarnings(entry));
      }
    }

    if (key !== undefined) {
      const selector = selectorOf((name) => params.get(name) ?? undefined);
      if (segments.length === 2) {
        if (method === 'GET') {
          const entry = await laci.getEntry(key, selector);
          if (!entry) throw new EntryNotFoundError({ key, ...selector });
          return json(200, await withWarnings(entry));
        }
        if (method === 'PUT') {
          const body = await readJson(request);
          const expectedVersion = integer('expectedVersion', body.expectedVersion, { min: 1 });
          const note = optionalString('note', body.note);
          const changes = changesOf(body);
          const previous = await laci.getEntry(key, selector);
          const entry = await laci.update(key, changes, {
            ...selector,
            expectedVersion,
            ...(note ? { note } : {}),
            ...by,
          });
          return json(200, await withWarnings(entry, previous));
        }
      }
      if (segments.length === 3 && sub === 'history' && method === 'GET') {
        const limit = params.get('limit');
        const offset = params.get('offset');
        return json(
          200,
          await laci.history(key, {
            ...selector,
            ...(limit === null ? {} : { limit: integer('limit', limit, { min: 1 }) }),
            ...(offset === null ? {} : { offset: integer('offset', offset) }),
          }),
        );
      }
      if (segments.length === 3 && sub === 'rollback' && method === 'POST') {
        const body = await readJson(request);
        const version = integer('version', body.version, { min: 1 });
        const expectedVersion = integer('expectedVersion', body.expectedVersion, { min: 1 });
        const note = optionalString('note', body.note);
        const previous = await laci.getEntry(key, selector);
        const entry = await laci.rollback(key, version, {
          ...selector,
          expectedVersion,
          ...(note ? { note } : {}),
          ...by,
        });
        return json(200, await withWarnings(entry, previous));
      }
      if (segments.length === 3 && sub === 'promote' && method === 'POST') {
        return json(200, await promote(key, await readJson(request), by));
      }
      if (segments.length === 3 && sub === 'sync-provider-status' && method === 'POST') {
        return json(200, await withWarnings(await syncProviderStatus(key, selector, by)));
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  /**
   * The template a preview or test renders: the unsaved `value` and `schema` when given (checked
   * first), otherwise the stored template `key` in any status.
   */
  async function templateSource(
    body: Record<string, unknown>,
    kind: 'EMAIL_TEMPLATE' | 'MESSAGE_TEMPLATE',
    channel: MessageChannel | null,
  ): Promise<TemplateSource> {
    const key = optionalString('key', body.key) ?? null;
    const name =
      key !== null ? `"${key}"` : kind === 'EMAIL_TEMPLATE' ? 'email template' : 'message template';
    const timeZone = optionalString('timeZone', body.timeZone) ?? laci.timeZone;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new HttpError(400, `"timeZone" must be an IANA time zone such as "Asia/Jakarta".`);
    }
    const data = body.data ?? {};
    if (body.value !== undefined) {
      if (!isObject(body.schema))
        throw new HttpError(400, '"schema" must be a JSON Schema object.');
      const schema = body.schema as JsonSchema;
      const schemaIssues = checkVariableSchema(schema);
      if (schemaIssues.length > 0) throw new LaciValidationError(name, 'schema', schemaIssues);
      const issues =
        channel === null
          ? checkEmailTemplate(body.value, schema)
          : checkMessageTemplate(channel, body.value, schema);
      if (issues.length > 0) throw new LaciValidationError(name, 'value', issues);
      const locale = optionalString('locale', body.locale) ?? laci.defaultLocale;
      return { name, value: body.value, schema, locale, timeZone, data };
    }
    if (key === null) throw new HttpError(400, 'Pass "key" or "value" and "schema".');
    const selector = { ...selectorOf((field) => body[field]), kind };
    const entry = await laci.getEntry(key, selector);
    if (!entry) throw new EntryNotFoundError({ key, ...selector });
    const { value, schema } = entry;
    return { name, value, schema, locale: entry.locale as string, timeZone, data };
  }

  async function renderEmail(body: Record<string, unknown>): Promise<RenderedEmail> {
    const source = await templateSource(body, 'EMAIL_TEMPLATE', null);
    return renderEmailTemplate({ ...source, value: source.value as EmailTemplateValue });
  }

  /** The `channel` of a message request; it is required. */
  function channelOf(body: Record<string, unknown>): MessageChannel {
    const channel = oneOf<MessageChannel>('channel', body.channel, MESSAGE_CHANNELS);
    if (channel === undefined) throw new HttpError(400, '"channel" is required.');
    return channel;
  }

  async function renderMessage(body: Record<string, unknown>): Promise<RenderedMessage> {
    const channel = channelOf(body);
    const source = await templateSource(body, 'MESSAGE_TEMPLATE', channel);
    return renderMessageTemplate({
      ...source,
      channel,
      value: source.value as MessageTemplateValue,
    });
  }

  async function sendTest(
    body: Record<string, unknown>,
  ): Promise<{ sent: true; rendered: RenderedEmail | RenderedMessage }> {
    if (!options.sendTest) {
      throw new HttpError(404, 'Sending tests is not set up: pass `sendTest` to the studio.');
    }
    const kind = oneOf<EntryKind>('kind', body.kind, ENTRY_KINDS) ?? 'EMAIL_TEMPLATE';
    if (kind === 'CONFIG') throw new HttpError(400, 'Only templates can be sent as a test.');
    const to = optionalString('to', body.to);
    if (to === undefined) throw new HttpError(400, '"to" is required.');
    const key = optionalString('key', body.key) ?? null;
    const message: SendTestMessage =
      kind === 'EMAIL_TEMPLATE'
        ? { kind, channel: null, key, rendered: await renderEmail(body), to }
        : { kind, channel: channelOf(body), key, rendered: await renderMessage(body), to };
    try {
      await options.sendTest(message);
    } catch (error) {
      throw new HttpError(
        502,
        `Sending the test failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { sent: true, rendered: message.rendered };
  }

  async function promote(
    key: string,
    body: Record<string, unknown>,
    by: { by?: string },
  ): Promise<StudioPromoteResult> {
    const from = optionalString('from', body.from);
    const to = optionalString('to', body.to);
    if (from === undefined || to === undefined) {
      throw new HttpError(400, '"from" and "to" are required.');
    }
    if (from === to) throw new HttpError(400, '"from" and "to" must be different environments.');
    const version = (name: string) =>
      body[name] === undefined || body[name] === null
        ? {}
        : { [name]: integer(name, body[name], { min: 1 }) };
    const versions = { ...version('expectedVersion'), ...version('sourceVersion') };
    const all = body.all === true;
    if (all && Object.keys(versions).length > 0) {
      throw new HttpError(400, '"expectedVersion" and "sourceVersion" cannot be used with "all".');
    }
    const { kind, locale, channel } = selectorOf((name) => body[name]);
    const note = optionalString('note', body.note);
    const result = await laci.promote(key, {
      from,
      to,
      ...(kind ? { kind } : {}),
      ...(locale ? { locale } : {}),
      ...(channel ? { channel } : {}),
      all,
      dryRun: body.dryRun === true,
      ...versions,
      ...(note ? { note } : {}),
      ...by,
    });
    const changes = [];
    for (const change of result.changes) {
      changes.push({ ...change, entry: await withWarnings(change.entry, change.previous) });
    }
    return { changes };
  }

  async function syncProviderStatus(
    key: string,
    selector: EntrySelector,
    by: { by?: string },
  ): Promise<Entry> {
    if (!laci.canSyncProviderStatus) {
      throw new HttpError(
        404,
        'Syncing provider statuses is not set up: pass `syncProviderStatus` to createLaci().',
      );
    }
    try {
      return await laci.syncProviderStatus(key, {
        ...(selector.environment ? { environment: selector.environment } : {}),
        ...(selector.locale ? { locale: selector.locale } : {}),
        ...by,
      });
    } catch (error) {
      // Laci's own errors keep their status; anything else comes from the provider call.
      if (error instanceof LaciError && !(error instanceof UnexpectedValueError)) throw error;
      throw new HttpError(
        502,
        `Syncing the provider status failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function asset(path: string): Promise<Response> {
    const file = normalize(join(uiDir, path));
    if (!file.startsWith(uiDir.endsWith(sep) ? uiDir : uiDir + sep))
      throw new HttpError(404, 'Not found.');
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    const isPage = path === '/index.html';
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': path.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        ...(isPage ? SECURITY_HEADERS : { 'x-content-type-options': 'nosniff' }),
      },
    });
  }

  return async (request, { path, user }) => {
    try {
      if (path.startsWith('/api/')) return await api(request, path.slice('/api'.length), user);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed.');
      }
      const url = new URL(request.url);
      // The UI uses relative URLs, so its page must end with "/".
      if (path === '/' && !url.pathname.endsWith('/')) {
        return new Response(null, {
          status: 308,
          headers: { location: `${url.pathname}/${url.search}` },
        });
      }
      return await asset(path === '/' ? '/index.html' : path);
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message });
      if (error instanceof LaciValidationError) {
        return json(422, {
          error: error.message,
          code: error.code,
          target: error.target,
          issues: error.issues,
        });
      }
      if (error instanceof TemplateRenderError) {
        return json(422, { error: error.message, code: error.code, field: error.field });
      }
      if (error instanceof EntryNotFoundError) {
        return json(404, { error: error.message, code: error.code });
      }
      if (error instanceof VersionConflictError) {
        return json(409, {
          error: error.message,
          code: error.code,
          expectedVersion: error.expectedVersion,
          actualVersion: error.actualVersion ?? null,
        });
      }
      if (error instanceof EntryExistsError) {
        return json(409, { error: error.message, code: error.code });
      }
      if (error instanceof UnknownEnvironmentError) {
        return json(400, { error: error.message, code: error.code });
      }
      console.error('Laci Studio: request failed.', error);
      return json(500, { error: 'Internal error; see the server log.' });
    }
  };
}
