'use strict';

const { HttpError } = require('../errors');

function routeNotFound(req, res, next) {
  next(new HttpError(404, 'ROUTE_NOT_FOUND', `La risorsa ${req.method} ${req.path} non esiste.`));
}

// Errori che arrivano dalla lettura del corpo (body-parser) e non sono nostri.
function fromBodyParser(error) {
  switch (error.type) {
    case 'entity.parse.failed':
      return new HttpError(400, 'INVALID_JSON', 'Il corpo della richiesta non è un JSON valido.');
    case 'entity.too.large':
      return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Il corpo della richiesta è troppo grande.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Codifica del corpo non supportata.');
    default:
      return null;
  }
}

// Tutti gli errori passano da qui e escono nello stesso formato:
//   { "error": { "code": "...", "message": "...", "details": [...] } }
// Di quelli imprevisti il client vede solo un messaggio generico: lo stack resta nei log.
function createErrorHandler(logger = console) {
  // Express riconosce un error handler dal fatto che la funzione ha quattro parametri.
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);

    const known = error instanceof HttpError ? error : fromBodyParser(error);
    if (known) {
      const body = { code: known.code, message: known.message };
      if (known.details !== undefined) body.details = known.details;
      return res.status(known.status).json({ error: body });
    }

    logger.error(error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Errore interno del server.' },
    });
  };
}

module.exports = { routeNotFound, createErrorHandler };
