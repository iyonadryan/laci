import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENTRY_KINDS,
  ENTRY_STATUSES,
  EntryExistsError,
  EntryNotFoundError,
  LaciValidationError,
  MESSAGE_CHANNELS,
  UnknownEnvironmentError,
  VersionConflictError,
} from '@lacijs/core';
import type {
  EntryChanges,
  EntryKind,
  EntryQuery,
  EntrySelector,
  EntryStatus,
  JsonSchema,
  JsonValue,
  Laci,
  MessageChannel,
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
}

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
  const search = get('search');
  if (search) query.search = search;
  const limit = get('limit');
  if (limit !== undefined) query.limit = integer('limit', limit, { min: 1 });
  const offset = get('offset');
  if (offset !== undefined) query.offset = integer('offset', offset);
  return query;
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
 * - `GET api/entries`: list, filtered by `kind`, `environment`, `locale`, `channel`, `status`
 *   (comma-separated), `search`, `limit`, `offset`
 * - `POST api/entries`: create (409 when it exists)
 * - `GET api/entries/:key`: one entry, in any status
 * - `PUT api/entries/:key`: change value, schema, status, or description (`expectedVersion`
 *   required)
 * - `GET api/entries/:key/history`: versions, newest first
 * - `POST api/entries/:key/rollback`: restore a version (`version`, `expectedVersion`)
 */
export function createStudioHandler(options: StudioOptions & { uiDir?: string }): StudioHandler {
  if (!isStudioEnabled(options)) {
    console.warn(DISABLED_MESSAGE);
    return () => Promise.resolve(new Response('Not found.', { status: 404 }));
  }
  const { laci } = options;
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
      });
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
        return json(201, entry);
      }
    }

    if (key !== undefined) {
      const selector = selectorOf((name) => params.get(name) ?? undefined);
      if (segments.length === 2) {
        if (method === 'GET') {
          const entry = await laci.getEntry(key, selector);
          if (!entry) throw new EntryNotFoundError({ key, ...selector });
          return json(200, entry);
        }
        if (method === 'PUT') {
          const body = await readJson(request);
          const expectedVersion = integer('expectedVersion', body.expectedVersion, { min: 1 });
          const note = optionalString('note', body.note);
          const entry = await laci.update(key, changesOf(body), {
            ...selector,
            expectedVersion,
            ...(note ? { note } : {}),
            ...by,
          });
          return json(200, entry);
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
        const entry = await laci.rollback(key, version, {
          ...selector,
          expectedVersion,
          ...(note ? { note } : {}),
          ...by,
        });
        return json(200, entry);
      }
    }
    throw new HttpError(404, 'Not found.');
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
