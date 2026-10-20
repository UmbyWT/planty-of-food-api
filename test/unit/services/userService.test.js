'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sinon = require('sinon');
const { createUserService } = require('../../../src/services/userService');
const { conflict } = require('../../../src/errors');
const { fakeRepository } = require('../helpers');

const giulia = { id: 1, name: 'Giulia', surname: 'Bianchi', email: 'giulia@example.it' };

describe('userService', () => {
  let userRepository;
  let service;

  beforeEach(() => {
    userRepository = fakeRepository();
    service = createUserService({ userRepository });
  });

  it('get risponde 404 se l\'utente non esiste', async () => {
    userRepository.findById.resolves(null);

    await assert.rejects(service.get(12), {
      status: 404,
      message: 'Utente con id 12 non trovato.',
    });
  });

  it('create passa i dati al repository così come li riceve', async () => {
    userRepository.create.resolves(giulia);
    const { id, ...data } = giulia;

    assert.deepEqual(await service.create(data), giulia);
    sinon.assert.calledOnceWithExactly(userRepository.create, data);
  });

  it('create lascia passare il conflitto per un\'email già usata', async () => {
    userRepository.create.rejects(conflict('Esiste già un utente con questa email.'));

    await assert.rejects(service.create({ name: 'A', surname: 'B', email: 'a@b.it' }), {
      status: 409,
    });
  });

  it('update con pochi campi (PATCH) conserva quelli non indicati', async () => {
    userRepository.findById.resolves(giulia);
    userRepository.update.resolves();

    const updated = await service.update(1, { surname: 'Neri' });

    assert.deepEqual(updated, { ...giulia, surname: 'Neri' });
    sinon.assert.calledOnceWithExactly(userRepository.update, 1, { ...giulia, surname: 'Neri' });
  });

  it('update risponde 404 e non scrive se l\'utente non esiste', async () => {
    userRepository.findById.resolves(null);

    await assert.rejects(service.update(1, { surname: 'Neri' }), { status: 404 });
    sinon.assert.notCalled(userRepository.update);
  });

  it('update lascia passare il conflitto se la nuova email è di un altro utente', async () => {
    userRepository.findById.resolves(giulia);
    userRepository.update.rejects(conflict('Esiste già un utente con questa email.'));

    await assert.rejects(service.update(1, { email: 'marco@example.it' }), { status: 409 });
  });

  it('remove risponde 404 se l\'utente non esiste', async () => {
    userRepository.remove.resolves(false);

    await assert.rejects(service.remove(1), { status: 404 });
  });
});
