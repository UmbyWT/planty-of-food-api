'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('./config');
const { createPool } = require('./db');
const { composeApp } = require('./compose');

function main() {
  const config = loadConfig();
  const pool = createPool(config.db);
  const server = composeApp(pool).listen(config.port, () => {
    console.log(`API di POF in ascolto su http://localhost:${config.port}`);
  });

  // Allo spegnimento smetto di accettare richieste, aspetto quelle in corso e chiudo il pool.
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} ricevuto, chiudo il server.`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
