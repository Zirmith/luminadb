class QueryOptimizer {
  optimize(plan, cacheEngine) {
    const cacheKey = `plan:${plan.operation}:${plan.table}:${JSON.stringify(plan.ast)}`;
    const cached = cacheEngine.getQueryPlan(cacheKey);
    if (cached) {
      return { ...cached, cacheHit: true };
    }

    const optimized = {
      ...plan,
      strategy: {
        ...plan.strategy,
        executionMode: plan.strategy.parallelizable ? 'PARALLEL' : 'SERIAL'
      },
      cacheHit: false
    };
    cacheEngine.setQueryPlan(cacheKey, optimized);
    return optimized;
  }
}

module.exports = { QueryOptimizer };
