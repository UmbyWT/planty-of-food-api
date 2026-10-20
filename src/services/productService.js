'use strict';

const { notFound } = require('../errors');

function createProductService({ productRepository }) {
  return {
    list() {
      return productRepository.findAll();
    },

    async get(id) {
      const product = await productRepository.findById(id);
      if (!product) throw notFound('Prodotto', id);
      return product;
    },

    create(data) {
      return productRepository.create(data);
    },

    // Serve sia a PUT (tutti i campi) sia a PATCH (solo alcuni): in entrambi i casi
    // parto dal prodotto com'è adesso e ci sovrappongo le modifiche.
    async update(id, changes) {
      const current = await productRepository.findById(id);
      if (!current) throw notFound('Prodotto', id);

      const updated = { ...current, ...changes };
      await productRepository.update(id, updated);
      return updated;
    },

    async remove(id) {
      const removed = await productRepository.remove(id);
      if (!removed) throw notFound('Prodotto', id);
    },
  };
}

module.exports = { createProductService };
