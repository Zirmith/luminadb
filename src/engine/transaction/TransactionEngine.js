class TransactionEngine {
  constructor(storageEngine) {
    this.storageEngine = storageEngine;
    this.stack = [];
  }

  begin() {
    this.stack.push(this.storageEngine.cloneState());
  }

  savepoint() {
    this.begin();
    return { depth: this.stack.length - 1 };
  }

  rollback() {
    if (!this.stack.length) throw new Error('No active transaction');
    const state = this.stack.pop();
    this.storageEngine.restoreState(state);
  }

  rollbackTo(savepoint) {
    const depth = typeof savepoint === 'object' ? savepoint.depth : savepoint;
    while (this.stack.length > depth) {
      this.rollback();
    }
  }

  commit() {
    if (!this.stack.length) throw new Error('No active transaction');
    this.stack.pop();
  }

  async run(callback, txApi) {
    this.begin();
    try {
      const result = await callback(txApi);
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }
}

module.exports = { TransactionEngine };
