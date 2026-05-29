const test = require('node:test');
const assert = require('node:assert/strict');
const { LuminaDBEngine } = require('../src/engine/LuminaDBEngine');

test('supports insert and select with where/order/limit', () => {
  const db = new LuminaDBEngine();
  db.defineTable('players', {
    fields: { name: 'string', coins: 'number' },
    indexes: ['coins']
  });

  db.query("INSERT INTO players (name, coins) VALUES ('a', 1200)");
  db.query("INSERT INTO players (name, coins) VALUES ('b', 2000)");
  db.query("INSERT INTO players (name, coins) VALUES ('c', 900)");

  const result = db.query('SELECT name, coins FROM players WHERE coins > 1000 ORDER BY coins DESC LIMIT 1');
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.rows[0], { name: 'b', coins: 2000 });
});

test('rolls back transaction on failure', async () => {
  const db = new LuminaDBEngine();
  db.defineTable('players', { fields: { name: 'string', coins: 'number' } });

  await assert.rejects(async () => {
    await db.transaction(async (tx) => {
      tx.query("INSERT INTO players (name, coins) VALUES ('a', 10)");
      throw new Error('boom');
    });
  });

  const rows = db.query('SELECT * FROM players');
  assert.equal(rows.rowCount, 0);
});

test('supports explain with index strategy', () => {
  const db = new LuminaDBEngine();
  db.defineTable('players', { fields: { coins: 'number' }, indexes: ['coins'] });
  const plan = db.explain('SELECT * FROM players WHERE coins = 10');
  assert.equal(plan.strategy.accessPath, 'INDEX_SCAN');
});

test('supports savepoints without rolling back outer transaction', async () => {
  const db = new LuminaDBEngine();
  db.defineTable('players', { fields: { name: 'string', coins: 'number' } });

  await db.transaction(async (tx) => {
    tx.query("INSERT INTO players (name, coins) VALUES ('outer', 1)");
    const savepoint = tx.savepoint();
    tx.query("INSERT INTO players (name, coins) VALUES ('inner', 2)");
    tx.rollbackTo(savepoint);
  });

  const rows = db.query('SELECT * FROM players ORDER BY id ASC');
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].name, 'outer');
});
