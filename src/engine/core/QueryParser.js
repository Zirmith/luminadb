function normalizeValue(raw) {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  if (!Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}

function parseConditions(whereClause) {
  if (!whereClause) return [];
  return whereClause
    .split(/\s+AND\s+/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const match = segment.match(/^(\w+)\s*(=|!=|>=|<=|>|<)\s*(.+)$/);
      if (!match) {
        throw new Error(`Unsupported WHERE condition: ${segment}`);
      }
      return {
        field: match[1],
        operator: match[2],
        value: normalizeValue(match[3])
      };
    });
}

function parseAssignments(setClause) {
  return setClause.split(',').map((pair) => {
    const [field, raw] = pair.split('=').map((p) => p.trim());
    return { field, value: normalizeValue(raw) };
  });
}

class QueryParser {
  parse(query) {
    const sql = query.trim().replace(/\s+/g, ' ');

    let match = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+GROUP\s+BY\s+(\w+))?(?:\s+ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?(?:\s+\/\*\+\s*INDEX\((\w+)\)\s*\*\/)?$/i);
    if (match) {
      const [, columns, table, where, groupBy, orderField, orderDirection, limit, indexHint] = match;
      return {
        type: 'SELECT',
        table,
        columns: columns.trim() === '*' ? ['*'] : columns.split(',').map((c) => c.trim()),
        conditions: parseConditions(where),
        groupBy: groupBy || null,
        orderBy: orderField ? { field: orderField, direction: (orderDirection || 'ASC').toUpperCase() } : null,
        limit: limit ? Number(limit) : null,
        indexHint: indexHint || null
      };
    }

    match = sql.match(/^INSERT\s+INTO\s+(\w+)\s*\((.+)\)\s*VALUES\s*\((.+)\)$/i);
    if (match) {
      const [, table, columns, values] = match;
      const parsedColumns = columns.split(',').map((c) => c.trim());
      const parsedValues = values.split(',').map((v) => normalizeValue(v));
      const record = Object.fromEntries(parsedColumns.map((col, idx) => [col, parsedValues[idx]]));
      return { type: 'INSERT', table, record };
    }

    match = sql.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
    if (match) {
      const [, table, setClause, where] = match;
      return {
        type: 'UPDATE',
        table,
        updates: parseAssignments(setClause),
        conditions: parseConditions(where)
      };
    }

    match = sql.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
    if (match) {
      const [, table, where] = match;
      return {
        type: 'DELETE',
        table,
        conditions: parseConditions(where)
      };
    }

    throw new Error(`Unsupported LuminaQL query: ${query}`);
  }
}

module.exports = { QueryParser };
