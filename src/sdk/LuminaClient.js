const { LuminaDBEngine } = require('../engine/LuminaDBEngine');

class LuminaClient {
  constructor(options = {}) {
    this.engine = new LuminaDBEngine(options);
  }

  defineTable(table, schema) {
    return this.engine.defineTable(table, schema);
  }

  query(sql) {
    return this.engine.query(sql);
  }

  explain(sql) {
    return this.engine.explain(sql);
  }

  transaction(callback) {
    return this.engine.transaction(callback);
  }

  get analytics() {
    return this.engine.analytics;
  }
}

module.exports = { LuminaClient };
