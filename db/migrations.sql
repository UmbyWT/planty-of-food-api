-- Struttura del database per la piattaforma dei gruppi di acquisto di POF.
--
-- Si applica con `npm run migrate`, oppure a mano:
--   mysql -u <utente> -p <nome_database> < db/migrations.sql
--
-- Il database deve esistere già. Il file si può rieseguire senza perdere dati
-- (CREATE TABLE IF NOT EXISTS), quindi va bene anche come passo di avvio.

-- Prodotti venduti. Per ora hanno solo il nome.
CREATE TABLE IF NOT EXISTS products (
  id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  PRIMARY KEY (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Anagrafica degli utenti. L'email è unica: la collation _ci la rende
-- insensibile alle maiuscole, quindi Mario@x.it e mario@x.it sono lo stesso utente.
CREATE TABLE IF NOT EXISTS users (
  id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name    VARCHAR(100) NOT NULL,
  surname VARCHAR(100) NOT NULL,
  email   VARCHAR(254) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Ordini di vendita. La data di inserimento la mette il database, in UTC
-- (l'applicazione imposta il fuso della sessione a +00:00 a ogni connessione).
CREATE TABLE IF NOT EXISTS orders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_orders_created_at (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Prodotti di un ordine (relazione molti a molti).
-- Se l'ordine sparisce spariscono anche le sue righe. Un prodotto invece non si
-- può eliminare finché compare in un ordine, per non riscrivere la storia degli acquisti.
CREATE TABLE IF NOT EXISTS order_products (
  order_id   INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (order_id, product_id),
  KEY idx_order_products_product (product_id),
  CONSTRAINT fk_order_products_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_products_product
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Utenti che partecipano a un ordine (il gruppo di acquisto). Stesse regole di sopra.
CREATE TABLE IF NOT EXISTS order_users (
  order_id INT UNSIGNED NOT NULL,
  user_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (order_id, user_id),
  KEY idx_order_users_user (user_id),
  CONSTRAINT fk_order_users_order
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_users_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
