'use strict';

// Errore che sa già con quale status HTTP e quale codice deve arrivare al client.
// I livelli sotto le rotte (service e repository) lanciano questo, così la gestione
// degli errori sta in un punto solo: middleware/errorHandler.js.
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const validationError = (details, message = 'I dati inviati non sono validi.') =>
  new HttpError(400, 'VALIDATION_ERROR', message, details);

const notFound = (resource, id) =>
  new HttpError(404, 'NOT_FOUND', `${resource} con id ${id} non trovato.`);

const methodNotAllowed = (allowed) =>
  new HttpError(405, 'METHOD_NOT_ALLOWED', `Metodo non consentito. Metodi disponibili: ${allowed.join(', ')}.`);

const conflict = (message) => new HttpError(409, 'CONFLICT', message);

const unsupportedMediaType = () =>
  new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Il Content-Type deve essere application/json.');

const unprocessable = (message, details) =>
  new HttpError(422, 'UNPROCESSABLE_ENTITY', message, details);

module.exports = {
  HttpError,
  validationError,
  notFound,
  methodNotAllowed,
  conflict,
  unsupportedMediaType,
  unprocessable,
};
