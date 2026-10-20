'use strict';

const { conflict } = require('../errors');
const { placeholders } = require('./sql');

const toUser = (row) => ({ id: row.id, name: row.name, surname: row.surname, email: row.email });

const DUPLICATE_EMAIL = 'Esiste già un utente con questa email.';

function createUserRepository(pool) {
  return {
    async findAll() {
      const [rows] = await pool.execute('SELECT id, name, surname, email FROM users ORDER BY id');
      return rows.map(toUser);
    },

    async findById(id) {
      const [rows] = await pool.execute('SELECT id, name, surname, email FROM users WHERE id = ?', [id]);
      return rows.length > 0 ? toUser(rows[0]) : null;
    },

    async create({ name, surname, email }) {
      try {
        const [result] = await pool.execute(
          'INSERT INTO users (name, surname, email) VALUES (?, ?, ?)',
          [name, surname, email],
        );
        return { id: result.insertId, name, surname, email };
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw conflict(DUPLICATE_EMAIL);
        throw error;
      }
    },

    async update(id, { name, surname, email }) {
      try {
        await pool.execute('UPDATE users SET name = ?, surname = ?, email = ? WHERE id = ?', [
          name,
          surname,
          email,
          id,
        ]);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw conflict(DUPLICATE_EMAIL);
        throw error;
      }
    },

    // Restituisce false se l'utente non esiste.
    async remove(id) {
      try {
        const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [id]);
        return result.affectedRows > 0;
      } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
          throw conflict("L'utente partecipa ad almeno un ordine e non può essere eliminato.");
        }
        throw error;
      }
    },

    async findMissingIds(ids) {
      if (ids.length === 0) return [];
      const [rows] = await pool.execute(
        `SELECT id FROM users WHERE id IN (${placeholders(ids.length)})`,
        ids,
      );
      const found = new Set(rows.map((row) => row.id));
      return ids.filter((id) => !found.has(id));
    },
  };
}

module.exports = { createUserRepository };
