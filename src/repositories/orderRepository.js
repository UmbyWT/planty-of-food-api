'use strict';

const { unprocessable } = require('../errors');
const { withTransaction } = require('../db');
const { placeholders } = require('./sql');

const MISSING_REFERENCE = 'Uno dei prodotti o degli utenti indicati non esiste.';

// Un ordine è una riga di `orders` più le sue righe in `order_products` e `order_users`.
// Per non perdere pezzi con una JOIN (filtrando per prodotto, per esempio, l'ordine
// mostrerebbe solo il prodotto cercato) leggo prima gli ordini e poi, con due query
// separate, tutti i loro prodotti e tutti i loro utenti.
async function loadOrders(pool, orderRows) {
  if (orderRows.length === 0) return [];

  const ids = orderRows.map((row) => row.id);
  const marks = placeholders(ids.length);

  const [productRows] = await pool.execute(
    `SELECT op.order_id AS orderId, p.id, p.name
       FROM order_products op
       JOIN products p ON p.id = op.product_id
      WHERE op.order_id IN (${marks})
      ORDER BY p.id`,
    ids,
  );
  const [userRows] = await pool.execute(
    `SELECT ou.order_id AS orderId, u.id, u.name, u.surname, u.email
       FROM order_users ou
       JOIN users u ON u.id = ou.user_id
      WHERE ou.order_id IN (${marks})
      ORDER BY u.id`,
    ids,
  );

  const group = (rows, toItem) => {
    const byOrder = new Map();
    for (const row of rows) {
      if (!byOrder.has(row.orderId)) byOrder.set(row.orderId, []);
      byOrder.get(row.orderId).push(toItem(row));
    }
    return byOrder;
  };
  const products = group(productRows, (row) => ({ id: row.id, name: row.name }));
  const users = group(userRows, (row) => ({
    id: row.id,
    name: row.name,
    surname: row.surname,
    email: row.email,
  }));

  return orderRows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    products: products.get(row.id) ?? [],
    users: users.get(row.id) ?? [],
  }));
}

async function insertProducts(connection, orderId, productIds) {
  const values = productIds.map(() => '(?, ?)').join(', ');
  await connection.execute(
    `INSERT INTO order_products (order_id, product_id) VALUES ${values}`,
    productIds.flatMap((productId) => [orderId, productId]),
  );
}

async function insertUsers(connection, orderId, userIds) {
  const values = userIds.map(() => '(?, ?)').join(', ');
  await connection.execute(
    `INSERT INTO order_users (order_id, user_id) VALUES ${values}`,
    userIds.flatMap((userId) => [orderId, userId]),
  );
}

// Se un id non esiste più nel momento in cui scrivo (il service lo ha controllato un
// attimo prima, ma nel frattempo qualcuno può averlo eliminato) lo dice la chiave esterna.
function translateReferenceError(error) {
  if (error.code === 'ER_NO_REFERENCED_ROW_2') throw unprocessable(MISSING_REFERENCE);
  throw error;
}

function createOrderRepository(pool) {
  return {
    // filters: { createdFrom?: Date (incluso), createdBefore?: Date (escluso), productIds?: number[] }
    // Con più productIds basta che l'ordine ne contenga uno.
    // I pezzi di SQL aggiunti qui sono tutti costanti; i valori passano solo dai parametri.
    async findAll(filters = {}) {
      const conditions = [];
      const params = [];

      if (filters.createdFrom) {
        conditions.push('o.created_at >= ?');
        params.push(filters.createdFrom);
      }
      if (filters.createdBefore) {
        conditions.push('o.created_at < ?');
        params.push(filters.createdBefore);
      }
      if (filters.productIds && filters.productIds.length > 0) {
        conditions.push(
          `EXISTS (SELECT 1 FROM order_products op
                    WHERE op.order_id = o.id
                      AND op.product_id IN (${placeholders(filters.productIds.length)}))`,
        );
        params.push(...filters.productIds);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.execute(
        `SELECT o.id, o.created_at FROM orders o ${where} ORDER BY o.created_at DESC, o.id DESC`,
        params,
      );
      return loadOrders(pool, rows);
    },

    async findById(id) {
      const [rows] = await pool.execute('SELECT id, created_at FROM orders WHERE id = ?', [id]);
      const [order] = await loadOrders(pool, rows);
      return order ?? null;
    },

    // Crea l'ordine e le sue righe in una sola transazione. Restituisce l'id.
    async create({ productIds, userIds }) {
      try {
        return await withTransaction(pool, async (connection) => {
          const [result] = await connection.execute('INSERT INTO orders () VALUES ()');
          await insertProducts(connection, result.insertId, productIds);
          await insertUsers(connection, result.insertId, userIds);
          return result.insertId;
        });
      } catch (error) {
        return translateReferenceError(error);
      }
    },

    // Sostituisce l'elenco dei prodotti e/o quello degli utenti (solo quelli passati).
    // Restituisce false se l'ordine non esiste.
    async update(id, { productIds, userIds }) {
      try {
        return await withTransaction(pool, async (connection) => {
          // FOR UPDATE tiene bloccata la riga dell'ordine fino al commit. Senza, un'eliminazione
          // dello stesso ordine potrebbe arrivare a metà e la modifica fallirebbe sulla chiave
          // esterna, con un errore che non c'entra niente.
          const [rows] = await connection.execute('SELECT id FROM orders WHERE id = ? FOR UPDATE', [id]);
          if (rows.length === 0) return false;

          if (productIds) {
            await connection.execute('DELETE FROM order_products WHERE order_id = ?', [id]);
            await insertProducts(connection, id, productIds);
          }
          if (userIds) {
            await connection.execute('DELETE FROM order_users WHERE order_id = ?', [id]);
            await insertUsers(connection, id, userIds);
          }
          return true;
        });
      } catch (error) {
        return translateReferenceError(error);
      }
    },

    // Le righe dell'ordine spariscono da sole (ON DELETE CASCADE).
    // Restituisce false se l'ordine non esiste.
    async remove(id) {
      const [result] = await pool.execute('DELETE FROM orders WHERE id = ?', [id]);
      return result.affectedRows > 0;
    },
  };
}

module.exports = { createOrderRepository };
