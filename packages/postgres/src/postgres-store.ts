import { EntryExistsError, VersionConflictError } from '@lacijs/core';
import type {
  Entry,
  EntryAddress,
  EntryHistory,
  EntryQuery,
  EntryWrite,
  LaciStore,
  PageQuery,
  Paginated,
} from '@lacijs/core';
import type { Pool, PoolClient } from 'pg';
import { errorField } from './driver-errors';
import { assertTablePrefix, migrations, migrationsTable } from './schema';

/** Options of {@link PostgresStore}. */
export interface PostgresStoreOptions {
  /** Prefix of every table and index name. Default `"laci_"`. */
  tablePrefix?: string;
}

const DEFAULT_LIMIT = 50;

/** `limit` and `offset` are interpolated into SQL, so they must be non-negative integers. */
function pageNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `Laci: limit and offset must be non-negative integers, got ${String(value)}.`,
    );
  }
  return value;
}

interface EntryRow {
  id: string;
  key: string;
  kind: Entry['kind'];
  environment: string;
  locale: string;
  channel: string;
  description: string | null;
  schema: Entry['schema'];
  value: Entry['value'];
  status: Entry['status'];
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface HistoryRow {
  id: string;
  entry_id: string;
  version: number;
  value: EntryHistory['value'];
  schema: EntryHistory['schema'];
  status: EntryHistory['status'];
  changed_by: string | null;
  changed_at: Date;
  note: string | null;
}

const ENTRY_COLUMNS =
  'id, key, kind, environment, locale, channel, description, schema, value, status, version, created_by, updated_by, created_at, updated_at';
const HISTORY_COLUMNS =
  'id, entry_id, version, value, schema, status, changed_by, changed_at, note';

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind,
    environment: row.environment,
    locale: row.locale === '' ? null : row.locale,
    channel: row.channel === '' ? null : (row.channel as Entry['channel']),
    description: row.description,
    schema: row.schema,
    value: row.value,
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHistory(row: HistoryRow): EntryHistory {
  return {
    id: row.id,
    entryId: row.entry_id,
    version: row.version,
    value: row.value,
    schema: row.schema,
    status: row.status,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    note: row.note,
  };
}

/** `%` and `_` (and the escape character) matched literally in LIKE. */
function likeContains(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * {@link LaciStore} on PostgreSQL, using a `pg` pool you provide. Run {@link migrate} once
 * (e.g. at startup) or apply `schema.postgres.sql` before use.
 *
 * ```ts
 * const store = new PostgresStore(new Pool({ connectionString }));
 * await store.migrate();
 * const laci = createLaci({ store });
 * ```
 */
export class PostgresStore implements LaciStore {
  private readonly prefix: string;

  constructor(
    private readonly pool: Pool,
    options: PostgresStoreOptions = {},
  ) {
    this.prefix = options.tablePrefix ?? 'laci_';
    assertTablePrefix(this.prefix);
  }

  /**
   * Creates or upgrades the tables. Safe to call on every startup and from several processes
   * at once: pending migrations run in one transaction under an advisory lock.
   */
  async migrate(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${this.prefix}migrate`]);
      await client.query(migrationsTable(this.prefix));
      const applied = await client.query<{ version: number }>(
        `SELECT version FROM ${this.table('migrations')}`,
      );
      const done = new Set(applied.rows.map((row) => row.version));
      for (const migration of migrations(this.prefix)) {
        if (done.has(migration.version)) continue;
        for (const statement of migration.statements) await client.query(statement);
        await client.query(
          `INSERT INTO ${this.table('migrations')} (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
      }
    });
  }

  async getEntry(address: EntryAddress): Promise<Entry | null> {
    const result = await this.pool.query<EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM ${this.table('entries')}
       WHERE key = $1 AND environment = $2 AND locale = $3 AND channel = $4`,
      [address.key, address.environment, address.locale ?? '', address.channel ?? ''],
    );
    const row = result.rows[0];
    return row ? toEntry(row) : null;
  }

  async listEntries(query: EntryQuery = {}): Promise<Paginated<Entry>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: (param: string) => string, value: unknown): void => {
      values.push(value);
      conditions.push(sql(`$${values.length}`));
    };
    if (query.kind !== undefined) add((p) => `kind = ${p}`, query.kind);
    if (query.key !== undefined) add((p) => `key = ${p}`, query.key);
    if (query.environment !== undefined) add((p) => `environment = ${p}`, query.environment);
    if (query.locale !== undefined) add((p) => `locale = ${p}`, query.locale ?? '');
    if (query.channel !== undefined) add((p) => `channel = ${p}`, query.channel ?? '');
    if (query.status !== undefined) {
      add((p) => `status = ANY(${p})`, Array.isArray(query.status) ? query.status : [query.status]);
    }
    if (query.search !== undefined && query.search !== '') {
      add(
        (p) => `(LOWER(key) LIKE ${p} OR LOWER(COALESCE(description, '')) LIKE ${p})`,
        likeContains(query.search),
      );
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const [rows, count] = await Promise.all([
      this.pool.query<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${this.table('entries')} ${where}
         ORDER BY key COLLATE "C", environment COLLATE "C", locale COLLATE "C", channel COLLATE "C"
         LIMIT ${pageNumber(limit)} OFFSET ${pageNumber(offset)}`,
        values,
      ),
      this.pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${this.table('entries')} ${where}`,
        values,
      ),
    ]);
    return { items: rows.rows.map(toEntry), total: count.rows[0]?.total ?? 0 };
  }

  async write(changes: readonly EntryWrite[]): Promise<void> {
    if (changes.length === 0) return;
    await this.transaction(async (client) => {
      for (const change of changes) {
        const { entry } = change;
        if (change.type === 'insert') {
          try {
            await client.query(
              `INSERT INTO ${this.table('entries')} (${ENTRY_COLUMNS})
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::json, $9::json, $10, $11, $12, $13, $14, $15)`,
              [
                entry.id,
                entry.key,
                entry.kind,
                entry.environment,
                entry.locale ?? '',
                entry.channel ?? '',
                entry.description,
                JSON.stringify(entry.schema),
                JSON.stringify(entry.value),
                entry.status,
                entry.version,
                entry.createdBy,
                entry.updatedBy,
                entry.createdAt,
                entry.updatedAt,
              ],
            );
          } catch (error) {
            if (errorField(error, 'constraint') === `uq_${this.prefix}entries_address`) {
              throw new EntryExistsError(entry);
            }
            throw error;
          }
        } else {
          const updated = await client.query(
            `UPDATE ${this.table('entries')}
             SET kind = $3, description = $4, schema = $5::json, value = $6::json, status = $7,
                 version = $8, updated_by = $9, updated_at = $10
             WHERE id = $1 AND version = $2`,
            [
              entry.id,
              change.expectedVersion,
              entry.kind,
              entry.description,
              JSON.stringify(entry.schema),
              JSON.stringify(entry.value),
              entry.status,
              entry.version,
              entry.updatedBy,
              entry.updatedAt,
            ],
          );
          if (updated.rowCount === 0) {
            const current = await client.query<{ version: number }>(
              `SELECT version FROM ${this.table('entries')} WHERE id = $1`,
              [entry.id],
            );
            throw new VersionConflictError(entry, change.expectedVersion, current.rows[0]?.version);
          }
        }
        const { history } = change;
        await client.query(
          `INSERT INTO ${this.table('entry_histories')} (${HISTORY_COLUMNS})
           VALUES ($1, $2, $3, $4::json, $5::json, $6, $7, $8, $9)`,
          [
            history.id,
            history.entryId,
            history.version,
            JSON.stringify(history.value),
            JSON.stringify(history.schema),
            history.status,
            history.changedBy,
            history.changedAt,
            history.note,
          ],
        );
      }
    });
  }

  async listHistory(entryId: string, page: PageQuery = {}): Promise<Paginated<EntryHistory>> {
    const limit = page.limit ?? DEFAULT_LIMIT;
    const offset = page.offset ?? 0;
    const [rows, count] = await Promise.all([
      this.pool.query<HistoryRow>(
        `SELECT ${HISTORY_COLUMNS} FROM ${this.table('entry_histories')}
         WHERE entry_id = $1 ORDER BY version DESC LIMIT ${pageNumber(limit)} OFFSET ${pageNumber(offset)}`,
        [entryId],
      ),
      this.pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM ${this.table('entry_histories')} WHERE entry_id = $1`,
        [entryId],
      ),
    ]);
    return { items: rows.rows.map(toHistory), total: count.rows[0]?.total ?? 0 };
  }

  async getHistory(entryId: string, version: number): Promise<EntryHistory | null> {
    const result = await this.pool.query<HistoryRow>(
      `SELECT ${HISTORY_COLUMNS} FROM ${this.table('entry_histories')}
       WHERE entry_id = $1 AND version = $2`,
      [entryId, version],
    );
    const row = result.rows[0];
    return row ? toHistory(row) : null;
  }

  private table(name: string): string {
    return `${this.prefix}${name}`;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
