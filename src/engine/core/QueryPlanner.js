class QueryPlanner {
  createPlan(ast, storageEngine) {
    const indexes = storageEngine.getIndexes(ast.table);
    const matchedIndex = ast.indexHint || ast.conditions?.find((condition) => indexes.has(condition.field))?.field || null;
    return {
      operation: ast.type,
      table: ast.table,
      ast,
      strategy: {
        accessPath: matchedIndex ? 'INDEX_SCAN' : 'TABLE_SCAN',
        index: matchedIndex,
        parallelizable: ast.type === 'SELECT' && !ast.groupBy
      },
      estimatedCost: matchedIndex ? 1 : 5
    };
  }
}

module.exports = { QueryPlanner };
