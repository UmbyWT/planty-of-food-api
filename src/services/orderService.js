'use strict';

const { notFound, unprocessable } = require('../errors');

function createOrderService({ orderRepository, productRepository, userRepository }) {
  // Prima di scrivere controllo che prodotti e utenti indicati esistano, così posso dire
  // al client quali id mancano invece di un generico errore di chiave esterna.
  async function assertReferencesExist({ productIds, userIds }) {
    const [missingProducts, missingUsers] = await Promise.all([
      productIds ? productRepository.findMissingIds(productIds) : [],
      userIds ? userRepository.findMissingIds(userIds) : [],
    ]);

    const details = [];
    if (missingProducts.length > 0) {
      details.push({ field: 'productIds', message: `Prodotti inesistenti: ${missingProducts.join(', ')}.` });
    }
    if (missingUsers.length > 0) {
      details.push({ field: 'userIds', message: `Utenti inesistenti: ${missingUsers.join(', ')}.` });
    }
    if (details.length > 0) {
      throw unprocessable('Uno o più prodotti o utenti indicati non esistono.', details);
    }
  }

  // Legge un ordine o risponde 404. Lo uso anche per rileggere l'ordine appena scritto:
  // se nel frattempo un altro client lo ha eliminato, è giusto dire che non esiste più
  // invece di restituire un corpo vuoto.
  async function load(id) {
    const order = await orderRepository.findById(id);
    if (!order) throw notFound('Ordine', id);
    return order;
  }

  return {
    list(filters) {
      return orderRepository.findAll(filters);
    },

    get: load,

    async create({ productIds, userIds }) {
      await assertReferencesExist({ productIds, userIds });
      const id = await orderRepository.create({ productIds, userIds });
      return load(id);
    },

    // PUT sostituisce entrambi gli elenchi, PATCH solo quelli presenti nel corpo.
    async update(id, changes) {
      // Se l'ordine non c'è rispondo 404 prima di parlare di eventuali id sbagliati.
      await load(id);

      await assertReferencesExist(changes);
      const updated = await orderRepository.update(id, changes);
      // false vuol dire che l'ordine è stato eliminato tra la lettura e la scrittura.
      if (!updated) throw notFound('Ordine', id);
      return load(id);
    },

    async remove(id) {
      const removed = await orderRepository.remove(id);
      if (!removed) throw notFound('Ordine', id);
    },
  };
}

module.exports = { createOrderService };
