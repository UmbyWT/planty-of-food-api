'use strict';

const { conflict } = require('../errors');
const { placeholders } = require('./sql');

const toProduct = (row) => ({ id: row.id, name: row.name });

// Tutte le query usano pool.execute: prepared statement veri, con i valori inviati
// al server separati dal testo SQL.
function createProductRepository(pool) {
  return {
    async findAll() {
      const [rows] = await pool.execute('SELECT id, name FROM products ORDER BY id');
      return rows.map(toProduct);
    },

    async findById(id) {
      const [rows] = await pool.execute('SELECT id, name FROM products WHERE id = ?', [id]);
      return rows.length > 0 ? toProduct(rows[0]) : null;
    },

    async create({ name }) {
      const [result] = await pool.execute('INSERT INTO products (name) VALUES (?)', [name]);
      return { id: result.insertId, name };
    },

    async update(id, { name }) {
      await pool.execute('UPDATE products SET name = ? WHERE id = ?', [name, id]);
    },

    // Restituisce false se il prodotto non esiste.
    async remove(id) {
      try {
        const [result] = await pool.execute('DELETE FROM products WHERE id = ?', [id]);
        return result.affectedRows > 0;
      } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
          throw conflict('Il prodotto compare in almeno un ordine e non può essere eliminato.');
        }
        throw error;
      }
    },

    // Dato un elenco di id, restituisce quelli che nel database non esistono.
    async findMissingIds(ids) {
      if (ids.length === 0) return [];
      const [rows] = await pool.execute(
        `SELECT id FROM products WHERE id IN (${placeholders(ids.length)})`,
        ids,
      );
      const found = new Set(rows.map((row) => row.id));
      return ids.filter((id) => !found.has(id));
    },
  };
}

module.exports = { createProductRepository };
