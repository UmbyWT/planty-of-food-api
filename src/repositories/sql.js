'use strict';

// Costruisce "?, ?, ?" per una lista IN di lunghezza nota.
// Nel testo SQL finiscono solo segnaposto, mai i valori: quelli viaggiano a parte
// come parametri del prepared statement.
function placeholders(count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('placeholders() vuole un intero maggiore di zero');
  }
  return Array(count).fill('?').join(', ');
}

module.exports = { placeholders };
