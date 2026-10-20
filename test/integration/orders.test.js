'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createOrderRepository } = require('../../src/repositories/orderRepository');
const {
  startTestApp,
  clearData,
  insertProducts,
  insertUsers,
  insertOrderAt,
  countRows,
} = require('./helpers');

describe('ordini, con il database vero', () => {
  let ctx;
  let productIds;
  let userIds;

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.stop());
  beforeEach(async () => {
    await clearData(ctx.pool);
    productIds = await insertProducts(ctx.pool, ['Farro bio', 'Ceci secchi', 'Lenticchie rosse']);
    userIds = await insertUsers(ctx.pool, 3);
  });

  const productsOf = (order) => order.products.map((product) => product.id);
  const usersOf = (order) => order.users.map((user) => user.id);

  describe('creazione', () => {
    it('salva l\'ordine con prodotti e utenti e restituisce tutto, dati compresi', async () => {
      const res = await ctx.api().post('/orders').send({
        productIds: [productIds[1], productIds[0]],
        userIds: [userIds[0], userIds[2]],
      });

      assert.equal(res.status, 201);
      assert.equal(res.headers.location, `/orders/${res.body.id}`);
      // Prodotti e utenti tornano in ordine di id, non nell'ordine in cui sono stati inviati.
      assert.deepEqual(res.body.products, [
        { id: productIds[0], name: 'Farro bio' },
        { id: productIds[1], name: 'Ceci secchi' },
      ]);
      assert.deepEqual(res.body.users, [
        { id: userIds[0], name: 'Nome1', surname: 'Cognome1', email: 'utente1@example.it' },
        { id: userIds[2], name: 'Nome3', surname: 'Cognome3', email: 'utente3@example.it' },
      ]);
      assert.equal(await countRows(ctx.pool, 'order_products'), 2);
      assert.equal(await countRows(ctx.pool, 'order_users'), 2);
    });

    it('la data di inserimento la decide il server ed è l\'ora UTC di adesso', async () => {
      const before = Date.now();
      const res = await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userIds[0]] });
      const after = Date.now();

      assert.match(res.body.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const createdAt = new Date(res.body.createdAt).getTime();
      // Il database arrotonda ai millisecondi: concedo uno scarto di un secondo per lato.
      assert.ok(createdAt >= before - 1000 && createdAt <= after + 1000, `createdAt ${res.body.createdAt} fuori intervallo`);
    });

    it('il client non può scegliere la data né l\'id', async () => {
      const res = await ctx
        .api()
        .post('/orders')
        .send({ id: 500, createdAt: '1999-01-01T00:00:00Z', productIds: [productIds[0]], userIds: [userIds[0]] });

      assert.equal(res.status, 201);
      assert.notEqual(res.body.id, 500);
      assert.ok(new Date(res.body.createdAt).getFullYear() >= 2026);
    });

    it('GET /orders/:id restituisce lo stesso ordine appena creato', async () => {
      const created = await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userIds[0]] });

      const read = await ctx.api().get(`/orders/${created.body.id}`);

      assert.equal(read.status, 200);
      assert.deepEqual(read.body, created.body);
    });

    it('un prodotto che non esiste: 422, con l\'id nel messaggio, e non nasce nessun ordine', async () => {
      const res = await ctx.api().post('/orders').send({ productIds: [productIds[0], 99999], userIds: [userIds[0]] });

      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.details, [{ field: 'productIds', message: 'Prodotti inesistenti: 99999.' }]);
      assert.equal(await countRows(ctx.pool, 'orders'), 0);
      assert.equal(await countRows(ctx.pool, 'order_products'), 0);
    });

    it('prodotti e utenti inesistenti insieme: 422 con entrambi gli errori', async () => {
      const res = await ctx.api().post('/orders').send({ productIds: [88888], userIds: [77777] });

      assert.equal(res.status, 422);
      assert.deepEqual(res.body.error.details, [
        { field: 'productIds', message: 'Prodotti inesistenti: 88888.' },
        { field: 'userIds', message: 'Utenti inesistenti: 77777.' },
      ]);
    });

    it('un ordine può avere più utenti (il gruppo di acquisto) e più prodotti', async () => {
      const res = await ctx.api().post('/orders').send({ productIds, userIds });

      assert.equal(res.status, 201);
      assert.deepEqual(productsOf(res.body), productIds);
      assert.deepEqual(usersOf(res.body), userIds);
    });

    it('lo stesso prodotto può stare in ordini diversi', async () => {
      const first = await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userIds[0]] });
      const second = await ctx.api().post('/orders').send({ productIds: [productIds[0]], userIds: [userIds[1]] });

      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.notEqual(first.body.id, second.body.id);
    });

    it('100 prodotti in un ordine sono il massimo accettato', async () => {
      const names = Array.from({ length: 100 }, (_, i) => `Prodotto ${i + 1}`);
      const many = await insertProducts(ctx.pool, names);

      const res = await ctx.api().post('/orders').send({ productIds: many, userIds: [userIds[0]] });

      assert.equal(res.status, 201);
      assert.equal(res.body.products.length, 100);
    });

    it('un id esistente ma ripetuto nello stesso ordine è un errore 400, non un errore del database', async () => {
      const res = await ctx.api().post('/orders').send({ productIds: [productIds[0], productIds[0]], userIds: [userIds[0]] });

      assert.equal(res.status, 400);
      assert.equal(await countRows(ctx.pool, 'orders'), 0);
    });
  });

  describe('transazioni', () => {
    // Questi test saltano il controllo del service e chiamano direttamente il repository:
    // simulano il caso in cui un id sparisce tra il controllo e la scrittura.
    it('se un riferimento salta a metà scrittura, non resta niente dell\'ordine', async () => {
      const repository = createOrderRepository(ctx.pool);

      await assert.rejects(repository.create({ productIds: [productIds[0]], userIds: [userIds[0], 99999] }), {
        status: 422,
        code: 'UNPROCESSABLE_ENTITY',
      });

      assert.equal(await countRows(ctx.pool, 'orders'), 0);
      assert.equal(await countRows(ctx.pool, 'order_products'), 0);
      assert.equal(await countRows(ctx.pool, 'order_users'), 0);
    });

    it('se una modifica fallisce a metà, l\'ordine resta com\'era', async () => {
      const repository = createOrderRepository(ctx.pool);
      const orderId = await insertOrderAt(ctx.pool, '2026-10-20T10:00:00.000Z', {
        productIds: [productIds[0], productIds[1]],
        userIds: [userIds[0]],
      });

      // I prodotti vengono prima cancellati e poi reinseriti: la riga con l'id inesistente
      // fa fallire l'inserimento quando la cancellazione è già avvenuta.
      await assert.rejects(repository.update(orderId, { productIds: [productIds[2], 99999] }), { status: 422 });

      const order = await repository.findById(orderId);
      assert.deepEqual(productsOf(order), [productIds[0], productIds[1]]);
      assert.deepEqual(usersOf(order), [userIds[0]]);
    });
  });

  describe('modifica', () => {
    let orderId;

    beforeEach(async () => {
      const res = await ctx.api().post('/orders').send({
        productIds: [productIds[0]],
        userIds: [userIds[0]],
      });
      orderId = res.body.id;
    });

    it('PUT sostituisce sia i prodotti sia gli utenti', async () => {
      const res = await ctx.api().put(`/orders/${orderId}`).send({
        productIds: [productIds[1], productIds[2]],
        userIds: [userIds[1]],
      });

      assert.equal(res.status, 200);
      assert.deepEqual(productsOf(res.body), [productIds[1], productIds[2]]);
      assert.deepEqual(usersOf(res.body), [userIds[1]]);
      assert.equal(await countRows(ctx.pool, 'order_products', 'order_id = ?', [orderId]), 2);
    });

    it('PATCH con i soli prodotti lascia gli utenti dove sono', async () => {
      const res = await ctx.api().patch(`/orders/${orderId}`).send({ productIds: [productIds[2]] });

      assert.equal(res.status, 200);
      assert.deepEqual(productsOf(res.body), [productIds[2]]);
      assert.deepEqual(usersOf(res.body), [userIds[0]]);
    });

    it('PATCH con i soli utenti lascia i prodotti dove sono', async () => {
      const res = await ctx.api().patch(`/orders/${orderId}`).send({ userIds: [userIds[1], userIds[2]] });

      assert.deepEqual(productsOf(res.body), [productIds[0]]);
      assert.deepEqual(usersOf(res.body), [userIds[1], userIds[2]]);
    });

    it('la modifica non cambia la data dell\'ordine', async () => {
      const before = (await ctx.api().get(`/orders/${orderId}`)).body.createdAt;

      await ctx.api().patch(`/orders/${orderId}`).send({ productIds: [productIds[1]] });

      assert.equal((await ctx.api().get(`/orders/${orderId}`)).body.createdAt, before);
    });

    it('con un prodotto inesistente risponde 422 e l\'ordine non cambia', async () => {
      const res = await ctx.api().put(`/orders/${orderId}`).send({ productIds: [99999], userIds: [userIds[1]] });

      assert.equal(res.status, 422);
      const order = (await ctx.api().get(`/orders/${orderId}`)).body;
      assert.deepEqual(productsOf(order), [productIds[0]]);
      assert.deepEqual(usersOf(order), [userIds[0]]);
    });

    it('un ordine che non esiste dà 404 su PUT, PATCH e DELETE', async () => {
      const body = { productIds: [productIds[0]], userIds: [userIds[0]] };

      assert.equal((await ctx.api().put('/orders/424242').send(body)).status, 404);
      assert.equal((await ctx.api().patch('/orders/424242').send({ productIds: [productIds[0]] })).status, 404);
      assert.equal((await ctx.api().delete('/orders/424242')).status, 404);
      assert.equal((await ctx.api().get('/orders/424242')).status, 404);
    });

    it('con un ordine inesistente il 404 vince sul 422 dei riferimenti sbagliati', async () => {
      const res = await ctx.api().put('/orders/424242').send({ productIds: [99999], userIds: [userIds[0]] });

      assert.equal(res.status, 404);
    });
  });

  describe('eliminazione e vincoli', () => {
    let orderId;

    beforeEach(async () => {
      const res = await ctx.api().post('/orders').send({
        productIds: [productIds[0], productIds[1]],
        userIds: [userIds[0], userIds[1]],
      });
      orderId = res.body.id;
    });

    it('eliminare un ordine toglie le sue righe ma non prodotti e utenti', async () => {
      const res = await ctx.api().delete(`/orders/${orderId}`);

      assert.equal(res.status, 204);
      assert.equal(await countRows(ctx.pool, 'orders'), 0);
      assert.equal(await countRows(ctx.pool, 'order_products'), 0);
      assert.equal(await countRows(ctx.pool, 'order_users'), 0);
      assert.equal(await countRows(ctx.pool, 'products'), 3);
      assert.equal(await countRows(ctx.pool, 'users'), 3);
    });

    it('un prodotto dentro un ordine non si elimina: 409 e il prodotto resta', async () => {
      const res = await ctx.api().delete(`/products/${productIds[0]}`);

      assert.equal(res.status, 409);
      assert.equal(res.body.error.message, 'Il prodotto compare in almeno un ordine e non può essere eliminato.');
      assert.equal((await ctx.api().get(`/products/${productIds[0]}`)).status, 200);
    });

    it('un utente dentro un ordine non si elimina: 409 e l\'utente resta', async () => {
      const res = await ctx.api().delete(`/users/${userIds[0]}`);

      assert.equal(res.status, 409);
      assert.equal((await ctx.api().get(`/users/${userIds[0]}`)).status, 200);
    });

    it('un prodotto o un utente fuori da ogni ordine si elimina senza problemi', async () => {
      assert.equal((await ctx.api().delete(`/products/${productIds[2]}`)).status, 204);
      assert.equal((await ctx.api().delete(`/users/${userIds[2]}`)).status, 204);
    });

    it('tolto l\'ordine, il prodotto torna eliminabile', async () => {
      await ctx.api().delete(`/orders/${orderId}`);

      assert.equal((await ctx.api().delete(`/products/${productIds[0]}`)).status, 204);
    });

    it('anche togliere un prodotto da un ordine lo libera', async () => {
      await ctx.api().patch(`/orders/${orderId}`).send({ productIds: [productIds[1]] });

      assert.equal((await ctx.api().delete(`/products/${productIds[0]}`)).status, 204);
      assert.equal((await ctx.api().delete(`/products/${productIds[1]}`)).status, 409);
    });
  });
});
