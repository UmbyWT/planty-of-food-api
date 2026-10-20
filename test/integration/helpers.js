'use strict';

// Strumenti comuni ai test di integrazione: questi test parlano con un database vero.

const path = require('node:path');
const assert = require('node:assert/strict');
const request = require('supertest');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const { loadConfig } = require('../../src/config');
const { createPool } = require('../../src/db');
const { composeApp } = require('../../src/compose');
const { applyMigrations } = require('../../scripts/migrate');

// Dai figli ai genitori, così si possono eliminare in questo ordine senza violare le chiavi esterne.
const TABLES = ['order_products', 'order_users', 'orders', 'products', 'users'];

// I test cancellano le tabelle, quindi non devono mai finire sul database vero.
// Il nome deve contenere "test" ed essere diverso da DB_NAME.
function testDbConfig(env = process.env) {
  const name = env.TEST_DB_NAME || 'pof_test';
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DB_NAME="${name}" non contiene "test". Rifiuto di cancellare le tabelle di quel database.`,
    );
  }
  if (name === env.DB_NAME) {
    throw new Error('TEST_DB_NAME coincide con DB_NAME: i test devono usare un database a parte.');
  }
  return loadConfig({ ...env, DB_NAME: name }).db;
}

async function dropTables(pool) {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(', ')}`);
}

// Svuota le tabelle tenendo i riferimenti validi. TRUNCATE fa ripartire anche gli id da 1.
async function clearData(pool) {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) await connection.query(`TRUNCATE TABLE ${table}`);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
}

// Ricrea la struttura da zero con migrations.sql e restituisce app, pool e l'elenco degli
// errori che l'app ha scritto nel log. A fine file `stop` fa fallire il test se c'è stato
// anche un solo errore 500: nei test di integrazione non ne è previsto nessuno.
async function startTestApp() {
  const db = testDbConfig();
  const pool = createPool(db);
  const logged = [];
  try {
    await dropTables(pool);
    await applyMigrations(db);
  } catch (error) {
    await pool.end();
    if (error.code === 'ER_BAD_DB_ERROR') {
      throw new Error(`Il database "${db.database}" non esiste: crealo prima di lanciare i test (vedi README).`);
    }
    throw error;
  }
  const app = composeApp(pool, { logger: { error: (error) => logged.push(error) } });

  return {
    app,
    pool,
    db,
    logged,
    api: () => request(app),
    async stop() {
      try {
        assert.deepEqual(
          logged.map((error) => error.message),
          [],
          "L'app ha registrato errori imprevisti durante i test.",
        );
      } finally {
        await pool.end();
      }
    },
  };
}

// ---- dati di prova scritti direttamente in SQL, senza passare dall'API ------------------

async function insertProducts(pool, names) {
  const ids = [];
  for (const name of names) {
    const [result] = await pool.execute('INSERT INTO products (name) VALUES (?)', [name]);
    ids.push(result.insertId);
  }
  return ids;
}

async function insertUsers(pool, count = 2) {
  const ids = [];
  for (let i = 1; i <= count; i += 1) {
    const [result] = await pool.execute(
      'INSERT INTO users (name, surname, email) VALUES (?, ?, ?)',
      [`Nome${i}`, `Cognome${i}`, `utente${i}@example.it`],
    );
    ids.push(result.insertId);
  }
  return ids;
}

// Inserisce un ordine con una data precisa, scritta in UTC come fa l'applicazione.
async function insertOrderAt(pool, isoDate, { productIds, userIds }) {
  const [result] = await pool.execute('INSERT INTO orders (created_at) VALUES (?)', [new Date(isoDate)]);
  const orderId = result.insertId;
  for (const productId of productIds) {
    await pool.execute('INSERT INTO order_products (order_id, product_id) VALUES (?, ?)', [orderId, productId]);
  }
  for (const userId of userIds) {
    await pool.execute('INSERT INTO order_users (order_id, user_id) VALUES (?, ?)', [orderId, userId]);
  }
  return orderId;
}

async function countRows(pool, table, where = '1 = 1', params = []) {
  assert.ok(TABLES.includes(table), `tabella sconosciuta: ${table}`);
  const [[row]] = await pool.execute(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`, params);
  return Number(row.total);
}

module.exports = {
  TABLES,
  testDbConfig,
  dropTables,
  clearData,
  startTestApp,
  insertProducts,
  insertUsers,
  insertOrderAt,
  countRows,
};
