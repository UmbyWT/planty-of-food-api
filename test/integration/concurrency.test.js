'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createOrderRepository } = require('../../src/repositories/orderRepository');
const { startTestApp, clearData, insertProducts, insertUsers, countRows } = require('./helpers');

// Un pool che si comporta come quello vero, ma dopo la lettura della riga dell'ordine
// dentro una transazione aspetta `ms` millisecondi prima di passare all'istruzione successiva.
function slowAfterOrderLookup(pool, ms) {
  return {
    execute: (...args) => pool.execute(...args),
    async getConnection() {
      const connection = await pool.getConnection();
      return new Proxy(connection, {
        get(target, property) {
          if (property === 'execute') {
            return async (sql, params) => {
              const result = await target.execute(sql, params);
              if (/FROM orders WHERE id = \?/.test(sql)) await delay(ms);
              return result;
            };
          }
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

// Richieste che arrivano nello stesso istante. Servono a vedere se i vincoli del database
// e il blocco FOR UPDATE reggono quando due client si pestano i piedi.
describe('richieste contemporanee', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.stop());
  beforeEach(() => clearData(ctx.pool));

  it('cinque registrazioni con la stessa email: una sola riesce, le altre danno 409', async () => {
    const body = { name: 'Giulia', surname: 'Bianchi', email: 'giulia@example.it' };

    const results = await Promise.all(Array.from({ length: 5 }, () => ctx.api().post('/users').send(body)));

    const statuses = results.map((res) => res.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
    assert.equal(await countRows(ctx.pool, 'users'), 1);
  });

  it('venti ordini creati insieme ottengono venti id diversi', async () => {
    const [productId] = await insertProducts(ctx.pool, ['Farro']);
    const [userId] = await insertUsers(ctx.pool, 1);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => ctx.api().post('/orders').send({ productIds: [productId], userIds: [userId] })),
    );

    assert.ok(results.every((res) => res.status === 201));
    assert.equal(new Set(results.map((res) => res.body.id)).size, 20);
    assert.equal(await countRows(ctx.pool, 'order_products'), 20);
  });

  it('due modifiche dello stesso ordine: vince una delle due per intero, mai un miscuglio', async () => {
    const productIds = await insertProducts(ctx.pool, ['A', 'B', 'C', 'D']);
    const [userId] = await insertUsers(ctx.pool, 1);
    const created = await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userId] });
    const orderId = created.body.id;

    const first = [productIds[0], productIds[1]];
    const second = [productIds[2], productIds[3]];
    const results = await Promise.all([
      ctx.api().put(`/orders/${orderId}`).send({ productIds: first, userIds: [userId] }),
      ctx.api().put(`/orders/${orderId}`).send({ productIds: second, userIds: [userId] }),
    ]);

    assert.deepEqual(results.map((res) => res.status), [200, 200]);
    const final = (await ctx.api().get(`/orders/${orderId}`)).body.products.map((product) => product.id);
    assert.ok(
      JSON.stringify(final) === JSON.stringify(first) || JSON.stringify(final) === JSON.stringify(second),
      `elenco finale inatteso: ${final}`,
    );
  });

  it('molte modifiche in fila sullo stesso ordine non lasciano mai righe doppie né errori', async () => {
    const productIds = await insertProducts(ctx.pool, ['A', 'B', 'C']);
    const [userId] = await insertUsers(ctx.pool, 1);
    const orderId = (await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userId] })).body.id;

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        ctx.api().patch(`/orders/${orderId}`).send({ productIds: [productIds[i % 3]] }),
      ),
    );

    assert.ok(results.every((res) => res.status === 200), results.map((res) => res.status).join(','));
    assert.equal(await countRows(ctx.pool, 'order_products', 'order_id = ?', [orderId]), 1);
  });

  it('un\'eliminazione che arriva a metà modifica aspetta che la modifica finisca (FOR UPDATE)', async () => {
    const productIds = await insertProducts(ctx.pool, ['A', 'B']);
    const [userId] = await insertUsers(ctx.pool, 1);
    const orderId = (await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userId] })).body.id;

    // Una modifica rallentata di proposito: dopo aver letto la riga dell'ordine aspetta
    // mezzo secondo prima di scrivere. Così l'eliminazione arriva per forza nel mezzo.
    // Senza il blocco sulla riga, l'ordine sparirebbe sotto i piedi della modifica, che
    // fallirebbe sulla chiave esterna con un errore sbagliato (422) invece di concludersi.
    const slowRepository = createOrderRepository(slowAfterOrderLookup(ctx.pool, 500));
    const realRepository = createOrderRepository(ctx.pool);

    const updating = slowRepository.update(orderId, { productIds: [productIds[1]] });
    await delay(150);
    const startedAt = Date.now();
    const removing = realRepository.remove(orderId).then((removed) => ({ removed, waited: Date.now() - startedAt }));

    const [updated, removal] = await Promise.all([updating, removing]);

    assert.equal(updated, true, 'la modifica doveva concludersi');
    assert.equal(removal.removed, true);
    assert.ok(removal.waited >= 250, `l'eliminazione non ha aspettato la modifica (${removal.waited} ms)`);
    assert.equal(await countRows(ctx.pool, 'orders', 'id = ?', [orderId]), 0);
  });

  it('eliminare un prodotto mentre si crea un ordine che lo usa: o l\'ordine nasce e il prodotto resta, o il contrario', async () => {
    const [productId] = await insertProducts(ctx.pool, ['Farro']);
    const [userId] = await insertUsers(ctx.pool, 1);

    const [order, removal] = await Promise.all([
      ctx.api().post('/orders').send({ productIds: [productId], userIds: [userId] }),
      ctx.api().delete(`/products/${productId}`),
    ]);

    // Gli esiti ammessi sono due, e non possono mai produrre un ordine con un prodotto fantasma.
    const orderWon = order.status === 201 && removal.status === 409;
    const removalWon = (order.status === 422 || order.status === 404) && removal.status === 204;
    assert.ok(orderWon || removalWon, `esiti incoerenti: ordine ${order.status}, eliminazione ${removal.status}`);

    const [[orphans]] = await ctx.pool.query(
      `SELECT COUNT(*) AS total FROM order_products op
        LEFT JOIN products p ON p.id = op.product_id
       WHERE p.id IS NULL`,
    );
    assert.equal(Number(orphans.total), 0);
  });

  it('/health risponde 200 con il database vero', async () => {
    const res = await ctx.api().get('/health');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });
});
