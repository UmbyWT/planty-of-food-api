'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, clearData, insertProducts, insertUsers, insertOrderAt } = require('./helpers');

// Ordini inseriti a date precise, tutte in UTC. Le date di confine (un millisecondo prima
// e dopo la mezzanotte) servono a provare che gli intervalli siano esatti.
//
//   A  2026-10-19 23:59:59.999  [farro]
//   B  2026-10-20 00:00:00.000  [farro, ceci]
//   C  2026-10-20 12:00:00.000  [ceci]
//   D  2026-10-20 23:59:59.999  [lenticchie]
//   E  2026-10-21 00:00:00.000  [farro, lenticchie]
//   F  2026-11-05 10:00:00.000  [ceci, lenticchie]
describe('GET /orders, filtri con il database vero', () => {
  let ctx;
  let orders; // { A: id, B: id, ... }
  let products; // { farro, ceci, lenticchie, orzo }
  let userId;

  before(async () => {
    ctx = await startTestApp();
    await clearData(ctx.pool);

    const [farro, ceci, lenticchie, orzo] = await insertProducts(ctx.pool, ['Farro', 'Ceci', 'Lenticchie', 'Orzo']);
    products = { farro, ceci, lenticchie, orzo };
    [userId] = await insertUsers(ctx.pool, 1);

    const place = (isoDate, productIds) => insertOrderAt(ctx.pool, isoDate, { productIds, userIds: [userId] });
    orders = {
      A: await place('2026-10-19T23:59:59.999Z', [farro]),
      B: await place('2026-10-20T00:00:00.000Z', [farro, ceci]),
      C: await place('2026-10-20T12:00:00.000Z', [ceci]),
      D: await place('2026-10-20T23:59:59.999Z', [lenticchie]),
      E: await place('2026-10-21T00:00:00.000Z', [farro, lenticchie]),
      F: await place('2026-11-05T10:00:00.000Z', [ceci, lenticchie]),
    };
  });
  after(() => ctx.stop());

  // Chiama GET /orders e restituisce le lettere degli ordini ricevuti, nell'ordine ricevuto.
  async function lettersFor(query) {
    const res = await ctx.api().get('/orders').query(query);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const byId = Object.fromEntries(Object.entries(orders).map(([letter, id]) => [id, letter]));
    return res.body.orders.map((order) => byId[order.id]).join('');
  }

  it('senza filtri restituisce tutto, dal più recente al più vecchio', async () => {
    assert.equal(await lettersFor({}), 'FEDCBA');
  });

  describe('per data di inserimento', () => {
    it('date: un giorno solo, da mezzanotte a mezzanotte', async () => {
      assert.equal(await lettersFor({ date: '2026-10-20' }), 'DCB');
    });

    it('date: i giorni attorno non prendono gli ordini dei vicini', async () => {
      assert.equal(await lettersFor({ date: '2026-10-19' }), 'A');
      assert.equal(await lettersFor({ date: '2026-10-21' }), 'E');
    });

    it('date: un giorno senza ordini dà un elenco vuoto e 200', async () => {
      assert.equal(await lettersFor({ date: '2026-10-22' }), '');
    });

    it('from e to: l\'ultimo giorno è compreso per intero', async () => {
      assert.equal(await lettersFor({ from: '2026-10-20', to: '2026-10-20' }), 'DCB');
      assert.equal(await lettersFor({ from: '2026-10-20', to: '2026-10-21' }), 'EDCB');
    });

    it('solo from: da quel giorno in poi', async () => {
      assert.equal(await lettersFor({ from: '2026-10-21' }), 'FE');
    });

    it('solo to: fino a quel giorno compreso', async () => {
      assert.equal(await lettersFor({ to: '2026-10-19' }), 'A');
      assert.equal(await lettersFor({ to: '2026-10-20' }), 'DCBA');
    });

    it('un intervallo largo prende tutto', async () => {
      assert.equal(await lettersFor({ from: '2026-01-01', to: '2026-12-31' }), 'FEDCBA');
    });
  });

  describe('per prodotto contenuto', () => {
    it('un prodotto: tutti gli ordini che lo contengono', async () => {
      assert.equal(await lettersFor({ productId: products.farro }), 'EBA');
      assert.equal(await lettersFor({ productId: products.ceci }), 'FCB');
    });

    it('l\'ordine trovato mostra comunque tutti i suoi prodotti, non solo quello cercato', async () => {
      const res = await ctx.api().get('/orders').query({ productId: products.farro });
      const orderE = res.body.orders.find((order) => order.id === orders.E);

      assert.deepEqual(
        orderE.products.map((product) => product.name),
        ['Farro', 'Lenticchie'],
      );
    });

    it('più prodotti: basta che l\'ordine ne contenga uno, e compare una volta sola', async () => {
      const expected = 'FEDCB'; // B contiene sia farro sia ceci ma compare una volta
      assert.equal(await lettersFor({ productId: `${products.ceci},${products.lenticchie}` }), expected);
      assert.equal(await lettersFor({ productId: [products.ceci, products.lenticchie] }), expected);
      assert.equal(await lettersFor({ productId: [`${products.ceci}`, `${products.lenticchie},${products.ceci}`] }), expected);
    });

    it('un prodotto che nessun ordine contiene dà un elenco vuoto', async () => {
      assert.equal(await lettersFor({ productId: products.orzo }), '');
    });

    it('un id di prodotto che non esiste dà un elenco vuoto, non un errore', async () => {
      assert.equal(await lettersFor({ productId: 99999 }), '');
    });
  });

  describe('filtri insieme', () => {
    it('data e prodotto: l\'ordine deve rispettarli entrambi', async () => {
      assert.equal(await lettersFor({ date: '2026-10-20', productId: products.farro }), 'B');
      assert.equal(await lettersFor({ date: '2026-10-20', productId: products.ceci }), 'CB');
      assert.equal(await lettersFor({ date: '2026-10-20', productId: products.orzo }), '');
    });

    it('intervallo e più prodotti', async () => {
      assert.equal(
        await lettersFor({ from: '2026-10-20', to: '2026-10-21', productId: `${products.farro},${products.lenticchie}` }),
        'EDB',
      );
    });
  });

  describe('ordinamento', () => {
    it('a parità di data decide l\'id, dal più grande', async () => {
      // Un prodotto tutto suo, così gli altri test non vedono questi due ordini.
      const [segale] = await insertProducts(ctx.pool, ['Segale']);
      const same = '2027-01-01T08:00:00.000Z';
      const first = await insertOrderAt(ctx.pool, same, { productIds: [segale], userIds: [userId] });
      const second = await insertOrderAt(ctx.pool, same, { productIds: [segale], userIds: [userId] });

      const res = await ctx.api().get('/orders').query({ productId: segale });

      assert.deepEqual(res.body.orders.map((order) => order.id), [second, first]);
    });
  });

  describe('forma della risposta', () => {
    it('la data ha i millisecondi e il suffisso Z', async () => {
      const res = await ctx.api().get(`/orders/${orders.D}`);

      assert.equal(res.body.createdAt, '2026-10-20T23:59:59.999Z');
    });

    it('ogni ordine ha id, createdAt, products e users e la risposta contiene total', async () => {
      const { body } = await ctx.api().get('/orders').query({ date: '2026-10-20' });

      assert.equal(typeof body.total, 'number');
      assert.ok(Array.isArray(body.orders));
      for (const order of body.orders) {
        assert.deepEqual(Object.keys(order).sort(), ['createdAt', 'id', 'products', 'users']);
      }
    });
  });

  describe('paginazione', () => {
    it('limit e offset controllano la pagina e total conta tutti gli ordini', async () => {
      const res = await ctx.api().get('/orders').query({ limit: 2, offset: 0 });

      assert.equal(res.status, 200);
      assert.equal(res.body.total, 6);
      assert.equal(res.body.orders.length, 2);
      // I primi due sono F ed E (i più recenti).
      const byId = Object.fromEntries(Object.entries(orders).map(([letter, id]) => [id, letter]));
      assert.equal(res.body.orders.map((o) => byId[o.id]).join(''), 'FE');
    });

    it('la seconda pagina mostra gli ordini successivi', async () => {
      const res = await ctx.api().get('/orders').query({ limit: 2, offset: 2 });

      assert.equal(res.body.total, 6);
      assert.equal(res.body.orders.length, 2);
      const byId = Object.fromEntries(Object.entries(orders).map(([letter, id]) => [id, letter]));
      assert.equal(res.body.orders.map((o) => byId[o.id]).join(''), 'DC');
    });

    it('offset oltre il totale dà un elenco vuoto ma il totale giusto', async () => {
      const res = await ctx.api().get('/orders').query({ limit: 20, offset: 100 });

      assert.equal(res.body.total, 6);
      assert.equal(res.body.orders.length, 0);
    });

    it('limit oltre 100 dà 400', async () => {
      const res = await ctx.api().get('/orders').query({ limit: 101 });

      assert.equal(res.status, 400);
    });

    it('paginazione combinata con filtri', async () => {
      const res = await ctx.api().get('/orders').query({ date: '2026-10-20', limit: 2, offset: 0 });

      assert.equal(res.body.total, 3);
      assert.equal(res.body.orders.length, 2);
    });
  });

  describe('richieste sbagliate', () => {
    for (const [description, query] of [
      ['data che non esiste', { date: '2026-02-30' }],
      ['formato della data sbagliato', { date: '20/10/2026' }],
      ['from dopo to', { from: '2026-10-21', to: '2026-10-20' }],
      ['date insieme a from', { date: '2026-10-20', from: '2026-10-01' }],
      ['productId non numerico', { productId: 'farro' }],
      ['parametro sconosciuto', { page: 1 }],
    ]) {
      it(`${description}: 400`, async () => {
        const res = await ctx.api().get('/orders').query(query);

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      });
    }
  });
});
