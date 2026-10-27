import { readFileSync } from 'node:fs';
import { createLaci } from '@lacijs/core';
import { entry, historyOf, insert } from '@lacijs/store-tests';
import { createPool as createMySqlPool } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schemaSql } from '../src/schema';
import { createPool, DATABASE_URL, dropTables, MySqlStore } from './db';

const pool = createPool();
const prefix = 'laci_migrate_';

afterAll(async () => {
  await dropTables(pool, prefix);
  await pool.end();
});

async function tables(): Promise<string[]> {
  const [rows] = await pool.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name LIKE ? ORDER BY 1`,
    [`${prefix.replace(/_/g, '\\_')}%`],
  );
  return (rows as { name: string }[]).map((row) => row.name);
}

describe('MySqlStore migrations', () => {
  beforeEach(async () => {
    await dropTables(pool, prefix);
  });

  it('creates InnoDB tables with the configured prefix and records the version', async () => {
    await new MySqlStore(pool, { tablePrefix: prefix }).migrate();
    expect(await tables()).toEqual(
      ['entries', 'entry_histories', 'migrations'].map((table) => prefix + table),
    );
    const [engines] = await pool.query(
      `SELECT DISTINCT engine FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name LIKE ?`,
      [`${prefix.replace(/_/g, '\\_')}%`],
    );
    expect(engines).toEqual([{ ENGINE: 'InnoDB' }]);
    const [applied] = await pool.query(`SELECT version, name FROM ${prefix}migrations`);
    expect(applied).toEqual([{ version: 1, name: 'initial schema' }]);
  });

  it('is idempotent and safe to run concurrently', async () => {
    const store = new MySqlStore(pool, { tablePrefix: prefix });
    await Promise.all([store.migrate(), store.migrate(), store.migrate()]);
    await store.migrate();
    const [rows] = await pool.query(`SELECT COUNT(*) AS n FROM ${prefix}migrations`);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('can be retried after failing halfway', async () => {
    // A view with a table's name makes the migration fail after creating the first table.
    await pool.query(`CREATE VIEW ${prefix}entry_histories AS SELECT 1 AS id`);
    const store = new MySqlStore(pool, { tablePrefix: prefix });
    await expect(store.migrate()).rejects.toThrow();
    await pool.query(`DROP VIEW ${prefix}entry_histories`);
    await store.migrate();
    expect(await tables()).toHaveLength(3);
  });

  it('uses the laci_ prefix by default', async () => {
    const names = ['entry_histories', 'entries', 'migrations'];
    const drop = () =>
      pool.query(`DROP TABLE IF EXISTS ${names.map((n) => `laci_${n}`).join(', ')}`);
    await drop();
    try {
      await new MySqlStore(pool).migrate();
      const [rows] = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN (?)`,
        [names.map((n) => `laci_${n}`)],
      );
      expect(rows).toHaveLength(names.length);
    } finally {
      await drop();
    }
  });

  it('rejects unsafe table prefixes', () => {
    for (const bad of ['Laci_', 'laci`; DROP TABLE x;--', '1laci_', 'a'.repeat(32)]) {
      expect(() => new MySqlStore(pool, { tablePrefix: bad })).toThrow(TypeError);
    }
  });

  it('ships schema.mysql.sql matching the migrations', () => {
    const file = readFileSync(new URL('../schema.mysql.sql', import.meta.url), 'utf8');
    expect(file).toBe(schemaSql());
  });

  it('works on a database set up from the raw SQL file', async () => {
    const multi = createMySqlPool({ uri: DATABASE_URL, multipleStatements: true });
    await multi.query(schemaSql(prefix));
    await multi.end();
    const store = new MySqlStore(pool, { tablePrefix: prefix });
    await store.migrate(); // already applied: nothing to do
    const stored = entry();
    await store.write([insert(stored)]);
    expect(await store.getEntry(stored)).toEqual(stored);
  });
});

describe('MySqlStore data handling', () => {
  beforeEach(async () => {
    await dropTables(pool, prefix);
    await new MySqlStore(pool, { tablePrefix: prefix }).migrate();
  });

  it('round-trips times exactly, whatever the pool time zone', async () => {
    const shifted = createMySqlPool({ uri: DATABASE_URL, timezone: '+07:00' });
    const store = new MySqlStore(shifted, { tablePrefix: prefix });
    const stored = entry();
    await store.write([insert(stored)]);
    expect(await store.getEntry(stored)).toEqual(stored);
    expect(await new MySqlStore(pool, { tablePrefix: prefix }).getEntry(stored)).toEqual(stored);
    await shifted.end();
  });

  it('needs UUID ids', async () => {
    const store = new MySqlStore(pool, { tablePrefix: prefix });
    const laci = createLaci({ store, generateId: () => 'not-a-uuid' });
    await expect(laci.define('x', { schema: {}, value: 1 })).rejects.toThrow(
      'MySqlStore needs UUID ids, got "not-a-uuid"',
    );
    expect(await store.listHistory('not-a-uuid')).toEqual({ items: [], total: 0 });
    expect(await store.getHistory('not-a-uuid', 1)).toBeNull();
  });

  it('enforces kind, status, channel, and valid JSON in the database', async () => {
    const store = new MySqlStore(pool, { tablePrefix: prefix });
    await expect(store.write([insert(entry({ kind: 'OTHER' as never }))])).rejects.toThrow(/ck_/);
    await expect(store.write([insert(entry({ status: 'LIVE' as never }))])).rejects.toThrow(/ck_/);
    await expect(store.write([insert(entry({ channel: 'FAX' as never }))])).rejects.toThrow(/ck_/);
    await store.write([insert(entry())]);
    await expect(pool.query(`UPDATE ${prefix}entries SET value = '{not json'`)).rejects.toThrow(
      /ck_/,
    );
  });

  it('passes database errors through and writes nothing', async () => {
    const store = new MySqlStore(pool, { tablePrefix: prefix });
    const tooLong = 'x'.repeat(300);
    await expect(store.write([insert(entry({ createdBy: tooLong }))])).rejects.toThrow(/too long/);
    const stored = entry();
    await expect(
      store.write([{ ...insert(stored), history: historyOf(stored, { changedBy: tooLong }) }]),
    ).rejects.toThrow(/too long/);
    expect(await store.getEntry(stored)).toBeNull();
  });

  it('refuses a limit or offset that is not a non-negative integer', async () => {
    for (const page of [{ limit: -1 }, { offset: 1.5 }, { limit: '1; DROP TABLE x' as never }]) {
      await expect(new MySqlStore(pool, { tablePrefix: prefix }).listEntries(page)).rejects.toThrow(
        'non-negative integers',
      );
      await expect(
        new MySqlStore(pool, { tablePrefix: prefix }).listHistory(entry().id, page),
      ).rejects.toThrow('non-negative integers');
    }
  });
});
