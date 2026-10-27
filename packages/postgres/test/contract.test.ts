import { describeStoreContract } from '@lacijs/store-tests';
import { createPool, dropTables, PostgresStore } from './db';

const prefix = 'laci_contract_';
const pool = createPool();

describeStoreContract('PostgresStore', {
  async setup() {
    await dropTables(pool, prefix);
    await new PostgresStore(pool, { tablePrefix: prefix }).migrate();
  },
  async create() {
    await pool.query(`TRUNCATE TABLE ${prefix}entry_histories, ${prefix}entries`);
    return new PostgresStore(pool, { tablePrefix: prefix });
  },
  async teardown() {
    await pool.end();
  },
});
