import { describeStoreContract } from '@lacijs/store-tests';
import { createPool, dropTables, MySqlStore } from './db';

const prefix = 'laci_contract_';
const pool = createPool();

describeStoreContract('MySqlStore', {
  async setup() {
    await dropTables(pool, prefix);
    await new MySqlStore(pool, { tablePrefix: prefix }).migrate();
  },
  async create() {
    const connection = await pool.getConnection();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['entry_histories', 'entries']) {
      await connection.query(`TRUNCATE TABLE ${prefix}${table}`);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    connection.release();
    return new MySqlStore(pool, { tablePrefix: prefix });
  },
  async teardown() {
    await pool.end();
  },
});
