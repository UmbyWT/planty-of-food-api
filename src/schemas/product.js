'use strict';

const { jsonObject, requiredText, hasAtLeastOneField, AT_LEAST_ONE_FIELD } = require('./common');

// PUT: sostituisce il prodotto, quindi servono tutti i campi.
const productBody = jsonObject({
  name: requiredText('Il nome', 150),
});

// PATCH: modifica solo i campi indicati, ma almeno uno.
const productPatchBody = productBody.partial().refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);

module.exports = { productBody, productPatchBody };
