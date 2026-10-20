'use strict';

const { createApp } = require('./app');
const { createProductRepository } = require('./repositories/productRepository');
const { createUserRepository } = require('./repositories/userRepository');
const { createOrderRepository } = require('./repositories/orderRepository');
const { createProductService } = require('./services/productService');
const { createUserService } = require('./services/userService');
const { createOrderService } = require('./services/orderService');

// Collega i pezzi veri: pool -> repository -> service -> app.
// Lo usano sia il server sia i test di integrazione, così provano lo stesso cablaggio.
function composeApp(pool, { logger } = {}) {
  const productRepository = createProductRepository(pool);
  const userRepository = createUserRepository(pool);
  const orderRepository = createOrderRepository(pool);

  return createApp({
    productService: createProductService({ productRepository }),
    userService: createUserService({ userRepository }),
    orderService: createOrderService({ orderRepository, productRepository, userRepository }),
    checkDatabase: () => pool.query('SELECT 1'),
    logger,
  });
}

module.exports = { composeApp };
