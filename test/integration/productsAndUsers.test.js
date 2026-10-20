'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp, clearData, insertProducts, insertUsers, countRows } = require('./helpers');

describe('prodotti, con il database vero', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.stop());
  beforeEach(() => clearData(ctx.pool));

  it('ciclo completo: crea, legge, modifica, elimina', async () => {
    const created = await ctx.api().post('/products').send({ name: '  Farro bio ' });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { id: 1, name: 'Farro bio' });
    assert.equal(created.headers.location, '/products/1');

    const read = await ctx.api().get('/products/1');
    assert.deepEqual(read.body, { id: 1, name: 'Farro bio' });

    const replaced = await ctx.api().put('/products/1').send({ name: 'Farro decorticato' });
    assert.equal(replaced.status, 200);
    assert.deepEqual(replaced.body, { id: 1, name: 'Farro decorticato' });

    const patched = await ctx.api().patch('/products/1').send({ name: 'Farro perlato' });
    assert.deepEqual(patched.body, { id: 1, name: 'Farro perlato' });

    const removed = await ctx.api().delete('/products/1');
    assert.equal(removed.status, 204);

    assert.equal((await ctx.api().get('/products/1')).status, 404);
  });

  it('l\'elenco è in ordine di id e parte vuoto', async () => {
    assert.deepEqual((await ctx.api().get('/products')).body, []);

    await insertProducts(ctx.pool, ['Ceci', 'Lenticchie', 'Farro']);

    const { body } = await ctx.api().get('/products');
    assert.deepEqual(body.map((product) => product.name), ['Ceci', 'Lenticchie', 'Farro']);
    assert.deepEqual(body.map((product) => product.id), [1, 2, 3]);
  });

  it('due prodotti possono avere lo stesso nome (il nome non è un identificatore)', async () => {
    assert.equal((await ctx.api().post('/products').send({ name: 'Tofu' })).status, 201);
    assert.equal((await ctx.api().post('/products').send({ name: 'Tofu' })).status, 201);
    assert.equal(await countRows(ctx.pool, 'products'), 2);
  });

  it('modifica, lettura ed eliminazione di un id che non esiste danno 404', async () => {
    const id = 123456;
    assert.equal((await ctx.api().get(`/products/${id}`)).status, 404);
    assert.equal((await ctx.api().put(`/products/${id}`).send({ name: 'x' })).status, 404);
    assert.equal((await ctx.api().patch(`/products/${id}`).send({ name: 'x' })).status, 404);
    assert.equal((await ctx.api().delete(`/products/${id}`)).status, 404);
  });

  it('l\'id più grande possibile non provoca un errore 500', async () => {
    assert.equal((await ctx.api().get('/products/4294967295')).status, 404);
  });

  it('eliminare due volte lo stesso prodotto: 204 e poi 404', async () => {
    const [id] = await insertProducts(ctx.pool, ['Ceci']);

    assert.equal((await ctx.api().delete(`/products/${id}`)).status, 204);
    assert.equal((await ctx.api().delete(`/products/${id}`)).status, 404);
  });

  it('un nome con emoji e accenti torna uguale', async () => {
    const name = 'Crème de soja 🌱 (bio)';
    const { body } = await ctx.api().post('/products').send({ name });

    assert.equal((await ctx.api().get(`/products/${body.id}`)).body.name, name);
  });

  it('un nome di 150 caratteri passa, uno di 151 no', async () => {
    assert.equal((await ctx.api().post('/products').send({ name: 'a'.repeat(150) })).status, 201);
    assert.equal((await ctx.api().post('/products').send({ name: 'a'.repeat(151) })).status, 400);
  });
});

describe('utenti, con il database vero', () => {
  let ctx;
  const giulia = { name: 'Giulia', surname: 'Bianchi', email: 'giulia@example.it' };

  before(async () => {
    ctx = await startTestApp();
  });
  after(() => ctx.stop());
  beforeEach(() => clearData(ctx.pool));

  it('ciclo completo: crea, legge, modifica, elimina', async () => {
    const created = await ctx.api().post('/users').send(giulia);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { id: 1, ...giulia });
    assert.equal(created.headers.location, '/users/1');

    assert.deepEqual((await ctx.api().get('/users/1')).body, { id: 1, ...giulia });

    const replaced = await ctx.api().put('/users/1').send({ name: 'Giulia', surname: 'Neri', email: 'giulia.neri@example.it' });
    assert.deepEqual(replaced.body, { id: 1, name: 'Giulia', surname: 'Neri', email: 'giulia.neri@example.it' });

    const patched = await ctx.api().patch('/users/1').send({ surname: 'Rossi' });
    assert.deepEqual(patched.body, { id: 1, name: 'Giulia', surname: 'Rossi', email: 'giulia.neri@example.it' });

    assert.equal((await ctx.api().delete('/users/1')).status, 204);
    assert.equal((await ctx.api().get('/users/1')).status, 404);
  });

  it('l\'email viene salvata in minuscolo e senza spazi', async () => {
    const { body } = await ctx.api().post('/users').send({ ...giulia, email: '  Giulia@Example.IT ' });

    assert.equal(body.email, 'giulia@example.it');
    const [[row]] = await ctx.pool.execute('SELECT email FROM users WHERE id = ?', [body.id]);
    assert.equal(row.email, 'giulia@example.it');
  });

  it('un\'email già usata risponde 409, anche con maiuscole diverse', async () => {
    await ctx.api().post('/users').send(giulia);

    const same = await ctx.api().post('/users').send({ ...giulia, name: 'Altra' });
    const upper = await ctx.api().post('/users').send({ ...giulia, email: 'GIULIA@EXAMPLE.IT' });

    assert.equal(same.status, 409);
    assert.equal(upper.status, 409);
    assert.equal(same.body.error.message, 'Esiste già un utente con questa email.');
    assert.equal(await countRows(ctx.pool, 'users'), 1);
  });

  it('PUT con l\'email di un altro utente risponde 409 e non cambia niente', async () => {
    await ctx.api().post('/users').send(giulia);
    await ctx.api().post('/users').send({ name: 'Marco', surname: 'Verdi', email: 'marco@example.it' });

    const res = await ctx.api().put('/users/2').send({ ...giulia, name: 'Marco' });

    assert.equal(res.status, 409);
    assert.equal((await ctx.api().get('/users/2')).body.email, 'marco@example.it');
  });

  it('PATCH con la propria email non è un conflitto', async () => {
    await ctx.api().post('/users').send(giulia);

    const res = await ctx.api().patch('/users/1').send({ email: giulia.email, name: 'Giulietta' });

    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Giulietta');
  });

  it('un utente che non esiste dà 404 su lettura, modifica ed eliminazione', async () => {
    assert.equal((await ctx.api().get('/users/777')).status, 404);
    assert.equal((await ctx.api().put('/users/777').send(giulia)).status, 404);
    assert.equal((await ctx.api().patch('/users/777').send({ name: 'x' })).status, 404);
    assert.equal((await ctx.api().delete('/users/777')).status, 404);
  });

  it('l\'elenco restituisce gli utenti in ordine di id', async () => {
    await insertUsers(ctx.pool, 3);

    const { body } = await ctx.api().get('/users');
    assert.deepEqual(body.map((user) => user.email), [
      'utente1@example.it',
      'utente2@example.it',
      'utente3@example.it',
    ]);
  });
});
