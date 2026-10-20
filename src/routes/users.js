'use strict';

const express = require('express');
const { validate } = require('../middleware/validate');
const { allowMethods } = require('../middleware/allowMethods');
const { idParams } = require('../schemas/common');
const { userBody, userPatchBody } = require('../schemas/user');

function userRoutes(userService) {
  const router = express.Router();

  router
    .route('/')
    .get(async (req, res) => {
      res.json(await userService.list());
    })
    .post(validate({ body: userBody }), async (req, res) => {
      const user = await userService.create(req.valid.body);
      res.status(201).location(`/users/${user.id}`).json(user);
    })
    .all(allowMethods('GET', 'POST'));

  router
    .route('/:id')
    .get(validate({ params: idParams }), async (req, res) => {
      res.json(await userService.get(req.valid.params.id));
    })
    .put(validate({ params: idParams, body: userBody }), async (req, res) => {
      res.json(await userService.update(req.valid.params.id, req.valid.body));
    })
    .patch(validate({ params: idParams, body: userPatchBody }), async (req, res) => {
      res.json(await userService.update(req.valid.params.id, req.valid.body));
    })
    .delete(validate({ params: idParams }), async (req, res) => {
      await userService.remove(req.valid.params.id);
      res.status(204).end();
    })
    .all(allowMethods('GET', 'PUT', 'PATCH', 'DELETE'));

  return router;
}

module.exports = { userRoutes };
