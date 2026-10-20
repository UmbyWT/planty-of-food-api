'use strict';

const { z } = require('zod');
const { jsonObject, requiredText, hasAtLeastOneField, AT_LEAST_ONE_FIELD } = require('./common');

// L'email si salva in minuscolo e senza spazi ai lati, così "Mario@x.it " e "mario@x.it"
// sono lo stesso indirizzo anche prima di arrivare al vincolo di unicità del database.
const email = z
  .string({
    error: (issue) => (issue.input === undefined ? "L'email è obbligatoria." : "L'email deve essere un testo."),
  })
  .trim()
  .toLowerCase()
  .max(254, "L'email può avere al massimo 254 caratteri.")
  .pipe(z.email({ error: 'Indirizzo email non valido.' }));

const userBody = jsonObject({
  name: requiredText('Il nome', 100),
  surname: requiredText('Il cognome', 100),
  email,
});

const userPatchBody = userBody.partial().refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);

module.exports = { userBody, userPatchBody };
