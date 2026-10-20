'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../src/config');

describe('loadConfig', () => {
  it('usa i valori di default per host, porte e password', () => {
    assert.deepEqual(loadConfig({ DB_USER: 'pof', DB_NAME: 'pof' }), {
      port: 3000,
      db: { host: '127.0.0.1', port: 3306, user: 'pof', password: '', database: 'pof' },
    });
  });

  it('legge tutto quello che gli viene passato', () => {
    const config = loadConfig({
      PORT: '8080',
      DB_HOST: 'db',
      DB_PORT: '3307',
      DB_USER: 'utente',
      DB_PASSWORD: 'segreta',
      DB_NAME: 'negozio',
    });

    assert.deepEqual(config, {
      port: 8080,
      db: { host: 'db', port: 3307, user: 'utente', password: 'segreta', database: 'negozio' },
    });
  });

  it('elenca le variabili obbligatorie che mancano', () => {
    assert.throws(() => loadConfig({}), /DB_USER, DB_NAME/);
    assert.throws(() => loadConfig({ DB_USER: 'pof' }), /DB_NAME/);
  });

  it('non usa process.env se gli passo un oggetto', () => {
    const before = process.env.DB_USER;
    process.env.DB_USER = 'dal-processo';
    try {
      assert.throws(() => loadConfig({ DB_NAME: 'pof' }), /DB_USER/);
    } finally {
      if (before === undefined) delete process.env.DB_USER;
      else process.env.DB_USER = before;
    }
  });

  for (const port of ['0', '65536', '-1', 'abc', '30.5', '3000abc']) {
    it(`rifiuta PORT="${port}"`, () => {
      assert.throws(() => loadConfig({ DB_USER: 'u', DB_NAME: 'n', PORT: port }), /PORT/);
    });
  }

  it('rifiuta una DB_PORT sbagliata e la nomina nell\'errore', () => {
    assert.throws(() => loadConfig({ DB_USER: 'u', DB_NAME: 'n', DB_PORT: 'x' }), /DB_PORT/);
  });

  it('una PORT vuota vale come non indicata', () => {
    assert.equal(loadConfig({ DB_USER: 'u', DB_NAME: 'n', PORT: '' }).port, 3000);
  });
});
