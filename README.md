# Planty of Food: API per i gruppi di acquisto

Questa è l'API REST della piattaforma separata che Planty of Food (POF) vuole dedicare ai Gruppi di Acquisto Solidale. Gestisce tre cose: i prodotti venduti, gli utenti e gli ordini. Un ordine contiene dei prodotti e gli utenti del gruppo che lo ha fatto. Le risposte sono sempre JSON, non c'è nessun front end.

Il progetto è scritto in Node.js 22 con Express 5 e usa MySQL 8. I test passano anche su MariaDB 10.11.

## Cosa serve

- Node.js 22 o più recente
- Un database MySQL 8. Il modo più comodo è Docker (`docker-compose.yml` è già pronto), ma va bene anche un MySQL installato sul computer.

## Avvio

```bash
npm ci
cp .env.example .env
docker compose up -d      # crea pof (già con le tabelle) e pof_test (vuoto, lo riempiono i test)
npm start
```

Il server ascolta sulla porta 3000. Per controllare che sia vivo e che parli con il database:

```bash
curl -i http://localhost:3000/health
```

Se non usi Docker, crea tu il database e l'utente (adatta nome e password a `.env`) e poi applica la struttura:

```sql
CREATE DATABASE pof CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE pof_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pof'@'%' IDENTIFIED BY 'pof_password';
GRANT ALL PRIVILEGES ON pof.* TO 'pof'@'%';
GRANT ALL PRIVILEGES ON pof_test.* TO 'pof'@'%';
```

```bash
npm run migrate           # esegue db/migrations.sql sul database di .env
```

Si può eseguire anche a mano con `mysql -u pof -p pof < db/migrations.sql`. Il file si può lanciare più volte senza perdere dati.

Le variabili di `.env` sono `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` e, per i test, `TEST_DB_NAME`.

## Le risorse

| Metodo | Percorso | Cosa fa | Risposte |
|---|---|---|---|
| GET | `/products` | elenco dei prodotti | 200 |
| POST | `/products` | crea un prodotto | 201 + `Location` |
| GET | `/products/:id` | un prodotto | 200, 404 |
| PUT | `/products/:id` | sostituisce il prodotto | 200, 404 |
| PATCH | `/products/:id` | modifica i campi indicati | 200, 404 |
| DELETE | `/products/:id` | elimina il prodotto | 204, 404, 409 |
| GET, POST | `/users` | come sopra, per gli utenti | 200, 201 |
| GET, PUT, PATCH, DELETE | `/users/:id` | come sopra | 200, 204, 404, 409 |
| GET | `/orders` | elenco degli ordini, con filtri | 200 |
| POST | `/orders` | crea un ordine | 201 + `Location`, 422 |
| GET, PUT, PATCH, DELETE | `/orders/:id` | come sopra | 200, 204, 404, 422 |
| GET | `/health` | stato del server e del database | 200, 503 |

Un prodotto ha solo il nome: `{ "id": 1, "name": "Farro bio" }`. Un utente ha `name`, `surname` e `email`. Un ordine si crea indicando gli id dei prodotti e quelli degli utenti, e la risposta li restituisce per esteso insieme alla data di inserimento:

```json
{
  "id": 1,
  "createdAt": "2026-10-20T09:30:00.000Z",
  "products": [{ "id": 1, "name": "Farro bio" }],
  "users": [{ "id": 1, "name": "Giulia", "surname": "Bianchi", "email": "giulia@example.it" }]
}
```

La data la decide il server e non si può modificare. È sempre in UTC.

PUT vuole la risorsa intera (tutti i campi), PATCH solo i campi da cambiare, ma almeno uno. Per un ordine, PATCH con `productIds` lascia invariati gli utenti, e il contrario.

## Esempi con curl

Gli id di questi esempi presuppongono un database appena creato.

```bash
# prodotti
curl -i -X POST http://localhost:3000/products \
  -H 'Content-Type: application/json' -d '{"name": "Farro bio"}'
curl -X POST http://localhost:3000/products \
  -H 'Content-Type: application/json' -d '{"name": "Ceci secchi"}'
curl http://localhost:3000/products
curl -X PATCH http://localhost:3000/products/2 \
  -H 'Content-Type: application/json' -d '{"name": "Ceci della Murgia"}'

# utenti
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Giulia", "surname": "Bianchi", "email": "giulia@example.it"}'
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Marco", "surname": "Verdi", "email": "marco@example.it"}'

# un ordine con due prodotti e due utenti
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"productIds": [1, 2], "userIds": [1, 2]}'

# togliere un prodotto dall'ordine e cambiare gli utenti
curl -X PATCH http://localhost:3000/orders/1 \
  -H 'Content-Type: application/json' -d '{"productIds": [1]}'
curl -X PUT http://localhost:3000/orders/1 \
  -H 'Content-Type: application/json' -d '{"productIds": [1, 2], "userIds": [2]}'
```

## Filtri sugli ordini

`GET /orders` senza parametri restituisce tutti gli ordini, dal più recente al più vecchio. Con i parametri si restringe l'elenco, e se ne usano più d'uno l'ordine deve rispettarli tutti. Gli esempi qui sotto presuppongono gli ordini creati sopra, e nelle date va messo il giorno in cui li hai creati.

| Parametro | Esempio | Significato |
|---|---|---|
| `date` | `date=2026-10-20` | ordini inseriti in quel giorno |
| `from` | `from=2026-10-01` | dal giorno indicato, compreso |
| `to` | `to=2026-10-31` | fino al giorno indicato, compreso per intero |
| `productId` | `productId=3` | ordini che contengono quel prodotto |

```bash
curl 'http://localhost:3000/orders?date=2026-10-20'
curl 'http://localhost:3000/orders?from=2026-10-01&to=2026-10-31'
curl 'http://localhost:3000/orders?productId=1'
curl 'http://localhost:3000/orders?productId=1,2'                  # contiene il 1 oppure il 2
curl 'http://localhost:3000/orders?productId=1&productId=2'        # stessa cosa
curl 'http://localhost:3000/orders?date=2026-10-20&productId=1'    # entrambe le condizioni
```

Quando hai finito, per ripulire:

```bash
curl -i -X DELETE http://localhost:3000/orders/1      # 204
curl -i -X DELETE http://localhost:3000/products/2    # 204, ora che nessun ordine lo usa
```

Alcune regole che conviene sapere:

- Le date hanno il formato `AAAA-MM-GG`. Un giorno che non esiste (come il 30 febbraio) è un errore 400, non viene arrotondato.
- I giorni sono giorni UTC, da mezzanotte a mezzanotte.
- `date` non si combina con `from` o `to`, e `from` non può essere dopo `to`.
- Con più `productId` basta che l'ordine ne contenga uno. L'ordine restituito mostra comunque tutti i suoi prodotti, non solo quelli cercati.
- Un parametro che non esiste (per esempio `page`) è un errore 400, così un errore di battitura non passa inosservato.

## Errori

Tutti gli errori hanno la stessa forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "I dati inviati non sono validi.",
    "details": [{ "location": "body", "field": "name", "message": "Il nome non può essere vuoto." }]
  }
}
```

`details` c'è solo quando serve a capire cosa correggere. Gli errori imprevisti rispondono con un messaggio generico: i dettagli finiscono nel log del server e non in quello che vede il client.

| Status | Quando |
|---|---|
| 400 | corpo, id nell'URL o filtri non validi; JSON rotto |
| 404 | la risorsa (o il percorso) non esiste |
| 405 | metodo non previsto per quel percorso; l'header `Allow` elenca quelli giusti |
| 409 | email già usata; prodotto o utente che compare in un ordine e quindi non si elimina |
| 413 | corpo della richiesta oltre i 100 kB |
| 415 | `Content-Type` diverso da `application/json` |
| 422 | l'ordine cita prodotti o utenti che non esistono; `details` dice quali |
| 500 | errore interno |
| 503 | `/health`, quando il database non risponde |

La differenza tra 400 e 422: con 400 la richiesta è scritta male (un campo manca, un id non è un numero), con 422 è scritta bene ma dice cose che nel database non tornano (il prodotto 99 non c'è).

## Test

```bash
npm test                    # test unitari, non servono database né rete
npm run test:integration    # test sul database vero (pof_test)
npm run test:all            # tutti e due
npm run coverage            # tutti, con la copertura del codice
```

I test unitari usano Sinon per fingere repository e service (stub e spy) e Supertest per provare le route HTTP. I test di integrazione ricreano le tabelle di `pof_test` con `db/migrations.sql` a ogni esecuzione, per questo rifiutano di partire se il nome del database non contiene "test" o coincide con `DB_NAME`.

Provano, tra le altre cose: creazione e modifica di ordini, filtri per data e per prodotto con date a cavallo della mezzanotte, vincoli sulle chiavi esterne, transazioni che falliscono a metà, richieste contemporanee e una serie di tentativi di SQL injection. Si possono lanciare con un fuso orario diverso (`TZ=Asia/Kolkata npm run test:integration`) per verificare che le date non dipendano dalla macchina.

Su GitHub gli stessi test girano a ogni push (`.github/workflows/test.yml`), contro un MySQL 8.

## Com'è fatto

```
src/
  server.js            apre la porta e il pool di connessioni
  compose.js           collega repository, service e app
  app.js               middleware e route
  config.js            legge le variabili d'ambiente
  db.js                pool mysql2 e transazioni
  errors.js            HttpError e i suoi costruttori
  routes/              percorsi e metodi HTTP
  schemas/             validazione di corpo, parametri e filtri (zod)
  services/            regole di business, per esempio "i prodotti dell'ordine esistono?"
  repositories/        tutte le query SQL
  middleware/          validazione, 405, gestione degli errori
db/migrations.sql      struttura del database
scripts/migrate.js     applica migrations.sql
test/unit/             test senza database
test/integration/      test con il database vero
```

Le richieste attraversano sempre lo stesso percorso: route, validazione, service, repository. Ogni livello conosce solo quello sotto di sé, e per questo ognuno si può provare con il successivo finto.

## Scelte da sapere

- Le query passano tutte da `pool.execute` di mysql2, che usa prepared statement veri: il testo SQL e i valori viaggiano separati fino al server. Le uniche parti di SQL composte dal codice sono segnaposto (`?, ?, ?`) e condizioni fisse, e un test controlla che nessuno ne aggiunga altre senza accorgersene.
- Un ordine è un insieme di prodotti, senza quantità né prezzi, perché la traccia non li prevede. Lo stesso prodotto due volte nello stesso ordine è un errore 400.
- Un prodotto o un utente che compare in un ordine non si può eliminare (409). Eliminarlo cambierebbe la storia degli acquisti. Eliminando l'ordine, invece, le sue righe spariscono insieme a lui.
- Il nome di un prodotto non è unico: due prodotti possono chiamarsi allo stesso modo. L'email di un utente sì, senza distinguere maiuscole e minuscole.
- Creare o modificare un ordine avviene in una transazione. La modifica blocca prima la riga dell'ordine (`SELECT ... FOR UPDATE`): se nel frattempo arriva un'eliminazione dello stesso ordine, aspetta che la modifica finisca invece di incrociarsi a metà e far fallire la modifica su un errore che non c'entra.
- Le date sono in UTC in ogni punto: il pool imposta il fuso della sessione a `+00:00` e il driver converte in UTC.

## Limiti

- Non c'è autenticazione né autorizzazione: qualunque client può fare qualunque cosa. La traccia non la chiedeva, ma per un uso reale è la prima cosa da aggiungere.
- Gli elenchi non sono paginati: `GET /orders` restituisce tutti gli ordini che corrispondono ai filtri.
- Mancano quantità e prezzi dei prodotti, e lo stato dell'ordine (aperto, chiuso, consegnato).
- Non c'è un Dockerfile per l'API: `docker-compose.yml` avvia solo il database.
