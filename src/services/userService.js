'use strict';

const { notFound } = require('../errors');

function createUserService({ userRepository }) {
  return {
    list() {
      return userRepository.findAll();
    },

    async get(id) {
      const user = await userRepository.findById(id);
      if (!user) throw notFound('Utente', id);
      return user;
    },

    create(data) {
      return userRepository.create(data);
    },

    // Come per i prodotti: PUT e PATCH passano da qui.
    async update(id, changes) {
      const current = await userRepository.findById(id);
      if (!current) throw notFound('Utente', id);

      const updated = { ...current, ...changes };
      await userRepository.update(id, updated);
      return updated;
    },

    async remove(id) {
      const removed = await userRepository.remove(id);
      if (!removed) throw notFound('Utente', id);
    },
  };
}

module.exports = { createUserService };
