'use strict';

function readPort(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} deve essere un numero di porta valido (1-65535), trovato "${raw}".`);
  }
  return port;
}

// Legge la configurazione da un oggetto di variabili d'ambiente.
// Non carica il file .env: lo fa chi avvia il processo, così questa funzione resta
// facile da testare.
function loadConfig(env = process.env) {
  const missing = ['DB_USER', 'DB_NAME'].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Variabili d'ambiente mancanti: ${missing.join(', ')}. ` +
        'Copia .env.example in .env e compila i valori.',
    );
  }

  return {
    port: readPort(env.PORT, 3000, 'PORT'),
    db: {
      host: env.DB_HOST || '127.0.0.1',
      port: readPort(env.DB_PORT, 3306, 'DB_PORT'),
      user: env.DB_USER,
      password: env.DB_PASSWORD ?? '',
      database: env.DB_NAME,
    },
  };
}

module.exports = { loadConfig };
