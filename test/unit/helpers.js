'use strict';

const sinon = require('sinon');

// Un oggetto con uno stub Sinon per ciascun metodo indicato: serve a fingere un repository
// o un service senza toccare né database né rete.
function fakeOf(methods) {
  return Object.fromEntries(methods.map((method) => [method, sinon.stub()]));
}

const REPOSITORY_METHODS = ['findAll', 'findById', 'create', 'update', 'remove', 'findMissingIds'];
const SERVICE_METHODS = ['list', 'get', 'create', 'update', 'remove'];

const fakeRepository = (methods = REPOSITORY_METHODS) => fakeOf(methods);
const fakeService = () => fakeOf(SERVICE_METHODS);

module.exports = { fakeRepository, fakeService };
