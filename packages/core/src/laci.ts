import { TtlCache } from './cache';
import type { InvalidateFilter } from './cache';
import { parseInstant } from './date';
import { renderEmailTemplate } from './email';
import type { EmailTemplateValue, RenderedEmail } from './email';
import {
  describeAddress,
  EntryExistsError,
  EntryNotFoundError,
  LaciValidationError,
  UnexpectedValueError,
  UnknownEnvironmentError,
  VersionConflictError,
} from './errors';
import { getAtPath, parsePath } from './path';
import type { EntryQuery, LaciStore, PageQuery, Paginated } from './store/types';
import type {
  Entry,
  EntryAddress,
  EntryHistory,
  EntryKind,
  EntryStatus,
  JsonPrimitive,
  JsonSchema,
  JsonValue,
  MessageChannel,
} from './types';
import { uuidv7 } from './uuid';
import type { IdGenerator } from './uuid';
import { checkAddress, validateContent } from './validation/entry';
import { DEFAULT_LIMITS } from './validation/limits';
import type { ValueLimits } from './validation/limits';

export type { InvalidateFilter } from './cache';

/** Options of the in-memory read cache. */
export interface CacheOptions {
  /** How long a read stays cached, in milliseconds. Default 30 000. `0` turns caching off. */
  ttlMs?: number;
}

/** Options of {@link createLaci}. */
export interface LaciOptions {
  /** Where entries and their history are stored. */
  store: LaciStore;
  /**
   * The **data** environment this instance reads by default, e.g. `"production"` or
   * `"staging"`: which version of each value the app sees. It is unrelated to `NODE_ENV`.
   * Default `"production"`.
   */
  environment?: string;
  /** Every data environment entries may be stored for. Default production, staging, development. */
  environments?: readonly string[];
  /** Locale of templates when none is given, and the last locale fallback. Default `"en-US"`. */
  defaultLocale?: string;
  /**
   * IANA time zone of dates formatted in templates (`formatDate`), e.g. `"Asia/Jakarta"`. Default
   * `"UTC"`, so output never depends on the server's time zone.
   */
  timeZone?: string;
  /** In-memory read cache. `false` turns it off. Default `{ ttlMs: 30_000 }`. */
  cache?: CacheOptions | false;
  /** Size and nesting limits of stored values. */
  limits?: ValueLimits;
  /**
   * Called after every change made through this instance, e.g. to tell other server instances
   * to drop their cache (see {@link Laci.invalidate}).
   */
  onChange?: (event: ChangeEvent) => void | Promise<void>;
  /** Called when `onChange` throws. Default: `console.error`. */
  onChangeError?: (error: unknown, event: ChangeEvent) => void;
  /** ID generator for entries and history rows. Default UUID v7. */
  generateId?: IdGenerator;
  /** Clock. Default `() => new Date()`. */
  now?: () => Date;
}

/** A change made through a Laci instance. */
export interface ChangeEvent {
  type: 'define' | 'update' | 'rollback';
  /** The entry after the change. */
  entry: Entry;
  /** The version before the change; `null` for a new entry. */
  previousVersion: number | null;
}

/** Which entry to use, when it is not the default of the instance. */
export interface EntrySelector {
  /** Data environment. Default: the instance's `environment`. */
  environment?: string;
  /** Templates only. Default: the instance's `defaultLocale`. */
  locale?: string;
  /** Message templates only. */
  channel?: MessageChannel;
  /** Default `"CONFIG"`. */
  kind?: EntryKind;
}

/** Input of {@link Laci.define}. */
export interface DefineInput extends EntrySelector {
  schema: JsonSchema;
  value: JsonValue;
  description?: string;
  /** Default `"PUBLISHED"`. */
  status?: EntryStatus;
  /** Who created it, stored as `createdBy`. */
  by?: string;
  /** History note of the first version. */
  note?: string;
}

/** Options of methods that change an entry. */
export interface WriteOptions extends EntrySelector {
  /** Who made the change, stored as `updatedBy` and in the history. */
  by?: string;
  /** Why, stored in the history. */
  note?: string;
  /**
   * The version the change is based on, usually the one shown to the user. When the entry has
   * moved on, the change is refused with a {@link VersionConflictError}.
   */
  expectedVersion?: number;
}

/** What {@link Laci.update} may change. Omitted fields keep their value. */
export interface EntryChanges {
  value?: JsonValue;
  schema?: JsonSchema;
  status?: EntryStatus;
  /** `null` removes the description. */
  description?: string | null;
}

/** Options of {@link Laci.get}. */
export interface GetOptions<T> {
  /** Data environment. Default: the instance's `environment`. */
  environment?: string;
  /** Returned when the entry does not exist, is not published, or has nothing at the path. */
  default?: T;
}

/** Options of {@link Laci.find}. */
export interface FindOptions {
  environment?: string;
  /** Where the list is inside the value, e.g. `"customers"`. Default: the value itself. */
  path?: string;
}

/** Options of {@link Laci.isLive}. */
export interface IsLiveOptions {
  environment?: string;
  /** Where the date is inside the value, e.g. `"liveAt"`. Default: the value itself. */
  path?: string;
  /** The moment to compare with. Default: now. */
  now?: Date;
  /** Returned when the entry does not exist or is not published. */
  default?: boolean;
}

/** Query of {@link Laci.listEntries}. */
export type ListEntriesQuery = EntryQuery;

/** Options of {@link Laci.renderEmail}. */
export interface RenderOptions {
  /** Data environment. Default: the instance's `environment`. */
  environment?: string;
  /** Default: the instance's `defaultLocale`. */
  locale?: string;
  /** Time zone of `formatDate`. Default: the instance's `timeZone`. */
  timeZone?: string;
}

/** Options of {@link Laci.history}. */
export interface HistoryOptions extends EntrySelector, PageQuery {}

/** A Laci instance, created by {@link createLaci}. */
export interface Laci {
  /** The data environment read by default. */
  readonly environment: string;
  readonly environments: readonly string[];
  readonly defaultLocale: string;
  readonly timeZone: string;

  /**
   * Creates an entry when it does not exist yet, and returns the stored entry. An existing
   * entry is never overwritten (use {@link set}), so `define` is safe to call at every start-up
   * to seed values. The input is validated either way.
   */
  define(key: string, input: DefineInput): Promise<Entry>;

  /** The published value of a config, or the part of it at `path` (e.g. `[0].sessions`). */
  get<T = JsonValue>(key: string, options?: GetOptions<T>): Promise<T>;
  get<T = JsonValue>(key: string, path: string, options?: GetOptions<T>): Promise<T>;

  /**
   * The first item of a list config whose fields equal all of `match`, e.g.
   * `find('customerCategoryColor', { category: 'VIP' })`; `undefined` when none does.
   */
  find<T = JsonValue>(
    key: string,
    match: Record<string, JsonPrimitive>,
    options?: FindOptions,
  ): Promise<T | undefined>;

  /**
   * Whether the date stored in a config has passed: `now >= date`. The date must be ISO 8601
   * with an offset (`2026-11-01T00:00:00+07:00`), so the result does not depend on the
   * server's time zone. A `null` date means "not live".
   */
  isLive(key: string, options?: IsLiveOptions): Promise<boolean>;

  /** Replaces the value of an entry, validated against its schema. */
  set(key: string, value: JsonValue, options?: WriteOptions): Promise<Entry>;

  /** Changes the value, schema, status, or description of an entry as one new version. */
  update(key: string, changes: EntryChanges, options?: WriteOptions): Promise<Entry>;

  /** Restores the value and schema of an earlier version, as a new version. */
  rollback(key: string, version: number, options?: WriteOptions): Promise<Entry>;

  /** Versions of an entry, newest first. */
  history(key: string, options?: HistoryOptions): Promise<Paginated<EntryHistory>>;

  /** An entry in any status (drafts too), without the cache. `null` when it does not exist. */
  getEntry(key: string, selector?: EntrySelector): Promise<Entry | null>;

  /** Entries in any status, for editors and tools. */
  listEntries(query?: ListEntriesQuery): Promise<Paginated<Entry>>;

  /**
   * Drops cached reads matching `filter` (all of them without one). Changes made through this
   * instance do this automatically; call it when another server instance reports a change.
   */
  invalidate(filter?: InvalidateFilter): void;

  /**
   * Renders the published email template `key` with `data`, which must match the template's
   * variable schema. Only renders: sending the email is up to your app.
   */
  renderEmail(key: string, data?: object, options?: RenderOptions): Promise<RenderedEmail>;
}

const DEFAULT_ENVIRONMENTS = ['production', 'staging', 'development'] as const;
const DEFAULT_TTL_MS = 30_000;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Creates a Laci instance over `options.store`. */
export function createLaci(options: LaciOptions): Laci {
  const { store } = options;
  const environments = [...(options.environments ?? DEFAULT_ENVIRONMENTS)];
  const environment = options.environment ?? 'production';
  const defaultLocale = options.defaultLocale ?? 'en-US';
  const timeZone = options.timeZone ?? 'UTC';
  // Throws a RangeError for unknown time zones.
  new Intl.DateTimeFormat('en-US', { timeZone });
  const limits: Required<ValueLimits> = { ...DEFAULT_LIMITS, ...options.limits };
  const generateId = options.generateId ?? uuidv7;
  const now = options.now ?? (() => new Date());
  const ttlMs = options.cache === false ? 0 : (options.cache?.ttlMs ?? DEFAULT_TTL_MS);
  const cache = ttlMs > 0 ? new TtlCache<Entry | null>(ttlMs, () => now().getTime()) : null;
  const onChangeError =
    options.onChangeError ??
    ((error: unknown) => {
      console.error('Laci: onChange failed', error);
    });

  if (environments.length === 0) throw new TypeError('Laci: `environments` must not be empty.');
  if (!environments.includes(environment)) {
    throw new UnknownEnvironmentError(environment, environments);
  }

  function checkEnvironment(name: string): string {
    if (!environments.includes(name)) throw new UnknownEnvironmentError(name, environments);
    return name;
  }

  /** The address of an entry, validated. */
  function resolve(
    key: string,
    selector: EntrySelector = {},
  ): { kind: EntryKind; address: EntryAddress } {
    const kind = selector.kind ?? 'CONFIG';
    const address: EntryAddress = {
      key,
      environment: checkEnvironment(selector.environment ?? environment),
      locale: kind === 'CONFIG' ? (selector.locale ?? null) : (selector.locale ?? defaultLocale),
      channel: selector.channel ?? null,
    };
    const issues = checkAddress({ key, kind, locale: address.locale, channel: address.channel });
    if (issues.length > 0) throw new LaciValidationError(describeAddress(address), 'entry', issues);
    return { kind, address };
  }

  /** The stored entry of the given kind, in any status. */
  async function load(kind: EntryKind, address: EntryAddress): Promise<Entry | null> {
    const entry = await store.getEntry(address);
    return entry?.kind === kind ? entry : null;
  }

  /** The published entry, through the cache. */
  async function readPublished(kind: EntryKind, address: EntryAddress): Promise<Entry | null> {
    const cached = cache?.get(kind, address);
    if (cached) return cached.value;
    const entry = await load(kind, address);
    const published = entry?.status === 'PUBLISHED' ? entry : null;
    cache?.set(kind, address, published);
    return published;
  }

  async function emit(event: ChangeEvent): Promise<void> {
    if (!options.onChange) return;
    try {
      await options.onChange(event);
    } catch (error) {
      onChangeError(error, event);
    }
  }

  function history(entry: Entry, by: string | null, note: string | undefined): EntryHistory {
    return {
      id: generateId(),
      entryId: entry.id,
      version: entry.version,
      value: entry.value,
      schema: entry.schema,
      status: entry.status,
      changedBy: by,
      changedAt: entry.updatedAt,
      note: note ?? null,
    };
  }

  /** Writes a new version of `current`; validates, checks the version, and drops the cache. */
  async function writeVersion(
    current: Entry,
    changes: EntryChanges,
    writeOptions: WriteOptions,
    type: ChangeEvent['type'],
    defaultNote?: string,
  ): Promise<Entry> {
    if (
      writeOptions.expectedVersion !== undefined &&
      writeOptions.expectedVersion !== current.version
    ) {
      cache?.invalidate(current);
      throw new VersionConflictError(current, writeOptions.expectedVersion, current.version);
    }
    const schema = changes.schema ?? current.schema;
    const value = changes.value ?? current.value;
    const status = changes.status ?? current.status;
    const description =
      changes.description === undefined ? current.description : changes.description;
    const issues = checkAddress({ ...current, status });
    if (issues.length > 0) throw new LaciValidationError(describeAddress(current), 'entry', issues);
    validateContent(describeAddress(current), current.kind, schema, value, limits);

    if (
      sameJson(schema, current.schema) &&
      sameJson(value, current.value) &&
      status === current.status &&
      description === current.description
    ) {
      return current;
    }

    const by = writeOptions.by ?? null;
    const entry: Entry = {
      ...current,
      schema,
      value,
      status,
      description,
      version: current.version + 1,
      updatedBy: by,
      updatedAt: now(),
    };
    try {
      await store.write([
        {
          type: 'update',
          entry,
          expectedVersion: current.version,
          history: history(entry, by, writeOptions.note ?? defaultNote),
        },
      ]);
    } finally {
      // Also after a conflict: the cached copy is outdated then too.
      cache?.invalidate(current);
    }
    await emit({ type, entry, previousVersion: current.version });
    return entry;
  }

  async function mustLoad(key: string, selector: EntrySelector = {}): Promise<Entry> {
    const { kind, address } = resolve(key, selector);
    const entry = await load(kind, address);
    if (!entry) throw new EntryNotFoundError(address);
    return entry;
  }

  async function publishedValue(
    key: string,
    selectedEnvironment: string | undefined,
  ): Promise<{ entry: Entry | null; address: EntryAddress }> {
    const { address } = resolve(key, { environment: selectedEnvironment });
    return { entry: await readPublished('CONFIG', address), address };
  }

  async function valueAt(key: string, path: string | undefined, selectedEnvironment?: string) {
    const segments = path === undefined ? [] : parsePath(path);
    const { entry, address } = await publishedValue(key, selectedEnvironment);
    return {
      entry,
      address,
      value: entry ? getAtPath(entry.value, segments) : undefined,
    };
  }

  const laci: Laci = {
    environment,
    environments,
    defaultLocale,
    timeZone,

    async define(key, input) {
      const { kind, address } = resolve(key, input);
      const status = input.status ?? 'PUBLISHED';
      const subject = describeAddress(address);
      const issues = checkAddress({
        key,
        kind,
        locale: address.locale,
        channel: address.channel,
        status,
      });
      if (issues.length > 0) throw new LaciValidationError(subject, 'entry', issues);
      validateContent(subject, kind, input.schema, input.value, limits);

      const existing = await store.getEntry(address);
      if (existing) {
        if (existing.kind !== kind) throw new EntryExistsError(address);
        return existing;
      }
      const at = now();
      const by = input.by ?? null;
      const entry: Entry = {
        id: generateId(),
        ...address,
        kind,
        description: input.description ?? null,
        schema: input.schema,
        value: input.value,
        status,
        version: 1,
        createdBy: by,
        updatedBy: by,
        createdAt: at,
        updatedAt: at,
      };
      try {
        await store.write([{ type: 'insert', entry, history: history(entry, by, input.note) }]);
      } catch (error) {
        // Defined at the same time by another instance: return theirs.
        if (error instanceof EntryExistsError) {
          const stored = await load(kind, address);
          if (stored) return stored;
        }
        throw error;
      }
      cache?.invalidate(address);
      await emit({ type: 'define', entry, previousVersion: null });
      return entry;
    },

    async get<T = JsonValue>(
      key: string,
      pathOrOptions?: string | GetOptions<T>,
      maybeOptions?: GetOptions<T>,
    ): Promise<T> {
      const path = typeof pathOrOptions === 'string' ? pathOrOptions : undefined;
      const getOptions = (typeof pathOrOptions === 'string' ? maybeOptions : pathOrOptions) ?? {};
      const { entry, address, value } = await valueAt(key, path, getOptions.environment);
      const hasDefault = 'default' in getOptions;
      if (!entry && !hasDefault) throw new EntryNotFoundError(address);
      if (value === undefined) return getOptions.default as T;
      return structuredClone(value) as T;
    },

    async find<T = JsonValue>(
      key: string,
      match: Record<string, JsonPrimitive>,
      findOptions: FindOptions = {},
    ): Promise<T | undefined> {
      const { entry, address, value } = await valueAt(
        key,
        findOptions.path,
        findOptions.environment,
      );
      if (!entry) throw new EntryNotFoundError(address);
      if (!Array.isArray(value)) {
        throw new UnexpectedValueError(
          `find() needs a list, but ${describeAddress(address)}${findOptions.path ? ` at "${findOptions.path}"` : ''} is ${value === undefined ? 'missing' : typeof value}.`,
        );
      }
      const fields = Object.entries(match);
      const item = value.find(
        (candidate) =>
          typeof candidate === 'object' &&
          candidate !== null &&
          !Array.isArray(candidate) &&
          fields.every(([field, expected]) => candidate[field] === expected),
      );
      return item === undefined ? undefined : (structuredClone(item) as T);
    },

    async isLive(key, liveOptions = {}) {
      const { entry, address, value } = await valueAt(
        key,
        liveOptions.path,
        liveOptions.environment,
      );
      if (!entry) {
        if (liveOptions.default !== undefined) return liveOptions.default;
        throw new EntryNotFoundError(address);
      }
      if (value === null) return false;
      const instant = typeof value === 'string' ? parseInstant(value) : null;
      if (instant === null) {
        throw new UnexpectedValueError(
          `isLive() needs an ISO 8601 date and time with an offset (e.g. "2026-11-01T00:00:00+07:00"), but ${describeAddress(address)}${liveOptions.path ? ` at "${liveOptions.path}"` : ''} is ${value === undefined ? 'missing' : JSON.stringify(value)}.`,
        );
      }
      return (liveOptions.now ?? now()).getTime() >= instant;
    },

    async set(key, value, writeOptions = {}) {
      return writeVersion(await mustLoad(key, writeOptions), { value }, writeOptions, 'update');
    },

    async update(key, changes, writeOptions = {}) {
      return writeVersion(await mustLoad(key, writeOptions), changes, writeOptions, 'update');
    },

    async rollback(key, version, writeOptions = {}) {
      const current = await mustLoad(key, writeOptions);
      const target = await store.getHistory(current.id, version);
      if (!target) throw new EntryNotFoundError(current, version);
      return writeVersion(
        current,
        { value: target.value, schema: target.schema },
        writeOptions,
        'rollback',
        `Rolled back to version ${version}`,
      );
    },

    async history(key, historyOptions = {}) {
      const entry = await mustLoad(key, historyOptions);
      return store.listHistory(entry.id, {
        ...(historyOptions.limit === undefined ? {} : { limit: historyOptions.limit }),
        ...(historyOptions.offset === undefined ? {} : { offset: historyOptions.offset }),
      });
    },

    async getEntry(key, selector = {}) {
      const { kind, address } = resolve(key, selector);
      return load(kind, address);
    },

    async listEntries(query = {}) {
      if (query.environment !== undefined) checkEnvironment(query.environment);
      return store.listEntries(query);
    },

    invalidate(filter) {
      cache?.invalidate(filter);
    },

    async renderEmail(key, data, renderOptions = {}) {
      const { address } = resolve(key, {
        kind: 'EMAIL_TEMPLATE',
        ...(renderOptions.environment === undefined
          ? {}
          : { environment: renderOptions.environment }),
        ...(renderOptions.locale === undefined ? {} : { locale: renderOptions.locale }),
      });
      const entry = await readPublished('EMAIL_TEMPLATE', address);
      if (!entry) throw new EntryNotFoundError(address);
      return renderEmailTemplate({
        value: entry.value as unknown as EmailTemplateValue,
        schema: entry.schema,
        data,
        locale: entry.locale as string,
        timeZone: renderOptions.timeZone ?? timeZone,
        name: describeAddress(address),
      });
    },
  };
  return laci;
}
