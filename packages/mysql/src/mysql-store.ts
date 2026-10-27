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
import type { Pool, PoolConnection, QueryOptions } from 'mysql2/promise';
import { errorMessage, errorNumber } from './driver-errors';
import { assertTablePrefix, migrations, migrationsTable } from './schema';

/** Options of {@link MySqlStore}. */
export interface MySqlStoreOptions {
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = Pool | PoolConnection;

interface EntryRow {
  id: Buffer;
  key: string;
  kind: Entry['kind'];
  environment: string;
  locale: string;
  channel: string;
  description: string | null;
  schema: string;
  value: string;
  status: Entry['status'];
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryRow {
  id: Buffer;
  entry_id: Buffer;
  version: number;
  value: string;
  schema: string;
  status: EntryHistory['status'];
  changed_by: string | null;
  changed_at: string;
  note: string | null;
}

const ENTRY_COLUMNS =
  'id, `key`, kind, environment, locale, channel, description, `schema`, value, status, version, created_by, updated_by, created_at, updated_at';
const HISTORY_COLUMNS =
  'id, entry_id, version, value, `schema`, status, changed_by, changed_at, note';

// ---------------------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------------------

/** UUID string → BINARY(16). The MySQL store needs UUIDs (Laci's default IDs). */
function toBinary(id: string): Buffer {
  if (!UUID.test(id)) throw new TypeError(`Laci: MySqlStore needs UUID ids, got "${id}".`);
  return Buffer.from(id.replace(/-/g, ''), 'hex');
}

/** BINARY(16) → lowercase UUID string. */
function fromBinary(value: Buffer): string {
  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Date → `YYYY-MM-DD HH:MM:SS.mmm` in UTC, independent of the connection's time zone. */
function toDatetime(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function fromDatetime(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function toEntry(row: EntryRow): Entry {
  return {
    id: fromBinary(row.id),
    key: row.key,
    kind: row.kind,
    environment: row.environment,
    locale: row.locale === '' ? null : row.locale,
    channel: row.channel === '' ? null : (row.channel as Entry['channel']),
    description: row.description,
    schema: JSON.parse(row.schema) as Entry['schema'],
    value: JSON.parse(row.value) as Entry['value'],
    status: row.status,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: fromDatetime(row.created_at),
    updatedAt: fromDatetime(row.updated_at),
  };
}

function toHistory(row: HistoryRow): EntryHistory {
  return {
    id: fromBinary(row.id),
    entryId: fromBinary(row.entry_id),
    version: row.version,
    value: JSON.parse(row.value) as EntryHistory['value'],
    schema: JSON.parse(row.schema) as EntryHistory['schema'],
    status: row.status,
    changedBy: row.changed_by,
    changedAt: fromDatetime(row.changed_at),
    note: row.note,
  };
}

/** `%` and `_` (and the escape character) matched literally in LIKE. */
function likeContains(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Reads DATETIME columns as text so values are never shifted by the pool's time zone. */
const typeCast: QueryOptions['typeCast'] = (field, next) =>
  field.type === 'DATETIME' ? field.string() : next();

/**
 * {@link LaciStore} on MySQL 8 (InnoDB), using a `mysql2/promise` pool you provide. Run
 * {@link migrate} once (e.g. at startup) or apply `schema.mysql.sql` before use. IDs are stored
 * as `BINARY(16)`, so Laci must use UUIDs (its default).
 *
 * ```ts
 * const store = new MySqlStore(mysql.createPool(url));
 * await store.migrate();
 * const laci = createLaci({ store });
 * ```
 */
export class MySqlStore implements LaciStore {
  private readonly prefix: string;

  constructor(
    private readonly pool: Pool,
    options: MySqlStoreOptions = {},
  ) {
    this.prefix = options.tablePrefix ?? 'laci_';
    assertTablePrefix(this.prefix);
  }

  /**
   * Creates or upgrades the tables. Safe to call on every startup and from several processes
   * at once (a named lock serializes them). MySQL commits DDL immediately, so each migration's
   * statements are idempotent and a failed migration can be retried.
   */
  async migrate(): Promise<void> {
    const connection = await this.pool.getConnection();
    const lock = `${this.prefix}migrate`;
    try {
      await connection.query('SELECT GET_LOCK(?, 60)', [lock]);
      await connection.query(migrationsTable(this.prefix));
      const [rows] = await connection.query(`SELECT version FROM ${this.table('migrations')}`);
      const done = new Set((rows as { version: number }[]).map((row) => row.version));
      for (const migration of migrations(this.prefix)) {
        if (done.has(migration.version)) continue;
        for (const statement of migration.statements) await connection.query(statement);
        await connection.query(
          `INSERT INTO ${this.table('migrations')} (version, name) VALUES (?, ?)`,
          [migration.version, migration.name],
        );
      }
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
      connection.release();
    }
  }

  async getEntry(address: EntryAddress): Promise<Entry | null> {
    const rows = await this.select<EntryRow>(
      this.pool,
      `SELECT ${ENTRY_COLUMNS} FROM ${this.table('entries')}
       WHERE \`key\` = ? AND environment = ? AND locale = ? AND channel = ?`,
      [address.key, address.environment, address.locale ?? '', address.channel ?? ''],
    );
    const row = rows[0];
    return row ? toEntry(row) : null;
  }

  async listEntries(query: EntryQuery = {}): Promise<Paginated<Entry>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, ...params: unknown[]): void => {
      conditions.push(sql);
      values.push(...params);
    };
    if (query.kind !== undefined) add('kind = ?', query.kind);
    if (query.key !== undefined) add('`key` = ?', query.key);
    if (query.environment !== undefined) add('environment = ?', query.environment);
    if (query.locale !== undefined) add('locale = ?', query.locale ?? '');
    if (query.channel !== undefined) add('channel = ?', query.channel ?? '');
    if (query.status !== undefined) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      if (statuses.length === 0) add('1 = 0');
      else add('status IN (?)', statuses);
    }
    if (query.search !== undefined && query.search !== '') {
      const pattern = likeContains(query.search);
      add("(LOWER(`key`) LIKE ? OR LOWER(COALESCE(description, '')) LIKE ?)", pattern, pattern);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const [rows, count] = await Promise.all([
      this.select<EntryRow>(
        this.pool,
        `SELECT ${ENTRY_COLUMNS} FROM ${this.table('entries')} ${where}
         ORDER BY \`key\`, environment, locale, channel
         LIMIT ${pageNumber(limit)} OFFSET ${pageNumber(offset)}`,
        values,
      ),
      this.select<{ total: number | string }>(
        this.pool,
        `SELECT COUNT(*) AS total FROM ${this.table('entries')} ${where}`,
        values,
      ),
    ]);
    return { items: rows.map(toEntry), total: Number(count[0]?.total ?? 0) };
  }

  async write(changes: readonly EntryWrite[]): Promise<void> {
    if (changes.length === 0) return;
    await this.transaction(async (connection) => {
      for (const change of changes) {
        const { entry } = change;
        if (change.type === 'insert') {
          try {
            await connection.query(
              `INSERT INTO ${this.table('entries')} (${ENTRY_COLUMNS})
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                toBinary(entry.id),
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
                toDatetime(entry.createdAt),
                toDatetime(entry.updatedAt),
              ],
            );
          } catch (error) {
            if (
              errorNumber(error) === 1062 &&
              errorMessage(error).includes(`uq_${this.prefix}entries_address`)
            ) {
              throw new EntryExistsError(entry);
            }
            throw error;
          }
        } else {
          const [result] = await connection.query(
            `UPDATE ${this.table('entries')}
             SET kind = ?, description = ?, \`schema\` = ?, value = ?, status = ?, version = ?,
                 updated_by = ?, updated_at = ?
             WHERE id = ? AND version = ?`,
            [
              entry.kind,
              entry.description,
              JSON.stringify(entry.schema),
              JSON.stringify(entry.value),
              entry.status,
              entry.version,
              entry.updatedBy,
              toDatetime(entry.updatedAt),
              toBinary(entry.id),
              change.expectedVersion,
            ],
          );
          if ((result as { affectedRows: number }).affectedRows === 0) {
            const current = await this.select<{ version: number }>(
              connection,
              `SELECT version FROM ${this.table('entries')} WHERE id = ?`,
              [toBinary(entry.id)],
            );
            throw new VersionConflictError(entry, change.expectedVersion, current[0]?.version);
          }
        }
        const { history } = change;
        await connection.query(
          `INSERT INTO ${this.table('entry_histories')} (${HISTORY_COLUMNS})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            toBinary(history.id),
            toBinary(history.entryId),
            history.version,
            JSON.stringify(history.value),
            JSON.stringify(history.schema),
            history.status,
            history.changedBy,
            toDatetime(history.changedAt),
            history.note,
          ],
        );
      }
    });
  }

  async listHistory(entryId: string, page: PageQuery = {}): Promise<Paginated<EntryHistory>> {
    if (!UUID.test(entryId)) return { items: [], total: 0 };
    const limit = page.limit ?? DEFAULT_LIMIT;
    const offset = page.offset ?? 0;
    const id = toBinary(entryId);
    const [rows, count] = await Promise.all([
      this.select<HistoryRow>(
        this.pool,
        `SELECT ${HISTORY_COLUMNS} FROM ${this.table('entry_histories')}
         WHERE entry_id = ? ORDER BY version DESC LIMIT ${pageNumber(limit)} OFFSET ${pageNumber(offset)}`,
        [id],
      ),
      this.select<{ total: number | string }>(
        this.pool,
        `SELECT COUNT(*) AS total FROM ${this.table('entry_histories')} WHERE entry_id = ?`,
        [id],
      ),
    ]);
    return { items: rows.map(toHistory), total: Number(count[0]?.total ?? 0) };
  }

  async getHistory(entryId: string, version: number): Promise<EntryHistory | null> {
    if (!UUID.test(entryId)) return null;
    const rows = await this.select<HistoryRow>(
      this.pool,
      `SELECT ${HISTORY_COLUMNS} FROM ${this.table('entry_histories')}
       WHERE entry_id = ? AND version = ?`,
      [toBinary(entryId), version],
    );
    const row = rows[0];
    return row ? toHistory(row) : null;
  }

  private table(name: string): string {
    return `${this.prefix}${name}`;
  }

  private async select<T>(client: Queryable, sql: string, values: unknown[]): Promise<T[]> {
    const [rows] = await client.query({ sql, values, typeCast });
    return rows as T[];
  }

  private async transaction(work: (connection: PoolConnection) => Promise<void>): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await work(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
