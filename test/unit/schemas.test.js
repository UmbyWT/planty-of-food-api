'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { idParams } = require('../../src/schemas/common');
const { productBody, productPatchBody } = require('../../src/schemas/product');
const { userBody, userPatchBody } = require('../../src/schemas/user');
const { orderBody, orderPatchBody, orderQuery } = require('../../src/schemas/order');

// Messaggi del primo errore trovato: basta a capire perché un dato viene rifiutato.
const firstMessage = (result) => result.error.issues[0].message;

describe('schema degli id nell\'URL', () => {
  it('accetta un intero positivo e lo trasforma in numero', () => {
    assert.deepEqual(idParams.parse({ id: '42' }), { id: 42 });
  });

  for (const bad of ['0', '-1', '1.5', '1e3', '', ' 7', '007', 'abc', '1; DROP TABLE orders', '4294967296']) {
    it(`rifiuta "${bad}"`, () => {
      assert.equal(idParams.safeParse({ id: bad }).success, false);
    });
  }

  it('accetta il massimo di una colonna INT UNSIGNED', () => {
    assert.deepEqual(idParams.parse({ id: '4294967295' }), { id: 4294967295 });
  });
});

describe('schema del prodotto', () => {
  it('toglie gli spazi ai lati del nome', () => {
    assert.deepEqual(productBody.parse({ name: '  Farro bio  ' }), { name: 'Farro bio' });
  });

  it('scarta i campi sconosciuti, così non si può scrivere un id a mano', () => {
    assert.deepEqual(productBody.parse({ id: 999, name: 'Farro', price: 3 }), { name: 'Farro' });
  });

  it('rifiuta un nome mancante, vuoto o fatto di soli spazi', () => {
    assert.equal(firstMessage(productBody.safeParse({})), 'Il nome è obbligatorio.');
    assert.equal(firstMessage(productBody.safeParse({ name: '' })), 'Il nome non può essere vuoto.');
    assert.equal(firstMessage(productBody.safeParse({ name: '   ' })), 'Il nome non può essere vuoto.');
  });

  it('rifiuta un nome che non è un testo', () => {
    assert.equal(firstMessage(productBody.safeParse({ name: 12 })), 'Il nome deve essere un testo.');
    assert.equal(productBody.safeParse({ name: ['a'] }).success, false);
    assert.equal(productBody.safeParse({ name: null }).success, false);
  });

  it('rifiuta un nome oltre i 150 caratteri e accetta quello di 150 esatti', () => {
    assert.equal(productBody.safeParse({ name: 'a'.repeat(150) }).success, true);
    assert.equal(
      firstMessage(productBody.safeParse({ name: 'a'.repeat(151) })),
      'Il nome può avere al massimo 150 caratteri.',
    );
  });

  it('rifiuta un corpo che non è un oggetto', () => {
    for (const body of [null, 'testo', 5, [{ name: 'a' }]]) {
      assert.equal(productBody.safeParse(body).success, false);
    }
  });

  it('con PATCH rifiuta un oggetto senza campi', () => {
    const result = productPatchBody.safeParse({});
    assert.equal(result.success, false);
    assert.equal(firstMessage(result), 'Indica almeno un campo da modificare.');
  });

  it('con PATCH rifiuta anche un oggetto che contiene solo campi sconosciuti', () => {
    assert.equal(productPatchBody.safeParse({ colore: 'verde' }).success, false);
  });
});

describe('schema dell\'utente', () => {
  const valid = { name: 'Giulia', surname: 'Bianchi', email: 'giulia@example.it' };

  it('accetta un utente completo', () => {
    assert.deepEqual(userBody.parse(valid), valid);
  });

  it('porta l\'email in minuscolo e senza spazi ai lati', () => {
    assert.equal(userBody.parse({ ...valid, email: '  Giulia.Bianchi@Example.IT ' }).email, 'giulia.bianchi@example.it');
  });

  it('segnala quali campi mancano', () => {
    const result = userBody.safeParse({});
    assert.deepEqual(
      result.error.issues.map((issue) => [issue.path[0], issue.message]),
      [
        ['name', 'Il nome è obbligatorio.'],
        ['surname', 'Il cognome è obbligatorio.'],
        ['email', "L'email è obbligatoria."],
      ],
    );
  });

  for (const email of ['giulia', 'giulia@', '@example.it', 'giulia@@example.it', 'gi ulia@example.it', "a'; DROP TABLE users;--@x.it"]) {
    it(`rifiuta l'email "${email}"`, () => {
      assert.equal(firstMessage(userBody.safeParse({ ...valid, email })), 'Indirizzo email non valido.');
    });
  }

  it('rifiuta un\'email più lunga di 254 caratteri', () => {
    const email = `${'a'.repeat(250)}@example.it`;
    assert.equal(
      firstMessage(userBody.safeParse({ ...valid, email })),
      "L'email può avere al massimo 254 caratteri.",
    );
  });

  it('con PATCH accetta un solo campo e normalizza l\'email se c\'è', () => {
    assert.deepEqual(userPatchBody.parse({ surname: 'Neri' }), { surname: 'Neri' });
    assert.deepEqual(userPatchBody.parse({ email: ' NUOVA@Example.it' }), { email: 'nuova@example.it' });
  });

  it('con PATCH rifiuta un oggetto vuoto', () => {
    assert.equal(userPatchBody.safeParse({}).success, false);
  });
});

describe('schema del corpo di un ordine', () => {
  it('accetta due elenchi di id', () => {
    assert.deepEqual(orderBody.parse({ productIds: [1, 2], userIds: [3] }), {
      productIds: [1, 2],
      userIds: [3],
    });
  });

  it('rifiuta un elenco mancante e dice quale', () => {
    assert.equal(firstMessage(orderBody.safeParse({ userIds: [1] })), 'Il campo productIds è obbligatorio.');
    assert.equal(firstMessage(orderBody.safeParse({ productIds: [1] })), 'Il campo userIds è obbligatorio.');
  });

  it('rifiuta un elenco vuoto', () => {
    assert.equal(
      firstMessage(orderBody.safeParse({ productIds: [], userIds: [1] })),
      'Il campo productIds deve contenere almeno un id.',
    );
  });

  it('rifiuta id ripetuti', () => {
    assert.equal(
      firstMessage(orderBody.safeParse({ productIds: [1, 1], userIds: [2] })),
      'Il campo productIds contiene id ripetuti.',
    );
  });

  it('rifiuta più di 100 id', () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    assert.equal(
      firstMessage(orderBody.safeParse({ productIds: ids, userIds: [1] })),
      'Il campo productIds può contenere al massimo 100 id.',
    );
    assert.equal(orderBody.safeParse({ productIds: ids.slice(0, 100), userIds: [1] }).success, true);
  });

  it('rifiuta id che non sono interi positivi', () => {
    for (const bad of [0, -3, 1.5, '4', null, true, 4294967296]) {
      assert.equal(
        orderBody.safeParse({ productIds: [bad], userIds: [1] }).success,
        false,
        `doveva rifiutare ${JSON.stringify(bad)}`,
      );
    }
  });

  it('rifiuta un elenco che non è un array', () => {
    assert.equal(
      firstMessage(orderBody.safeParse({ productIds: 3, userIds: [1] })),
      'Il campo productIds deve essere un elenco di id.',
    );
  });

  it('con PATCH accetta un solo elenco, ma non nessuno', () => {
    assert.deepEqual(orderPatchBody.parse({ userIds: [4] }), { userIds: [4] });
    assert.equal(orderPatchBody.safeParse({}).success, false);
  });
});

describe('schema dei filtri di GET /orders', () => {
  const parse = (query) => orderQuery.safeParse(query);
  const utc = (iso) => new Date(`${iso}Z`);
  const pagination = { limit: 20, offset: 0 };

  it('senza parametri non produce nessun filtro', () => {
    assert.deepEqual(parse({}).data, { ...pagination });
  });

  it('date copre un solo giorno: da mezzanotte a mezzanotte (UTC)', () => {
    assert.deepEqual(parse({ date: '2026-10-20' }).data, {
      createdFrom: utc('2026-10-20T00:00:00.000'),
      createdBefore: utc('2026-10-21T00:00:00.000'),
      ...pagination,
    });
  });

  it('to include l\'intero giorno indicato', () => {
    assert.deepEqual(parse({ to: '2026-10-20' }).data, {
      createdBefore: utc('2026-10-21T00:00:00.000'),
      ...pagination,
    });
  });

  it('from da solo fissa solo l\'inizio', () => {
    assert.deepEqual(parse({ from: '2026-10-01' }).data, {
      createdFrom: utc('2026-10-01T00:00:00.000'),
      ...pagination,
    });
  });

  it('from e to insieme danno un intervallo', () => {
    assert.deepEqual(parse({ from: '2026-10-01', to: '2026-10-31' }).data, {
      createdFrom: utc('2026-10-01T00:00:00.000'),
      createdBefore: utc('2026-11-01T00:00:00.000'),
      ...pagination,
    });
  });

  it('from uguale a to è valido ed è un giorno solo', () => {
    assert.deepEqual(parse({ from: '2026-10-20', to: '2026-10-20' }).data, {
      createdFrom: utc('2026-10-20T00:00:00.000'),
      createdBefore: utc('2026-10-21T00:00:00.000'),
      ...pagination,
    });
  });

  it('l\'ultimo giorno dell\'anno e di febbraio bisestile passano correttamente al successivo', () => {
    assert.deepEqual(parse({ date: '2026-12-31' }).data.createdBefore, utc('2027-01-01T00:00:00.000'));
    assert.deepEqual(parse({ date: '2028-02-29' }).data.createdBefore, utc('2028-03-01T00:00:00.000'));
  });

  it('rifiuta from successiva a to', () => {
    const result = parse({ from: '2026-10-21', to: '2026-10-20' });
    assert.equal(result.success, false);
    assert.equal(firstMessage(result), "'from' non può essere successiva a 'to'.");
  });

  it('rifiuta date insieme a from o a to', () => {
    assert.equal(parse({ date: '2026-10-20', from: '2026-10-01' }).success, false);
    assert.equal(parse({ date: '2026-10-20', to: '2026-10-31' }).success, false);
  });

  for (const bad of ['20-10-2026', '2026/10/20', '2026-10-2', '2026-1-20', 'oggi', '', '2026-10-20T10:00:00Z']) {
    it(`rifiuta il formato "${bad}"`, () => {
      assert.equal(parse({ date: bad }).success, false);
    });
  }

  for (const bad of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-10-00']) {
    it(`rifiuta il giorno che non esiste "${bad}"`, () => {
      const result = parse({ date: bad });
      assert.equal(result.success, false);
      assert.equal(firstMessage(result), 'La data indicata non esiste nel calendario.');
    });
  }

  it('accetta il 29 febbraio di un anno bisestile', () => {
    assert.equal(parse({ date: '2028-02-29' }).success, true);
  });

  it('rifiuta anni fuori da 1970-2999', () => {
    assert.equal(parse({ date: '1969-12-31' }).success, false);
    assert.equal(parse({ date: '3000-01-01' }).success, false);
    assert.equal(parse({ date: '1970-01-01' }).success, true);
    assert.equal(parse({ date: '2999-12-31' }).success, true);
  });

  it('productId: un id solo', () => {
    assert.deepEqual(parse({ productId: '3' }).data, { productIds: [3], ...pagination });
  });

  it('productId: parametro ripetuto, che Express consegna come array', () => {
    assert.deepEqual(parse({ productId: ['3', '5'] }).data, { productIds: [3, 5], ...pagination });
  });

  it('productId: elenco separato da virgole', () => {
    assert.deepEqual(parse({ productId: '3,5,8' }).data, { productIds: [3, 5, 8], ...pagination });
  });

  it('productId: le due forme insieme, senza doppioni', () => {
    assert.deepEqual(parse({ productId: ['3,5', '5', '8'] }).data, { productIds: [3, 5, 8], ...pagination });
  });

  for (const bad of ['', '3,', ',3', '3,,5', 'abc', '3 OR 1=1', '1 UNION SELECT 1', '0', '-2', '1.5', "3'"]) {
    it(`productId rifiuta "${bad}"`, () => {
      assert.equal(parse({ productId: bad }).success, false);
    });
  }

  it('productId rifiuta un oggetto (?productId[a]=1)', () => {
    assert.equal(parse({ productId: { a: '1' } }).success, false);
  });

  it('rifiuta i parametri che non conosce', () => {
    const result = parse({ page: '2' });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].code, 'unrecognized_keys');
  });

  it('combina data e prodotti nello stesso filtro', () => {
    assert.deepEqual(parse({ date: '2026-10-20', productId: '2,4' }).data, {
      createdFrom: utc('2026-10-20T00:00:00.000'),
      createdBefore: utc('2026-10-21T00:00:00.000'),
      productIds: [2, 4],
      ...pagination,
    });
  });
});
