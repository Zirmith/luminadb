class CacheEngine {
  constructor({ maxEntries = 5000 } = {}) {
    this.maxEntries = maxEntries;
    this.l1 = new Map();
    this.queryPlanCache = new Map();
    this.queryResultCache = new Map();
    this.metrics = { hits: 0, misses: 0, evictions: 0 };
  }

  set(key, value) {
    if (this.l1.size >= this.maxEntries) {
      const oldest = this.l1.keys().next().value;
      this.l1.delete(oldest);
      this.metrics.evictions += 1;
    }
    this.l1.set(key, value);
  }

  get(key) {
    if (this.l1.has(key)) {
      this.metrics.hits += 1;
      return this.l1.get(key);
    }
    this.metrics.misses += 1;
    return null;
  }

  setQueryPlan(key, value) {
    this.queryPlanCache.set(key, value);
  }

  getQueryPlan(key) {
    return this.queryPlanCache.get(key) || null;
  }

  setQueryResult(key, rows) {
    this.queryResultCache.set(key, { table: this.extractTable(key), rows });
  }

  getQueryResult(key) {
    return this.queryResultCache.get(key)?.rows || null;
  }

  invalidateTable(table) {
    for (const [key, value] of this.queryResultCache.entries()) {
      if (value.table === table) {
        this.queryResultCache.delete(key);
      }
    }
  }

  extractTable(key) {
    try {
      return JSON.parse(key).table || null;
    } catch {
      return null;
    }
  }

  clear() {
    this.l1.clear();
    this.queryPlanCache.clear();
    this.queryResultCache.clear();
  }
}

module.exports = { CacheEngine };
