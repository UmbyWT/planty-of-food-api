'use strict';

const { z } = require('zod');
const {
  jsonObject,
  idFromText,
  idList,
  hasAtLeastOneField,
  AT_LEAST_ONE_FIELD,
} = require('./common');

const orderBody = jsonObject({
  productIds: idList('productIds'),
  userIds: idList('userIds'),
});

const orderPatchBody = orderBody.partial().refine(hasAtLeastOneField, AT_LEAST_ONE_FIELD);

// ---- filtri di GET /orders ---------------------------------------------------------------

const FIRST_YEAR = 1970;
const LAST_YEAR = 2999;

const startOfDay = (day) => new Date(`${day}T00:00:00.000Z`);

// new Date('2026-02-30') non dà errore ma scivola al 2 marzo: per accettare solo giorni che
// esistono davvero confronto la data riletta con quella ricevuta.
function isRealDay(text) {
  const date = startOfDay(text);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La data deve avere il formato AAAA-MM-GG, per esempio 2026-10-20.')
  .refine(isRealDay, 'La data indicata non esiste nel calendario.')
  .refine((text) => {
    const year = Number(text.slice(0, 4));
    return year >= FIRST_YEAR && year <= LAST_YEAR;
  }, `La data deve essere compresa tra il ${FIRST_YEAR} e il ${LAST_YEAR}.`);

// productId=3, productId=3&productId=5 oppure productId=3,5: tutte e tre le forme.
const productIdFilter = z
  .union([z.string(), z.array(z.string())], { error: 'productId deve essere uno o più id.' })
  .transform((value) => [value].flat().flatMap((piece) => piece.split(',')))
  .pipe(z.array(idFromText));

const orderQuery = z
  .strictObject({
    date: day.optional(),
    from: day.optional(),
    to: day.optional(),
    productId: productIdFilter.optional(),
  })
  .refine((query) => !(query.date && (query.from || query.to)), {
    message: "Usa 'date' da solo, oppure 'from' e 'to': insieme non hanno senso.",
    path: ['date'],
  })
  .refine((query) => !(query.from && query.to) || query.from <= query.to, {
    message: "'from' non può essere successiva a 'to'.",
    path: ['from'],
  })
  // Dai giorni ricevuti ricavo un intervallo semiaperto [createdFrom, createdBefore) in UTC.
  // 'to' include l'intero giorno indicato, quindi l'estremo escluso è la mezzanotte dopo.
  .transform((query) => {
    const filters = {};
    const firstDay = query.date ?? query.from;
    const lastDay = query.date ?? query.to;

    if (firstDay) filters.createdFrom = startOfDay(firstDay);
    if (lastDay) {
      const before = startOfDay(lastDay);
      before.setUTCDate(before.getUTCDate() + 1);
      filters.createdBefore = before;
    }
    if (query.productId) filters.productIds = [...new Set(query.productId)];
    return filters;
  });

module.exports = { orderBody, orderPatchBody, orderQuery };
