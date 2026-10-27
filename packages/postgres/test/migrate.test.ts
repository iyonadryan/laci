import { readFileSync } from 'node:fs';
import { entry, historyOf, insert } from '@lacijs/store-tests';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schemaSql } from '../src/schema';
import { createPool, dropTables, PostgresStore } from './db';

const pool = createPool();
const prefix = 'laci_migrate_';

afterAll(async () => {
  await pool.end();
});

async function tables(name: string): Promise<string[]> {
  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE $1 ORDER BY 1`,
    [`${name.replace(/_/g, '\\_')}%`],
  );
  return result.rows.map((row) => row.tablename);
}

describe('PostgresStore migrations', () => {
  beforeEach(async () => {
    await dropTables(pool, prefix);
  });
  afterAll(async () => {
    await dropTables(pool, prefix);
  });

  it('creates the tables with the configured prefix and records the version', async () => {
    await new PostgresStore(pool, { tablePrefix: prefix }).migrate();
    expect(await tables(prefix)).toEqual(
      ['entries', 'entry_histories', 'migrations'].map((table) => prefix + table),
    );
    const applied = await pool.query(`SELECT version, name FROM ${prefix}migrations`);
    expect(applied.rows).toEqual([{ version: 1, name: 'initial schema' }]);
  });

  it('is idempotent and safe to run concurrently', async () => {
    const store = new PostgresStore(pool, { tablePrefix: prefix });
    await Promise.all([store.migrate(), store.migrate(), store.migrate()]);
    await store.migrate();
    const applied = await pool.query(`SELECT COUNT(*)::int AS n FROM ${prefix}migrations`);
    expect(applied.rows[0]).toEqual({ n: 1 });
  });

  it('rolls back a failed migration', async () => {
    await pool.query(`CREATE TABLE ${prefix}entry_histories (id INT)`); // clashes with the migration
    await expect(new PostgresStore(pool, { tablePrefix: prefix }).migrate()).rejects.toThrow(
      /already exists/,
    );
    expect(await tables(prefix)).toEqual([`${prefix}entry_histories`]);
  });

  it('uses the laci_ prefix by default', async () => {
    const names = ['entry_histories', 'entries', 'migrations'];
    const drop = () =>
      pool.query(`DROP TABLE IF EXISTS ${names.map((n) => `laci_${n}`).join(', ')}`);
    await drop();
    try {
      await new PostgresStore(pool).migrate();
      const result = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE tablename = ANY($1) ORDER BY 1`,
        [names.map((n) => `laci_${n}`)],
      );
      expect(result.rows).toHaveLength(names.length);
    } finally {
      await drop();
    }
  });

  it('rejects unsafe table prefixes', () => {
    for (const bad of ['Laci_', 'laci; DROP TABLE x;--', '1laci_', 'a'.repeat(32)]) {
      expect(() => new PostgresStore(pool, { tablePrefix: bad })).toThrow(TypeError);
    }
  });

  it('ships schema.postgres.sql matching the migrations', () => {
    const file = readFileSync(new URL('../schema.postgres.sql', import.meta.url), 'utf8');
    expect(file).toBe(schemaSql());
  });

  it('works on a database set up from the raw SQL file', async () => {
    await pool.query(schemaSql(prefix));
    const store = new PostgresStore(pool, { tablePrefix: prefix });
    await store.migrate(); // already applied: nothing to do
    const stored = entry();
    await store.write([insert(stored)]);
    expect(await store.getEntry(stored)).toEqual(stored);
  });

  it('enforces kind, status, and channel in the database', async () => {
    await new PostgresStore(pool, { tablePrefix: prefix }).migrate();
    const store = new PostgresStore(pool, { tablePrefix: prefix });
    await expect(store.write([insert(entry({ kind: 'OTHER' as never }))])).rejects.toThrow(/ck_/);
    await expect(store.write([insert(entry({ status: 'LIVE' as never }))])).rejects.toThrow(/ck_/);
    await expect(store.write([insert(entry({ channel: 'FAX' as never }))])).rejects.toThrow(/ck_/);
  });
});

describe('PostgresStore errors', () => {
  const errorsPrefix = 'laci_errors_';
  const store = () => new PostgresStore(pool, { tablePrefix: errorsPrefix });

  beforeEach(async () => {
    await dropTables(pool, errorsPrefix);
    await store().migrate();
  });
  afterAll(async () => {
    await dropTables(pool, errorsPrefix);
  });

  it('passes database errors through and writes nothing', async () => {
    const tooLong = 'x'.repeat(300);
    await expect(store().write([insert(entry({ createdBy: tooLong }))])).rejects.toThrow(
      /too long/,
    );
    const stored = entry();
    const write = insert(stored);
    await expect(
      store().write([{ ...write, history: historyOf(stored, { changedBy: tooLong }) }]),
    ).rejects.toThrow(/too long/);
    expect(await store().getEntry(stored)).toBeNull();
  });

  it('refuses a limit or offset that is not a non-negative integer', async () => {
    for (const page of [{ limit: -1 }, { offset: 1.5 }, { limit: '1; DROP TABLE x' as never }]) {
      await expect(store().listEntries(page)).rejects.toThrow('non-negative integers');
      await expect(store().listHistory(entry().id, page)).rejects.toThrow('non-negative integers');
    }
  });
});
