'use strict';

const { z } = require('zod');

// Per i messaggi che non scrivo io (tipi sbagliati in campi insoliti) uso quelli italiani di zod.
z.config(z.locales.it());

const MAX_ID = 4294967295; // il massimo di una colonna INT UNSIGNED

// Un oggetto JSON. Le chiavi che non conosco vengono scartate, così un client non può
// scrivere campi che non ha il permesso di toccare (mass assignment).
const jsonObject = (shape) =>
  z.object(shape, { error: 'Il corpo della richiesta deve essere un oggetto JSON.' });

const requiredText = (label, max) =>
  z
    .string({
      error: (issue) => (issue.input === undefined ? `${label} è obbligatorio.` : `${label} deve essere un testo.`),
    })
    .trim()
    .min(1, `${label} non può essere vuoto.`)
    .max(max, `${label} può avere al massimo ${max} caratteri.`);

// Id che arriva da URL o query string: solo cifre, senza zeri davanti.
// Niente Number() "alla buona": Number('1e3') sarebbe 1000 e Number('') sarebbe 0.
const idFromText = z
  .string()
  .regex(/^[1-9]\d*$/, "L'id deve essere un numero intero positivo.")
  .transform(Number)
  .refine((id) => id <= MAX_ID, "L'id indicato è troppo grande.");

const idParams = z.object({ id: idFromText });

// Id che arriva dentro il corpo JSON: qui deve essere già un numero.
const idInBody = z
  .number({ error: 'Ogni id deve essere un numero intero positivo.' })
  .int('Ogni id deve essere un numero intero positivo.')
  .positive('Ogni id deve essere un numero intero positivo.')
  .max(MAX_ID, 'Uno degli id indicati è troppo grande.');

const idList = (field) =>
  z
    .array(idInBody, {
      error: (issue) =>
        issue.input === undefined
          ? `Il campo ${field} è obbligatorio.`
          : `Il campo ${field} deve essere un elenco di id.`,
    })
    .min(1, `Il campo ${field} deve contenere almeno un id.`)
    .max(100, `Il campo ${field} può contenere al massimo 100 id.`)
    .refine((ids) => new Set(ids).size === ids.length, `Il campo ${field} contiene id ripetuti.`);

const hasAtLeastOneField = (object) => Object.keys(object).length > 0;
const AT_LEAST_ONE_FIELD = 'Indica almeno un campo da modificare.';

module.exports = {
  jsonObject,
  requiredText,
  idFromText,
  idParams,
  idList,
  hasAtLeastOneField,
  AT_LEAST_ONE_FIELD,
};
