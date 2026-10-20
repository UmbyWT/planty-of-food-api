-- Database separato per i test di integrazione, che a ogni esecuzione ne cancellano le tabelle.
-- La struttura la crea il test stesso, applicando db/migrations.sql.
CREATE DATABASE IF NOT EXISTS pof_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON pof_test.* TO 'pof'@'%';
