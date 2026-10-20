'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { applyMigrations } = require('../../scripts/migrate');
const {
  TABLES,
  testDbConfig,
  startTestApp,
  clearData,
  insertProducts,
  countRows,
} = require('./helpers');

describe('struttura del database (db/migrations.sql)', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.stop());
  beforeEach(() => clearData(ctx.pool));

  it('crea tutte e cinque le tabelle', async () => {
    const [rows] = await ctx.pool.execute(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?',
      [ctx.db.database],
    );
    assert.deepEqual(rows.map((row) => row.name.toLowerCase()).sort(), [...TABLES].sort());
  });

  it('si può rieseguire senza perdere i dati', async () => {
    await insertProducts(ctx.pool, ['Farro bio']);

    await applyMigrations(ctx.db);

    assert.equal(await countRows(ctx.pool, 'products'), 1);
  });

  it('elimina le righe di un ordine insieme all\'ordine, ma blocca l\'eliminazione di prodotti e utenti', async () => {
    const [rows] = await ctx.pool.execute(
      `SELECT constraint_name AS name, referenced_table_name AS refTable, delete_rule AS rule
         FROM information_schema.referential_constraints
        WHERE constraint_schema = ?`,
      [ctx.db.database],
    );
    const rules = Object.fromEntries(rows.map((row) => [row.name, [row.refTable, row.rule]]));

    assert.deepEqual(rules, {
      fk_order_products_order: ['orders', 'CASCADE'],
      fk_order_products_product: ['products', 'RESTRICT'],
      fk_order_users_order: ['orders', 'CASCADE'],
      fk_order_users_user: ['users', 'RESTRICT'],
    });
  });

  it('l\'email degli utenti è unica anche se cambiano le maiuscole', async () => {
    await ctx.pool.execute('INSERT INTO users (name, surname, email) VALUES (?, ?, ?)', ['A', 'B', 'Mario@Example.it']);

    await assert.rejects(
      ctx.pool.execute('INSERT INTO users (name, surname, email) VALUES (?, ?, ?)', ['C', 'D', 'mario@example.it']),
      { code: 'ER_DUP_ENTRY' },
    );
  });

  it('ogni connessione del pool lavora in UTC', async () => {
    // Più query insieme, per usare più connessioni diverse.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ctx.pool.query('SELECT @@session.time_zone AS tz, SLEEP(0.05)')),
    );
    for (const [[row]] of results) assert.equal(row.tz, '+00:00');
  });

  it('la data di un ordine è quella UTC di adesso, qualunque sia il fuso del server o del processo', async () => {
    await ctx.pool.execute('INSERT INTO orders () VALUES ()');

    const [[row]] = await ctx.pool.execute(
      'SELECT TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP(3)) AS seconds FROM orders',
    );
    assert.ok(Math.abs(Number(row.seconds)) <= 2, `scarto di ${row.seconds} secondi dall'ora UTC`);
  });

  it('un nome di prodotto con emoji e accenti si salva e si rilegge identico (utf8mb4)', async () => {
    const [id] = await insertProducts(ctx.pool, ['Crème de soja 🌱']);

    const [[row]] = await ctx.pool.execute('SELECT name FROM products WHERE id = ?', [id]);
    assert.equal(row.name, 'Crème de soja 🌱');
  });
});

describe('protezione del database di sviluppo', () => {
  it('i test rifiutano un database il cui nome non contiene "test"', () => {
    assert.throws(() => testDbConfig({ DB_USER: 'u', DB_NAME: 'pof', TEST_DB_NAME: 'pof' }), /non contiene "test"/);
    assert.throws(() => testDbConfig({ DB_USER: 'u', DB_NAME: 'produzione', TEST_DB_NAME: 'vendite' }), /non contiene "test"/);
  });

  it('e uno che coincide con quello normale', () => {
    assert.throws(
      () => testDbConfig({ DB_USER: 'u', DB_NAME: 'pof_test', TEST_DB_NAME: 'pof_test' }),
      /coincide con DB_NAME/,
    );
  });

  it('accetta un nome con "test" diverso da DB_NAME', () => {
    assert.equal(testDbConfig({ DB_USER: 'u', DB_NAME: 'pof', TEST_DB_NAME: 'pof_test' }).database, 'pof_test');
  });
});
