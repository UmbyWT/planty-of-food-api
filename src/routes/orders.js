'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const { allowMethods } = require('../middleware/allowMethods');
const { idParams } = require('../schemas/common');
const { orderBody, orderPatchBody, orderQuery } = require('../schemas/order');

function orderRoutes(orderService) {
  const router = express.Router();

  router
    .route('/')
    // Senza parametri restituisce tutti gli ordini. I filtri (date, from, to, productId)
    // si possono combinare: l'ordine deve rispettarli tutti.
    .get(validate({ query: orderQuery }), async (req, res) => {
      res.json(await orderService.list(req.valid.query));
    })
    .post(validate({ body: orderBody }), async (req, res) => {
      const order = await orderService.create(req.valid.body);
      res.status(201).location(`/orders/${order.id}`).json(order);
    })
    .all(allowMethods('GET', 'POST'));

  router
    .route('/:id')
    .get(validate({ params: idParams }), async (req, res) => {
      res.json(await orderService.get(req.valid.params.id));
    })
    .put(validate({ params: idParams, body: orderBody }), async (req, res) => {
      res.json(await orderService.update(req.valid.params.id, req.valid.body));
    })
    .patch(validate({ params: idParams, body: orderPatchBody }), async (req, res) => {
      res.json(await orderService.update(req.valid.params.id, req.valid.body));
    })
    .delete(validate({ params: idParams }), async (req, res) => {
      await orderService.remove(req.valid.params.id);
      res.status(204).end();
    })
    .all(allowMethods('GET', 'PUT', 'PATCH', 'DELETE'));

  return router;
}

module.exports = { orderRoutes };
