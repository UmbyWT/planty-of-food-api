'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sinon = require('sinon');
const { createProductService } = require('../../../src/services/productService');
const { conflict } = require('../../../src/errors');
const { fakeRepository } = require('../helpers');

describe('productService', () => {
  let productRepository;
  let service;

  beforeEach(() => {
    productRepository = fakeRepository();
    service = createProductService({ productRepository });
  });

  describe('list', () => {
    it('restituisce i prodotti letti dal repository', async () => {
      const products = [{ id: 1, name: 'Farro bio' }, { id: 2, name: 'Ceci secchi' }];
      productRepository.findAll.resolves(products);

      assert.deepEqual(await service.list(), products);
      sinon.assert.calledOnce(productRepository.findAll);
    });
  });

  describe('get', () => {
    it('restituisce il prodotto se esiste', async () => {
      productRepository.findById.withArgs(4).resolves({ id: 4, name: 'Lenticchie' });

      assert.deepEqual(await service.get(4), { id: 4, name: 'Lenticchie' });
    });

    it('risponde 404 se il prodotto non esiste', async () => {
      productRepository.findById.resolves(null);

      await assert.rejects(service.get(7), {
        status: 404,
        code: 'NOT_FOUND',
        message: 'Prodotto con id 7 non trovato.',
      });
      sinon.assert.calledOnceWithExactly(productRepository.findById, 7);
    });
  });

  describe('create', () => {
    it('passa i dati al repository e restituisce il prodotto creato', async () => {
      productRepository.create.resolves({ id: 9, name: 'Farro bio' });

      const created = await service.create({ name: 'Farro bio' });

      assert.deepEqual(created, { id: 9, name: 'Farro bio' });
      sinon.assert.calledOnceWithExactly(productRepository.create, { name: 'Farro bio' });
    });
  });

  describe('update', () => {
    it('sovrappone le modifiche al prodotto com\'è adesso e lo salva', async () => {
      productRepository.findById.resolves({ id: 3, name: 'Vecchio nome' });
      productRepository.update.resolves();

      const updated = await service.update(3, { name: 'Nuovo nome' });

      assert.deepEqual(updated, { id: 3, name: 'Nuovo nome' });
      sinon.assert.calledOnceWithExactly(productRepository.update, 3, { id: 3, name: 'Nuovo nome' });
    });

    it('risponde 404 e non scrive niente se il prodotto non esiste', async () => {
      productRepository.findById.resolves(null);

      await assert.rejects(service.update(3, { name: 'Nuovo' }), { status: 404 });
      sinon.assert.notCalled(productRepository.update);
    });
  });

  describe('remove', () => {
    it('elimina il prodotto senza restituire niente', async () => {
      productRepository.remove.resolves(true);

      assert.equal(await service.remove(5), undefined);
      sinon.assert.calledOnceWithExactly(productRepository.remove, 5);
    });

    it('risponde 404 se non c\'era niente da eliminare', async () => {
      productRepository.remove.resolves(false);

      await assert.rejects(service.remove(5), { status: 404, code: 'NOT_FOUND' });
    });

    it('lascia passare il conflitto quando il prodotto è dentro un ordine', async () => {
      productRepository.remove.rejects(conflict('Il prodotto compare in almeno un ordine.'));

      await assert.rejects(service.remove(5), { status: 409, code: 'CONFLICT' });
    });
  });
});
