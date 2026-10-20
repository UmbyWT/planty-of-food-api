'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const MIGRATIONS_FILE = path.join(__dirname, '..', 'db', 'migrations.sql');

// Applica db/migrations.sql al database indicato.
// multipleStatements serve per eseguire il file in un colpo solo. È sicuro perché il testo
// SQL arriva da un file del repository, mai da input di un utente.
async function applyMigrations(dbConfig) {
  const sql = await fs.readFile(MIGRATIONS_FILE, 'utf8');
  const connection = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
  try {
    await connection.query(sql);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { loadConfig } = require('../src/config');

  (async () => {
    const { db } = loadConfig();
    await applyMigrations(db);
    console.log(`Struttura creata nel database "${db.database}".`);
  })().catch((error) => {
    console.error('Migrazione non riuscita:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { applyMigrations };
