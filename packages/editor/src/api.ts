import type {
  EntryKind,
  EntryStatus,
  JsonSchema,
  JsonValue,
  MessageChannel,
  MessageWarning,
  RenderedEmail,
  RenderedMessage,
  ValidationIssue,
  ValidationTarget,
} from '@lacijs/core';

/** The header the studio API wants on every change; browsers never add it cross-site. */
export const CSRF_HEADER = 'x-laci-studio';

/** An entry as the API returns it: dates as ISO strings, with its warnings. */
export interface ApiEntry {
  id: string;
  key: string;
  kind: EntryKind;
  environment: string;
  locale: string | null;
  channel: MessageChannel | null;
  description: string | null;
  schema: JsonSchema;
  value: JsonValue;
  status: EntryStatus;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only on single entries. */
  warnings?: MessageWarning[];
}

/** One version of an entry. */
export interface ApiHistory {
  id: string;
  entryId: string;
  version: number;
  value: JsonValue;
  schema: JsonSchema;
  status: EntryStatus;
  changedBy: string | null;
  changedAt: string;
  note: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** `GET api/session`. */
export interface Session {
  label: string | null;
  user: { id: string; name?: string } | null;
  /** `NODE_ENV` of the server: where it runs, not which data it edits. */
  runtime: string;
  environment: string;
  environments: string[];
  defaultLocale: string;
  kinds: EntryKind[];
  statuses: EntryStatus[];
  channels: MessageChannel[];
  timeZone: string;
  sendTest: boolean;
  providerSync: boolean;
  limits: { maxValueBytes: number; maxDepth: number };
}

/** `POST api/validate`. */
export interface Validation {
  valid: boolean;
  target: ValidationTarget | null;
  issues: ValidationIssue[];
  warnings: MessageWarning[];
  bytes: number;
}

/** Which entry: as in the API's query parameters. */
export interface Selector {
  kind: EntryKind;
  environment: string;
  locale?: string | null;
  channel?: MessageChannel | null;
}

export interface ListQuery {
  kind?: EntryKind;
  key?: string;
  environment?: string;
  channel?: MessageChannel;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PromoteRequest {
  from: string;
  to: string;
  kind: EntryKind;
  locale?: string | null;
  channel?: MessageChannel | null;
  all?: boolean;
  dryRun?: boolean;
  expectedVersion?: number;
  sourceVersion?: number;
  note?: string;
}

export interface PromoteChange {
  action: 'create' | 'update' | 'unchanged';
  source: ApiEntry;
  previous: ApiEntry | null;
  entry: ApiEntry;
}

/** A template to render: a stored one (`key`) or an unsaved `value` and `schema`. */
export interface PreviewRequest {
  value: JsonValue;
  schema: JsonSchema;
  data: JsonValue;
  locale?: string;
  channel?: MessageChannel;
}

/** A failed API call, with the API's details when it sent them. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: {
      code?: string;
      target?: ValidationTarget;
      issues?: ValidationIssue[];
      field?: string;
      actualVersion?: number | null;
    } = {},
  ) {
    super(message);
  }
}

/** How the editor reaches the studio API. */
export interface ApiOptions {
  /** Base URL of the API, ending in `/`. Default `"api/"`: relative to the page. */
  apiUrl?: string;
  /** Extra headers, e.g. your app's auth; a function is called for every request. */
  headers?:
    Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
}

const query = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(name, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
};

const selectorQuery = (selector: Selector) =>
  query({
    kind: selector.kind,
    environment: selector.environment,
    locale: selector.locale,
    channel: selector.channel,
  });

const entryPath = (key: string) => `entries/${encodeURIComponent(key)}`;

/** A client of the studio API. */
export function createApi(options: ApiOptions = {}) {
  const apiUrl = options.apiUrl ?? 'api/';
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const extra =
      typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
    const response = await doFetch(`${apiUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...extra,
        [CSRF_HEADER]: '1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json().catch(() => null)) as
      (T & { error?: string } & ApiError['details']) | null;
    if (!response.ok) {
      throw new ApiError(
        response.status,
        data?.error ?? (response.statusText || `HTTP ${response.status}`),
        {
          ...(data?.code ? { code: data.code } : {}),
          ...(data?.target ? { target: data.target } : {}),
          ...(data?.issues ? { issues: data.issues } : {}),
          ...(data?.field ? { field: data.field } : {}),
          ...(data?.actualVersion !== undefined ? { actualVersion: data.actualVersion } : {}),
        },
      );
    }
    return data as T;
  }

  return {
    session: () => call<Session>('GET', 'session'),
    list: (params: ListQuery) => call<Page<ApiEntry>>('GET', `entries${query({ ...params })}`),
    entry: (key: string, selector: Selector) =>
      call<ApiEntry>('GET', `${entryPath(key)}${selectorQuery(selector)}`),
    create: (input: {
      key: string;
      kind: EntryKind;
      environment: string;
      locale?: string | null;
      channel?: MessageChannel | null;
      description?: string;
      schema: JsonSchema;
      value: JsonValue;
      status?: EntryStatus;
      note?: string;
    }) => call<ApiEntry>('POST', 'entries', input),
    update: (
      key: string,
      selector: Selector,
      changes: {
        value?: JsonValue;
        schema?: JsonSchema;
        status?: EntryStatus;
        description?: string | null;
        expectedVersion: number;
        note?: string;
      },
    ) => call<ApiEntry>('PUT', `${entryPath(key)}${selectorQuery(selector)}`, changes),
    history: (key: string, selector: Selector, page: { limit?: number; offset?: number } = {}) =>
      call<Page<ApiHistory>>(
        'GET',
        `${entryPath(key)}/history${query({
          kind: selector.kind,
          environment: selector.environment,
          locale: selector.locale,
          channel: selector.channel,
          ...page,
        })}`,
      ),
    rollback: (
      key: string,
      selector: Selector,
      body: { version: number; expectedVersion: number; note?: string },
    ) => call<ApiEntry>('POST', `${entryPath(key)}/rollback${selectorQuery(selector)}`, body),
    promote: (key: string, body: PromoteRequest) =>
      call<{ changes: PromoteChange[] }>('POST', `${entryPath(key)}/promote`, body),
    syncProviderStatus: (key: string, selector: Selector) =>
      call<ApiEntry>(
        'POST',
        `${entryPath(key)}/sync-provider-status${selectorQuery(selector)}`,
        {},
      ),
    validate: (body: {
      kind: EntryKind;
      channel?: MessageChannel | null;
      schema: JsonSchema;
      value: JsonValue;
      previous?: JsonValue;
    }) => call<Validation>('POST', 'validate', body),
    previewEmail: (body: PreviewRequest) => call<RenderedEmail>('POST', 'preview/email', body),
    previewMessage: (body: PreviewRequest & { channel: MessageChannel }) =>
      call<RenderedMessage>('POST', 'preview/message', body),
    sendTest: (body: PreviewRequest & { kind: EntryKind; to: string }) =>
      call<{ sent: true }>('POST', 'send-test', body),
  };
}

/** What {@link createApi} returns. */
export type LaciApi = ReturnType<typeof createApi>;
