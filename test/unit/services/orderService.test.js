'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sinon = require('sinon');
const { createOrderService } = require('../../../src/services/orderService');
const { fakeRepository } = require('../helpers');

const savedOrder = {
  id: 10,
  createdAt: new Date('2026-10-20T09:30:00.000Z'),
  products: [{ id: 1, name: 'Farro bio' }],
  users: [{ id: 2, name: 'Marco', surname: 'Verdi', email: 'marco@example.it' }],
};

describe('orderService', () => {
  let orderRepository;
  let productRepository;
  let userRepository;
  let service;

  beforeEach(() => {
    orderRepository = fakeRepository();
    productRepository = fakeRepository();
    userRepository = fakeRepository();
    // Di default tutti gli id esistono: i test che vogliono il contrario lo dicono.
    productRepository.findMissingIds.resolves([]);
    userRepository.findMissingIds.resolves([]);
    service = createOrderService({ orderRepository, productRepository, userRepository });
  });

  describe('list', () => {
    it('passa i filtri al repository senza toccarli', async () => {
      const filters = {
        createdFrom: new Date('2026-10-20T00:00:00.000Z'),
        createdBefore: new Date('2026-10-21T00:00:00.000Z'),
        productIds: [3, 5],
      };
      orderRepository.findAll.resolves([savedOrder]);

      assert.deepEqual(await service.list(filters), [savedOrder]);
      sinon.assert.calledOnceWithExactly(orderRepository.findAll, filters);
    });
  });

  describe('get', () => {
    it('risponde 404 se l\'ordine non esiste', async () => {
      orderRepository.findById.resolves(null);

      await assert.rejects(service.get(99), {
        status: 404,
        message: 'Ordine con id 99 non trovato.',
      });
    });
  });

  describe('create', () => {
    it('controlla i riferimenti, crea l\'ordine e lo rilegge completo, in questo ordine', async () => {
      orderRepository.create.resolves(10);
      orderRepository.findById.withArgs(10).resolves(savedOrder);

      const created = await service.create({ productIds: [1], userIds: [2] });

      assert.deepEqual(created, savedOrder);
      sinon.assert.calledOnceWithExactly(productRepository.findMissingIds, [1]);
      sinon.assert.calledOnceWithExactly(userRepository.findMissingIds, [2]);
      sinon.assert.calledOnceWithExactly(orderRepository.create, { productIds: [1], userIds: [2] });
      sinon.assert.callOrder(
        productRepository.findMissingIds,
        orderRepository.create,
        orderRepository.findById,
      );
    });

    it('risponde 404 e non un corpo vuoto se l\'ordine viene eliminato subito dopo la creazione', async () => {
      orderRepository.create.resolves(10);
      orderRepository.findById.withArgs(10).resolves(null);

      await assert.rejects(service.create({ productIds: [1], userIds: [2] }), { status: 404 });
    });

    it('risponde 422 e non scrive niente se un prodotto non esiste', async () => {
      productRepository.findMissingIds.resolves([99]);

      await assert.rejects(service.create({ productIds: [1, 99], userIds: [2] }), (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.code, 'UNPROCESSABLE_ENTITY');
        assert.deepEqual(error.details, [{ field: 'productIds', message: 'Prodotti inesistenti: 99.' }]);
        return true;
      });
      sinon.assert.notCalled(orderRepository.create);
    });

    it('elenca prodotti e utenti mancanti quando sbagliano entrambi', async () => {
      productRepository.findMissingIds.resolves([8, 9]);
      userRepository.findMissingIds.resolves([42]);

      await assert.rejects(service.create({ productIds: [8, 9], userIds: [42] }), (error) => {
        assert.deepEqual(error.details, [
          { field: 'productIds', message: 'Prodotti inesistenti: 8, 9.' },
          { field: 'userIds', message: 'Utenti inesistenti: 42.' },
        ]);
        return true;
      });
      sinon.assert.notCalled(orderRepository.create);
    });
  });

  describe('update', () => {
    it('risponde 404 prima di controllare i riferimenti se l\'ordine non esiste', async () => {
      orderRepository.findById.resolves(null);

      await assert.rejects(service.update(10, { productIds: [1] }), { status: 404 });
      sinon.assert.notCalled(productRepository.findMissingIds);
      sinon.assert.notCalled(orderRepository.update);
    });

    it('con un solo elenco (PATCH) controlla e aggiorna solo quello', async () => {
      orderRepository.findById.resolves(savedOrder);
      orderRepository.update.resolves(true);

      await service.update(10, { productIds: [1, 2] });

      sinon.assert.calledOnceWithExactly(productRepository.findMissingIds, [1, 2]);
      sinon.assert.notCalled(userRepository.findMissingIds);
      sinon.assert.calledOnceWithExactly(orderRepository.update, 10, { productIds: [1, 2] });
    });

    it('risponde 422 e non modifica l\'ordine se un utente non esiste', async () => {
      orderRepository.findById.resolves(savedOrder);
      userRepository.findMissingIds.resolves([7]);

      await assert.rejects(service.update(10, { userIds: [7] }), { status: 422 });
      sinon.assert.notCalled(orderRepository.update);
    });

    it('risponde 404 se l\'ordine sparisce tra la lettura e la scrittura', async () => {
      orderRepository.findById.resolves(savedOrder);
      orderRepository.update.resolves(false);

      await assert.rejects(service.update(10, { productIds: [1] }), { status: 404 });
    });

    it('risponde 404 e non un corpo vuoto se l\'ordine viene eliminato subito dopo la modifica', async () => {
      orderRepository.findById.onFirstCall().resolves(savedOrder).onSecondCall().resolves(null);
      orderRepository.update.resolves(true);

      await assert.rejects(service.update(10, { productIds: [2] }), { status: 404 });
    });

    it('restituisce l\'ordine riletto dopo la modifica', async () => {
      const afterUpdate = { ...savedOrder, products: [{ id: 2, name: 'Ceci secchi' }] };
      orderRepository.findById.onFirstCall().resolves(savedOrder).onSecondCall().resolves(afterUpdate);
      orderRepository.update.resolves(true);

      assert.deepEqual(await service.update(10, { productIds: [2] }), afterUpdate);
    });
  });

  describe('remove', () => {
    it('elimina l\'ordine', async () => {
      orderRepository.remove.resolves(true);

      assert.equal(await service.remove(10), undefined);
      sinon.assert.calledOnceWithExactly(orderRepository.remove, 10);
    });

    it('risponde 404 se l\'ordine non esiste', async () => {
      orderRepository.remove.resolves(false);

      await assert.rejects(service.remove(10), { status: 404 });
    });
  });
});
