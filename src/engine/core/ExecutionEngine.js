function matches(record, conditions = []) {
  return conditions.every(({ field, operator, value }) => {
    const current = record[field];
    if (operator === '=') return current === value;
    if (operator === '!=') return current !== value;
    if (operator === '>') return current > value;
    if (operator === '<') return current < value;
    if (operator === '>=') return current >= value;
    if (operator === '<=') return current <= value;
    return false;
  });
}

function applyAggregates(rows, columns, groupBy) {
  if (!groupBy) return rows;
  const groups = new Map();
  for (const row of rows) {
    const key = row[groupBy];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const result = [];
  for (const [key, groupedRows] of groups.entries()) {
    const entry = { [groupBy]: key };
    for (const column of columns) {
      const normalized = column.toUpperCase();
      const count = normalized.match(/^COUNT\((\*|\w+)\)$/);
      const sum = normalized.match(/^SUM\((\w+)\)$/);
      if (count) {
        entry[column] = groupedRows.length;
      } else if (sum) {
        const target = sum[1].toLowerCase();
        entry[column] = groupedRows.reduce((acc, row) => acc + Number(row[target] ?? row[sum[1]] ?? 0), 0);
      }
    }
    result.push(entry);
  }
  return result;
}

class ExecutionEngine {
  execute(plan, storageEngine, cacheEngine, replicationEngine) {
    const { ast } = plan;
    const queryCacheKey = JSON.stringify(ast);

    if (ast.type === 'SELECT') {
      const cachedResult = cacheEngine.getQueryResult(queryCacheKey);
      if (cachedResult) return cachedResult;

      let rows = storageEngine.select(ast.table, ast.conditions, plan.strategy.index);
      if (ast.groupBy) {
        rows = applyAggregates(rows, ast.columns, ast.groupBy);
      } else if (!(ast.columns.length === 1 && ast.columns[0] === '*')) {
        rows = rows.map((row) => Object.fromEntries(ast.columns.map((col) => [col, row[col]])));
      }
      if (ast.orderBy) {
        const { field, direction } = ast.orderBy;
        rows = rows.sort((a, b) => {
          const delta = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0;
          return direction === 'DESC' ? -delta : delta;
        });
      }
      if (ast.limit !== null) {
        rows = rows.slice(0, ast.limit);
      }
      cacheEngine.setQueryResult(queryCacheKey, rows);
      return rows;
    }

    if (ast.type === 'INSERT') {
      const inserted = storageEngine.insert(ast.table, ast.record);
      cacheEngine.invalidateTable(ast.table);
      replicationEngine.publishChange('INSERT', ast.table, inserted);
      return inserted;
    }

    if (ast.type === 'UPDATE') {
      const updated = storageEngine.update(ast.table, ast.conditions, ast.updates);
      cacheEngine.invalidateTable(ast.table);
      replicationEngine.publishChange('UPDATE', ast.table, { updated });
      return { updated };
    }

    if (ast.type === 'DELETE') {
      const removed = storageEngine.delete(ast.table, ast.conditions);
      cacheEngine.invalidateTable(ast.table);
      replicationEngine.publishChange('DELETE', ast.table, { removed });
      return { removed };
    }

    throw new Error(`Unknown operation: ${ast.type}`);
  }

  static matches = matches;
}

module.exports = { ExecutionEngine };
