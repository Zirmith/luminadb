const { QueryParser } = require('./core/QueryParser');
const { QueryPlanner } = require('./core/QueryPlanner');
const { QueryOptimizer } = require('./core/QueryOptimizer');
const { ExecutionEngine } = require('./core/ExecutionEngine');
const { ResultProcessor } = require('./core/ResultProcessor');
const { StorageEngine } = require('./storage/StorageEngine');
const { CacheEngine } = require('./cache/CacheEngine');
const { TransactionEngine } = require('./transaction/TransactionEngine');
const { ReplicationEngine } = require('./replication/ReplicationEngine');
const { AnalyticsEngine } = require('./analytics/AnalyticsEngine');
const { SecurityEngine } = require('./security/SecurityEngine');
const { NetworkingEngine } = require('./networking/NetworkingEngine');
const { SchemaEngine } = require('./schema/SchemaEngine');

class LuminaDBEngine {
  constructor(options = {}) {
    this.parser = new QueryParser();
    this.planner = new QueryPlanner();
    this.optimizer = new QueryOptimizer();
    this.executor = new ExecutionEngine();
    this.resultProcessor = new ResultProcessor();

    this.storage = new StorageEngine(options.storage);
    this.cache = new CacheEngine(options.cache);
    this.replication = new ReplicationEngine(options.replication);
    this.transactions = new TransactionEngine(this.storage);
    this.analytics = new AnalyticsEngine();
    this.security = new SecurityEngine(options.security);
    this.networking = new NetworkingEngine();
    this.schema = new SchemaEngine(this.storage);
  }

  defineTable(table, schema = {}) {
    this.schema.define(table, schema);
    if (schema.indexes) {
      schema.indexes.forEach((indexField) => this.storage.createIndex(table, indexField));
    }
  }

  query(queryString) {
    const ast = this.parser.parse(queryString);
    if (ast.type === 'INSERT' && !this.schema.validate(ast.table, ast.record)) {
      throw new Error(`Schema validation failed for table ${ast.table}`);
    }
    const plan = this.planner.createPlan(ast, this.storage);
    const optimizedPlan = this.optimizer.optimize(plan, this.cache);
    const result = this.executor.execute(optimizedPlan, this.storage, this.cache, this.replication);
    return this.resultProcessor.process(result);
  }

  explain(queryString) {
    const ast = this.parser.parse(queryString);
    const plan = this.planner.createPlan(ast, this.storage);
    return this.optimizer.optimize(plan, this.cache);
  }

  async transaction(callback) {
    const txApi = {
      query: (sql) => this.query(sql),
      savepoint: () => this.transactions.savepoint(),
      rollbackTo: (savepoint) => this.transactions.rollbackTo(savepoint)
    };
    return this.transactions.run(callback, txApi);
  }

  checkpoint() {
    this.storage.checkpoint();
  }

  snapshot(path) {
    this.storage.snapshot(path);
  }

  restore(path) {
    this.storage.load(path);
  }
}

module.exports = { LuminaDBEngine };
