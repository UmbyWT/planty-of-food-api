'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { TABLES, startTestApp, clearData, insertProducts, insertUsers, insertOrderAt, countRows } = require('./helpers');

// Tentativi di SQL injection contro un database vero. Il punto non è solo che la richiesta
// venga rifiutata, ma che dopo ogni tentativo le tabelle e i dati siano intatti.

const PAYLOADS = [
  "'; DROP TABLE products; --",
  "Robert'); DROP TABLE users;--",
  "' OR '1'='1",
  '" OR ""="',
  "1; DELETE FROM orders",
  "'; UPDATE products SET name='hackerato'; --",
  "\\'; DROP TABLE orders; --",
  "' UNION SELECT id, email FROM users --",
  '%',
  '_',
  "/* commento */ x",
];

describe('SQL injection', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.stop());
  beforeEach(() => clearData(ctx.pool));

  async function assertDatabaseIntact(expected) {
    const [rows] = await ctx.pool.execute(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?',
      [ctx.db.database],
    );
    assert.equal(Number(rows[0].total), TABLES.length, 'manca qualche tabella');
    for (const [table, count] of Object.entries(expected)) {
      assert.equal(await countRows(ctx.pool, table), count, `righe di ${table}`);
    }
  }

  describe('nei campi di testo', () => {
    for (const payload of PAYLOADS) {
      it(`il nome di un prodotto "${payload}" viene salvato così com'è e basta`, async () => {
        const created = await ctx.api().post('/products').send({ name: payload });
        assert.equal(created.status, 201);

        const read = await ctx.api().get(`/products/${created.body.id}`);
        assert.equal(read.body.name, payload.trim());
        await assertDatabaseIntact({ products: 1 });
      });
    }

    it('lo stesso vale per nome e cognome di un utente', async () => {
      const body = { name: "Mario'); DROP TABLE users;--", surname: "' OR 1=1 --", email: 'mario@example.it' };

      const created = await ctx.api().post('/users').send(body);

      assert.equal(created.status, 201);
      assert.equal((await ctx.api().get(`/users/${created.body.id}`)).body.name, body.name);
      await assertDatabaseIntact({ users: 1 });
    });

    it('un\'email valida con l\'apostrofo (O\'Brien) viene salvata letteralmente, e un duplicato è un 409 pulito', async () => {
      const body = { name: 'Aoife', surname: "O'Brien", email: "o'brien@example.it" };

      const first = await ctx.api().post('/users').send(body);
      const again = await ctx.api().post('/users').send(body);

      assert.equal(first.status, 201);
      assert.equal(first.body.email, "o'brien@example.it");
      assert.equal(first.body.surname, "O'Brien");
      assert.equal(again.status, 409);
      await assertDatabaseIntact({ users: 1 });
    });

    it('un\'email che è una stringa SQL e non un indirizzo viene rifiutata', async () => {
      for (const email of ["a@b.it'; DROP TABLE users; --", "x'or'1'='1@example.it", "' OR 1=1 --"]) {
        const res = await ctx.api().post('/users').send({ name: 'A', surname: 'B', email });

        assert.equal(res.status, 400, `doveva rifiutare ${email}`);
      }
      await assertDatabaseIntact({ users: 0 });
    });

    it('anche in una modifica (PUT e PATCH)', async () => {
      const [id] = await insertProducts(ctx.pool, ['Farro']);

      const put = await ctx.api().put(`/products/${id}`).send({ name: "x'; DROP TABLE products; --" });
      const patch = await ctx.api().patch(`/products/${id}`).send({ name: "y' OR '1'='1" });

      assert.equal(put.status, 200);
      assert.equal(patch.status, 200);
      assert.equal(patch.body.name, "y' OR '1'='1");
      await assertDatabaseIntact({ products: 1 });
    });
  });

  describe('nell\'URL e nella query string', () => {
    beforeEach(async () => {
      const productIds = await insertProducts(ctx.pool, ['Farro', 'Ceci']);
      const userIds = await insertUsers(ctx.pool, 2);
      await insertOrderAt(ctx.pool, '2026-10-20T10:00:00.000Z', { productIds, userIds });
    });

    const BAD_IDS = ['1 OR 1=1', "1' OR '1'='1", '1;DROP TABLE products', '1/**/OR/**/1=1', '1 UNION SELECT 1', '-1 OR 1=1'];

    for (const id of BAD_IDS) {
      for (const resource of ['products', 'users', 'orders']) {
        it(`GET /${resource}/${id} risponde 400`, async () => {
          const res = await ctx.api().get(`/${resource}/${encodeURIComponent(id)}`);

          assert.equal(res.status, 400);
          assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        });
      }
    }

    it('DELETE con un id contraffatto non elimina niente', async () => {
      const res = await ctx.api().delete(`/products/${encodeURIComponent('1 OR 1=1')}`);

      assert.equal(res.status, 400);
      await assertDatabaseIntact({ products: 2, users: 2, orders: 1 });
    });

    const BAD_QUERIES = [
      { productId: '1 OR 1=1' },
      { productId: '1) OR (1=1' },
      { productId: "1' OR '1'='1" },
      { productId: '1,2; DROP TABLE orders' },
      { productId: '1 UNION SELECT 1' },
      { date: "2026-10-20' OR '1'='1" },
      { date: '2026-10-20; DROP TABLE orders' },
      { from: "2026-10-20'--" },
      { to: '2026-10-20 OR 1=1' },
      { 'productId[]': '1' },
      { '1=1; --': '' },
    ];

    for (const query of BAD_QUERIES) {
      it(`GET /orders con ${JSON.stringify(query)} risponde 400 e non tocca i dati`, async () => {
        const res = await ctx.api().get('/orders').query(query);

        assert.equal(res.status, 400);
        await assertDatabaseIntact({ products: 2, users: 2, orders: 1 });
      });
    }

    it('un filtro con id numerici validi non restituisce mai ordini di altri prodotti', async () => {
      const [other] = await insertProducts(ctx.pool, ['Altro']);

      const res = await ctx.api().get('/orders').query({ productId: other });

      assert.deepEqual(res.body, []);
    });
  });

  describe('nel corpo di un ordine', () => {
    it('id di tipo sbagliato, come stringhe SQL, vengono rifiutati prima di arrivare al database', async () => {
      const [productId] = await insertProducts(ctx.pool, ['Farro']);
      const [userId] = await insertUsers(ctx.pool, 1);

      for (const bad of ['1 OR 1=1', "1'; DROP TABLE orders; --", { $gt: 0 }, [1], null]) {
        const res = await ctx.api().post('/orders').send({ productIds: [bad], userIds: [userId] });
        assert.equal(res.status, 400, `doveva rifiutare ${JSON.stringify(bad)}`);
      }
      const ok = await ctx.api().post('/orders').send({ productIds: [productId], userIds: [userId] });
      assert.equal(ok.status, 201);
      await assertDatabaseIntact({ products: 1, users: 1, orders: 1 });
    });
  });

  describe('come sono fatte le query', () => {
    it('il database non accetta più istruzioni nella stessa query (multipleStatements è spento)', async () => {
      // Anche se un giorno un punto e virgola riuscisse a passare, la seconda istruzione non partirebbe.
      await assert.rejects(ctx.pool.query('SELECT 1; SELECT 2'), { code: 'ER_PARSE_ERROR' });
    });

    it('le richieste dell\'API arrivano al server come prepared statement', async (t) => {
      const readCounter = async (name) => {
        const [rows] = await ctx.pool.query('SHOW GLOBAL STATUS LIKE ?', [name]);
        return Number(rows[0].Value);
      };

      let beforeExecute;
      try {
        beforeExecute = await readCounter('Com_stmt_execute');
      } catch (error) {
        t.skip(`il server non permette di leggere i contatori: ${error.code}`);
        return;
      }
      const beforePrepare = await readCounter('Com_stmt_prepare');

      const [productId] = await insertProducts(ctx.pool, ['Farro']);
      const [userId] = await insertUsers(ctx.pool, 1);
      await ctx.api().get('/products');
      await ctx.api().post('/products').send({ name: 'Ceci' });
      await ctx.api().post('/users').send({ name: 'A', surname: 'B', email: 'ab@example.it' });
      await ctx.api().post('/orders').send({ productIds: [productId], userIds: [userId] });
      await ctx.api().get('/orders').query({ productId, date: '2026-10-20' });

      const executed = (await readCounter('Com_stmt_execute')) - beforeExecute;
      const prepared = (await readCounter('Com_stmt_prepare')) - beforePrepare;
      // Solo le cinque chiamate API fanno almeno cinque esecuzioni; gli statement veri sono molti di più.
      assert.ok(executed >= 15, `solo ${executed} esecuzioni di prepared statement`);
      assert.ok(prepared >= 1, 'nessun prepared statement creato');
    });
  });
});
