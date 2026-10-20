'use strict';

const express = require('express');
const { productRoutes } = require('./routes/products');
const { userRoutes } = require('./routes/users');
const { orderRoutes } = require('./routes/orders');
const { routeNotFound, createErrorHandler } = require('./middleware/errorHandler');

// Costruisce l'app Express a partire da service già pronti. Tenerla separata dal server
// (che apre la porta e il database) permette ai test di provarla con service finti.
function createApp({ productService, userService, orderService, checkDatabase, logger = console }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (req, res) => {
    try {
      await checkDatabase();
      res.json({ status: 'ok' });
    } catch (error) {
      logger.error(error);
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/products', productRoutes(productService));
  app.use('/users', userRoutes(userService));
  app.use('/orders', orderRoutes(orderService));

  app.use(routeNotFound);
  app.use(createErrorHandler(logger));

  return app;
}

module.exports = { createApp };
