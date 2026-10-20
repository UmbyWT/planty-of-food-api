'use strict';

const { methodNotAllowed } = require('../errors');

// Va messo in fondo a una route, dopo i metodi gestiti: risponde 405 con l'header Allow
// a tutti gli altri. Express da solo risponderebbe 404, che per un percorso esistente
// sarebbe fuorviante.
function allowMethods(...methods) {
  const allowHeader = [...methods, ...(methods.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ');

  return (req, res, next) => {
    res.set('Allow', allowHeader);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next(methodNotAllowed(methods));
  };
}

module.exports = { allowMethods };
