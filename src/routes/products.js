'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const { allowMethods } = require('../middleware/allowMethods');
const { idParams } = require('../schemas/common');
const { productBody, productPatchBody } = require('../schemas/product');

function productRoutes(productService) {
  const router = express.Router();

  router
    .route('/')
    .get(async (req, res) => {
      res.json(await productService.list());
    })
    .post(validate({ body: productBody }), async (req, res) => {
      const product = await productService.create(req.valid.body);
      res.status(201).location(`/products/${product.id}`).json(product);
    })
    .all(allowMethods('GET', 'POST'));

  router
    .route('/:id')
    .get(validate({ params: idParams }), async (req, res) => {
      res.json(await productService.get(req.valid.params.id));
    })
    .put(validate({ params: idParams, body: productBody }), async (req, res) => {
      res.json(await productService.update(req.valid.params.id, req.valid.body));
    })
    .patch(validate({ params: idParams, body: productPatchBody }), async (req, res) => {
      res.json(await productService.update(req.valid.params.id, req.valid.body));
    })
    .delete(validate({ params: idParams }), async (req, res) => {
      await productService.remove(req.valid.params.id);
      res.status(204).end();
    })
    .all(allowMethods('GET', 'PUT', 'PATCH', 'DELETE'));

  return router;
}

module.exports = { productRoutes };
