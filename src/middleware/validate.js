'use strict';

const { validationError, unsupportedMediaType } = require('../errors');

// Trasforma gli errori di zod in una lista leggibile: dove (params, query, body),
// quale campo e cosa non va.
function describeIssues(location, issues) {
  return issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      const keys = issue.keys.join(', ');
      return { location, field: issue.keys[0], message: `Parametro non riconosciuto: ${keys}.` };
    }
    return { location, field: issue.path.join('.'), message: issue.message };
  });
}

// Valida params, query e body con gli schemi indicati e lascia il risultato in req.valid.
// Non riscrivo req.query: in Express 5 è di sola lettura.
function validate({ params, query, body } = {}) {
  return (req, res, next) => {
    const details = [];
    req.valid = {};

    if (body) {
      if (req.body === undefined) {
        // Se Express non ha letto il corpo, o non c'era, o il Content-Type non era JSON.
        const contentType = req.get('content-type');
        return next(
          contentType && !req.is('json')
            ? unsupportedMediaType()
            : validationError([
                { location: 'body', field: '', message: 'Il corpo della richiesta deve essere un oggetto JSON.' },
              ]),
        );
      }
    }

    const checks = [
      ['params', params, req.params],
      ['query', query, req.query],
      ['body', body, req.body],
    ];
    for (const [location, schema, value] of checks) {
      if (!schema) continue;
      const result = schema.safeParse(value);
      if (result.success) req.valid[location] = result.data;
      else details.push(...describeIssues(location, result.error.issues));
    }

    if (details.length > 0) return next(validationError(details));
    return next();
  };
}

module.exports = { validate };
