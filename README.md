# LuminaDB

LuminaDB is a Node.js database engine and data platform scaffold tailored for Roblox multiplayer workloads.

## Included Engine Modules

- **Core Engine**: LuminaQL parser, planner, optimizer, execution engine, result processor
- **Storage Engine**: binary snapshot `.lumina`/`.lmdb` files, WAL journal, indexing, compaction, checkpoints
- **Cache Engine**: L1 memory cache, query plan cache, query result cache with invalidation
- **Transaction Engine**: ACID-style begin/commit/rollback flow with nested savepoints
- **Replication Engine**: change-event stream with timestamp/priority/merge conflict strategies
- **Analytics Engine**: event tracking for sessions, purchases, and custom game events
- **Security Engine**: AES-256 encryption, API key validation, RBAC checks, audit logging
- **Networking Engine**: transport abstraction for REST/realtime/internal pub-sub
- **Schema Engine**: table definitions, field validation, and index declaration

## LuminaQL

Supported operations:

- `SELECT` with `WHERE`, `GROUP BY`, `ORDER BY`, `LIMIT`, index hints (`/*+ INDEX(field) */`)
- `INSERT`
- `UPDATE`
- `DELETE`

Example:

```js
const { LuminaClient } = require('luminadb');
const db = new LuminaClient();

db.defineTable('players', {
  fields: { name: 'string', coins: 'number' },
  indexes: ['coins']
});

db.query("INSERT INTO players (name, coins) VALUES ('Nova', 1500)");
const top = db.query('SELECT * FROM players WHERE coins > 1000 ORDER BY coins DESC LIMIT 50');
```

## Transactions

```js
await db.transaction(async (tx) => {
  tx.query("UPDATE players SET coins = 2000 WHERE name = 'Nova'");
  tx.query("INSERT INTO players (name, coins) VALUES ('Astra', 100)");
});
```

## Explain Plans

```js
const plan = db.explain('SELECT * FROM players WHERE coins = 1000');
```

## SDKs

- JavaScript SDK: `src/sdk/LuminaClient.js`
- Roblox SDK scaffold: `roblox/Lumina.lua`

## CLI

```bash
lumina init
lumina start
lumina backup ./backup.lmdb
lumina restore ./backup.lmdb
lumina cluster
lumina web
```

## Development

```bash
npm test
npm run web
```
