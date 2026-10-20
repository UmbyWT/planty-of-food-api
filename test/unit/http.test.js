'use strict';

// Prova il livello HTTP (percorsi, status, header, formato degli errori) con supertest.
// I service sono finti: qui non c'è database e non interessa cosa farebbero davvero,
// interessa cosa riceve il client e cosa arriva ai service.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const sinon = require('sinon');
const { createApp } = require('../../src/app');
const { notFound, conflict, unprocessable } = require('../../src/errors');
const { fakeService } = require('./helpers');

describe('API HTTP', () => {
  let productService;
  let userService;
  let orderService;
  let checkDatabase;
  let logger;
  let api;

  beforeEach(() => {
    productService = fakeService();
    userService = fakeService();
    orderService = fakeService();
    checkDatabase = sinon.stub().resolves();
    logger = { error: sinon.stub() };
    api = request(createApp({ productService, userService, orderService, checkDatabase, logger }));
  });

  describe('prodotti', () => {
    it('GET /products restituisce 200 e l\'elenco', async () => {
      productService.list.resolves([{ id: 1, name: 'Farro bio' }]);

      const res = await api.get('/products');

      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.deepEqual(res.body, [{ id: 1, name: 'Farro bio' }]);
    });

    it('POST /products risponde 201, Location e il prodotto creato', async () => {
      productService.create.resolves({ id: 7, name: 'Ceci secchi' });

      const res = await api.post('/products').send({ name: '  Ceci secchi ' });

      assert.equal(res.status, 201);
      assert.equal(res.headers.location, '/products/7');
      assert.deepEqual(res.body, { id: 7, name: 'Ceci secchi' });
      // Al service arriva il nome già ripulito e nient'altro.
      sinon.assert.calledOnceWithExactly(productService.create, { name: 'Ceci secchi' });
    });

    it('POST /products con un nome vuoto risponde 400 e non chiama il service', async () => {
      const res = await api.post('/products').send({ name: '' });

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(res.body.error.details, [
        { location: 'body', field: 'name', message: 'Il nome non può essere vuoto.' },
      ]);
      sinon.assert.notCalled(productService.create);
    });

    it('POST /products senza corpo risponde 400', async () => {
      const res = await api.post('/products');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      sinon.assert.notCalled(productService.create);
    });

    it('POST /products con un JSON rotto risponde 400 INVALID_JSON', async () => {
      const res = await api.post('/products').set('Content-Type', 'application/json').send('{"name": ');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_JSON');
    });

    it('POST /products con Content-Type text/plain risponde 415', async () => {
      const res = await api.post('/products').set('Content-Type', 'text/plain').send('name=Farro');

      assert.equal(res.status, 415);
      assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
      sinon.assert.notCalled(productService.create);
    });

    it('POST /products con un corpo oltre i 100 kB risponde 413', async () => {
      const res = await api.post('/products').send({ name: 'a'.repeat(200 * 1024) });

      assert.equal(res.status, 413);
      assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    });

    it('GET /products/:id restituisce il prodotto e passa l\'id come numero', async () => {
      productService.get.resolves({ id: 3, name: 'Lenticchie' });

      const res = await api.get('/products/3');

      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { id: 3, name: 'Lenticchie' });
      sinon.assert.calledOnceWithExactly(productService.get, 3);
    });

    it('GET /products/:id risponde 404 quando il service dice che non esiste', async () => {
      productService.get.rejects(notFound('Prodotto', 99));

      const res = await api.get('/products/99');

      assert.equal(res.status, 404);
      assert.deepEqual(res.body, {
        error: { code: 'NOT_FOUND', message: 'Prodotto con id 99 non trovato.' },
      });
    });

    for (const id of ['abc', '0', '-4', '1.5', '1e3', '99999999999']) {
      it(`GET /products/${id} risponde 400 senza arrivare al service`, async () => {
        const res = await api.get(`/products/${id}`);

        assert.equal(res.status, 400);
        assert.equal(res.body.error.details[0].location, 'params');
        sinon.assert.notCalled(productService.get);
      });
    }

    it('PUT /products/:id sostituisce e restituisce il prodotto', async () => {
      productService.update.resolves({ id: 3, name: 'Nuovo' });

      const res = await api.put('/products/3').send({ name: 'Nuovo' });

      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { id: 3, name: 'Nuovo' });
      sinon.assert.calledOnceWithExactly(productService.update, 3, { name: 'Nuovo' });
    });

    it('PUT /products/:id senza il nome risponde 400 (PUT vuole la risorsa intera)', async () => {
      const res = await api.put('/products/3').send({});

      assert.equal(res.status, 400);
      sinon.assert.notCalled(productService.update);
    });

    it('PATCH /products/:id con un oggetto vuoto risponde 400', async () => {
      const res = await api.patch('/products/3').send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.error.details[0].message, 'Indica almeno un campo da modificare.');
    });

    it('PATCH /products/:id con il nome modifica', async () => {
      productService.update.resolves({ id: 3, name: 'Solo nome' });

      const res = await api.patch('/products/3').send({ name: 'Solo nome' });

      assert.equal(res.status, 200);
      sinon.assert.calledOnceWithExactly(productService.update, 3, { name: 'Solo nome' });
    });

    it('DELETE /products/:id risponde 204 senza corpo', async () => {
      productService.remove.resolves();

      const res = await api.delete('/products/3');

      assert.equal(res.status, 204);
      assert.equal(res.text, '');
      sinon.assert.calledOnceWithExactly(productService.remove, 3);
    });

    it('DELETE /products/:id risponde 409 se il prodotto è in un ordine', async () => {
      productService.remove.rejects(conflict('Il prodotto compare in almeno un ordine.'));

      const res = await api.delete('/products/3');

      assert.equal(res.status, 409);
      assert.equal(res.body.error.code, 'CONFLICT');
    });
  });

  describe('metodi non consentiti', () => {
    it('DELETE /products risponde 405 con l\'header Allow', async () => {
      const res = await api.delete('/products');

      assert.equal(res.status, 405);
      assert.equal(res.headers.allow, 'GET, POST, HEAD, OPTIONS');
      assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
    });

    it('POST /orders/:id risponde 405', async () => {
      const res = await api.post('/orders/3').send({});

      assert.equal(res.status, 405);
      assert.equal(res.headers.allow, 'GET, PUT, PATCH, DELETE, HEAD, OPTIONS');
    });

    it('OPTIONS elenca i metodi e risponde 204', async () => {
      const res = await api.options('/users/5');

      assert.equal(res.status, 204);
      assert.equal(res.headers.allow, 'GET, PUT, PATCH, DELETE, HEAD, OPTIONS');
    });

    it('HEAD su un elenco funziona come GET ma senza corpo', async () => {
      userService.list.resolves([]);

      const res = await api.head('/users');

      assert.equal(res.status, 200);
      assert.equal(res.text, undefined);
    });
  });

  describe('utenti', () => {
    const body = { name: 'Giulia', surname: 'Bianchi', email: 'giulia@example.it' };

    it('POST /users normalizza l\'email prima di passarla al service', async () => {
      userService.create.resolves({ id: 1, ...body });

      const res = await api.post('/users').send({ ...body, email: '  GIULIA@Example.it ' });

      assert.equal(res.status, 201);
      assert.equal(res.headers.location, '/users/1');
      sinon.assert.calledOnceWithExactly(userService.create, body);
    });

    it('POST /users con email non valida risponde 400 e indica il campo', async () => {
      const res = await api.post('/users').send({ ...body, email: 'non-una-email' });

      assert.equal(res.status, 400);
      assert.deepEqual(res.body.error.details, [
        { location: 'body', field: 'email', message: 'Indirizzo email non valido.' },
      ]);
    });

    it('POST /users con email già usata risponde 409', async () => {
      userService.create.rejects(conflict('Esiste già un utente con questa email.'));

      const res = await api.post('/users').send(body);

      assert.equal(res.status, 409);
      assert.equal(res.body.error.message, 'Esiste già un utente con questa email.');
    });

    it('POST /users elenca tutti i campi sbagliati in una volta sola', async () => {
      const res = await api.post('/users').send({});

      assert.equal(res.status, 400);
      assert.deepEqual(
        res.body.error.details.map((detail) => detail.field),
        ['name', 'surname', 'email'],
      );
    });

    it('PATCH /users/:id accetta anche il solo cognome', async () => {
      userService.update.resolves({ id: 2, ...body, surname: 'Neri' });

      const res = await api.patch('/users/2').send({ surname: 'Neri' });

      assert.equal(res.status, 200);
      sinon.assert.calledOnceWithExactly(userService.update, 2, { surname: 'Neri' });
    });
  });

  describe('ordini', () => {
    const order = {
      id: 10,
      createdAt: '2026-10-20T09:30:00.000Z',
      products: [{ id: 1, name: 'Farro bio' }],
      users: [{ id: 2, name: 'Marco', surname: 'Verdi', email: 'marco@example.it' }],
    };

    it('POST /orders risponde 201 e Location', async () => {
      orderService.create.resolves(order);

      const res = await api.post('/orders').send({ productIds: [1], userIds: [2] });

      assert.equal(res.status, 201);
      assert.equal(res.headers.location, '/orders/10');
      assert.deepEqual(res.body, order);
      sinon.assert.calledOnceWithExactly(orderService.create, { productIds: [1], userIds: [2] });
    });

    it('POST /orders con prodotti inesistenti risponde 422 con il dettaglio', async () => {
      orderService.create.rejects(
        unprocessable('Alcuni riferimenti non esistono.', [
          { field: 'productIds', message: 'Prodotti inesistenti: 99.' },
        ]),
      );

      const res = await api.post('/orders').send({ productIds: [99], userIds: [2] });

      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'UNPROCESSABLE_ENTITY');
      assert.deepEqual(res.body.error.details, [
        { field: 'productIds', message: 'Prodotti inesistenti: 99.' },
      ]);
    });

    it('POST /orders con id ripetuti o elenco vuoto risponde 400', async () => {
      const repeated = await api.post('/orders').send({ productIds: [1, 1], userIds: [2] });
      const empty = await api.post('/orders').send({ productIds: [1], userIds: [] });

      assert.equal(repeated.status, 400);
      assert.equal(empty.status, 400);
      sinon.assert.notCalled(orderService.create);
    });

    it('POST /orders ignora i campi che il client non può impostare (createdAt, id)', async () => {
      orderService.create.resolves(order);

      await api
        .post('/orders')
        .send({ id: 1, createdAt: '1999-01-01T00:00:00Z', productIds: [1], userIds: [2] });

      sinon.assert.calledOnceWithExactly(orderService.create, { productIds: [1], userIds: [2] });
    });

    it('GET /orders senza filtri chiede tutto al service', async () => {
      orderService.list.resolves([order]);

      const res = await api.get('/orders');

      assert.equal(res.status, 200);
      assert.deepEqual(res.body, [order]);
      sinon.assert.calledOnceWithExactly(orderService.list, {});
    });

    it('GET /orders?date=... passa un intervallo di un giorno in UTC', async () => {
      orderService.list.resolves([]);

      await api.get('/orders?date=2026-10-20');

      const filters = orderService.list.firstCall.args[0];
      assert.deepEqual(filters, {
        createdFrom: new Date('2026-10-20T00:00:00.000Z'),
        createdBefore: new Date('2026-10-21T00:00:00.000Z'),
      });
    });

    it('GET /orders accetta productId ripetuto e separato da virgole, anche insieme', async () => {
      orderService.list.resolves([]);

      await api.get('/orders?productId=3&productId=5,8&from=2026-10-01');

      assert.deepEqual(orderService.list.firstCall.args[0], {
        createdFrom: new Date('2026-10-01T00:00:00.000Z'),
        productIds: [3, 5, 8],
      });
    });

    it('GET /orders con una data impossibile risponde 400 e non arriva al service', async () => {
      const res = await api.get('/orders?date=2026-02-30');

      assert.equal(res.status, 400);
      assert.deepEqual(res.body.error.details, [
        { location: 'query', field: 'date', message: 'La data indicata non esiste nel calendario.' },
      ]);
      sinon.assert.notCalled(orderService.list);
    });

    it('GET /orders con un parametro sconosciuto risponde 400 e lo nomina', async () => {
      const res = await api.get('/orders?page=2');

      assert.equal(res.status, 400);
      assert.equal(res.body.error.details[0].message, 'Parametro non riconosciuto: page.');
    });

    it('GET /orders con un tentativo di SQL injection in productId risponde 400', async () => {
      const res = await api.get('/orders').query({ productId: '1 OR 1=1' });

      assert.equal(res.status, 400);
      sinon.assert.notCalled(orderService.list);
    });

    it('GET /orders con date insieme a from risponde 400', async () => {
      const res = await api.get('/orders?date=2026-10-20&from=2026-10-01');

      assert.equal(res.status, 400);
    });

    it('PUT /orders/:id sostituisce prodotti e utenti', async () => {
      orderService.update.resolves(order);

      const res = await api.put('/orders/10').send({ productIds: [1], userIds: [2] });

      assert.equal(res.status, 200);
      sinon.assert.calledOnceWithExactly(orderService.update, 10, { productIds: [1], userIds: [2] });
    });

    it('PUT /orders/:id senza gli utenti risponde 400', async () => {
      const res = await api.put('/orders/10').send({ productIds: [1] });

      assert.equal(res.status, 400);
      sinon.assert.notCalled(orderService.update);
    });

    it('PATCH /orders/:id cambia solo i prodotti', async () => {
      orderService.update.resolves(order);

      const res = await api.patch('/orders/10').send({ productIds: [1, 2] });

      assert.equal(res.status, 200);
      sinon.assert.calledOnceWithExactly(orderService.update, 10, { productIds: [1, 2] });
    });

    it('DELETE /orders/:id risponde 204', async () => {
      orderService.remove.resolves();

      const res = await api.delete('/orders/10');

      assert.equal(res.status, 204);
    });

    it('DELETE /orders/:id risponde 404 se non esiste', async () => {
      orderService.remove.rejects(notFound('Ordine', 10));

      const res = await api.delete('/orders/10');

      assert.equal(res.status, 404);
    });
  });

  describe('errori generali', () => {
    it('un percorso che non esiste risponde 404 ROUTE_NOT_FOUND', async () => {
      const res = await api.get('/carrelli');

      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
      assert.equal(res.body.error.message, 'La risorsa GET /carrelli non esiste.');
    });

    it('un errore imprevisto risponde 500 generico e finisce nel log, non nella risposta', async () => {
      const failure = new Error('connect ECONNREFUSED 10.0.0.5:3306 password=segreta');
      productService.list.rejects(failure);

      const res = await api.get('/products');

      assert.equal(res.status, 500);
      assert.deepEqual(res.body, {
        error: { code: 'INTERNAL_ERROR', message: 'Errore interno del server.' },
      });
      assert.doesNotMatch(res.text, /ECONNREFUSED|segreta|10\.0\.0\.5/);
      sinon.assert.calledOnceWithExactly(logger.error, failure);
    });

    it('non dichiara con quale tecnologia è fatto (niente X-Powered-By)', async () => {
      productService.list.resolves([]);

      const res = await api.get('/products');

      assert.equal(res.headers['x-powered-by'], undefined);
    });

    it('anche gli errori sono sempre JSON', async () => {
      const res = await api.get('/non-esiste');

      assert.match(res.headers['content-type'], /application\/json/);
    });
  });

  describe('/health', () => {
    it('risponde 200 se il database risponde', async () => {
      const res = await api.get('/health');

      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { status: 'ok' });
    });

    it('risponde 503 se il database non risponde, senza rivelare perché', async () => {
      checkDatabase.rejects(new Error('Access denied for user pof@localhost'));

      const res = await api.get('/health');

      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { status: 'unavailable' });
      sinon.assert.calledOnce(logger.error);
    });
  });
});
