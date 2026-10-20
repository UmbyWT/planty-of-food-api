'use strict';

// Controlli sul testo dei repository, per non reintrodurre per distrazione una query costruita
// a mano. Non sostituiscono i test di integrazione con i payload di injection: li affiancano,
// perché una sola query scritta male può passare inosservata anche con tanti test funzionali.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { placeholders } = require('../../src/repositories/sql');

const REPOSITORIES = path.join(__dirname, '..', '..', 'src', 'repositories');
const files = fs.readdirSync(REPOSITORIES).filter((file) => file.endsWith('Repository.js'));

// Gli unici pezzi che possono comparire dentro un testo SQL con ${...}. Sono tutti costruiti
// dal codice (segnaposto e condizioni fisse), mai dai dati della richiesta.
const ALLOWED_INTERPOLATIONS = new Set([
  'marks',
  'values',
  'where',
  'placeholders(ids.length)',
  'placeholders(filters.productIds.length)',
  "conditions.join(' AND ')",
]);

describe('sicurezza delle query nei repository', () => {
  it('ci sono i tre repository attesi', () => {
    assert.deepEqual(files.sort(), ['orderRepository.js', 'productRepository.js', 'userRepository.js']);
  });

  for (const file of files) {
    const source = fs.readFileSync(path.join(REPOSITORIES, file), 'utf8');

    it(`${file} esegue le query solo con execute (prepared statement), mai con query`, () => {
      assert.doesNotMatch(source, /\.query\(/);
      assert.match(source, /\.execute\(/);
    });

    it(`${file} inserisce nel testo SQL soltanto segnaposto e condizioni fisse`, () => {
      const interpolations = [...source.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim());
      for (const expression of interpolations) {
        assert.ok(
          ALLOWED_INTERPOLATIONS.has(expression),
          `\${${expression}} in ${file} non è tra le interpolazioni previste: controlla che non contenga dati dell'utente`,
        );
      }
    });

    it(`${file} non costruisce SQL concatenando stringhe`, () => {
      assert.doesNotMatch(source, /['"`]\s*\+\s*(?:id|name|email|surname|filters|ids|req|params)\b/);
      assert.doesNotMatch(source, /(?:SELECT|INSERT|UPDATE|DELETE)[^;`]*['"]\s*\+/i);
    });
  }
});

describe('placeholders', () => {
  it('produce un segnaposto per ogni elemento', () => {
    assert.equal(placeholders(1), '?');
    assert.equal(placeholders(3), '?, ?, ?');
  });

  it('rifiuta quantità che non hanno senso', () => {
    for (const bad of [0, -1, 1.5, '3', undefined, NaN]) {
      assert.throws(() => placeholders(bad), RangeError);
    }
  });

  it('non lascia mai passare un valore nel testo, qualunque cosa riceva', () => {
    assert.throws(() => placeholders("1); DROP TABLE orders; --"), RangeError);
  });
});
