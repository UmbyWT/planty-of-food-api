'use strict';

const mysql = require('mysql2/promise');

function createPool(dbConfig) {
  const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    // Come il driver converte le date JavaScript da e verso il database: sempre UTC.
    timezone: 'Z',
  });

  // Fuso orario della sessione sul server, usato da CURRENT_TIMESTAMP. Senza questa riga
  // la data di inserimento dipenderebbe dal fuso della macchina su cui gira il database.
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => {
      if (error) console.error("Impossibile impostare il fuso orario UTC:", error.message);
    });
  });

  return pool;
}

// Esegue `work` dentro una transazione: o va a buon fine tutto, o non cambia niente.
async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Se anche il rollback fallisce (connessione persa) l'errore che interessa è il primo.
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { createPool, withTransaction };
