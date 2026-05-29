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

function splitCsv(input) {
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if ((char === '"' || char === "'") && input[i - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
    }
    if (char === ',' && !quote) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function splitByAnd(input) {
  const out = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if ((char === '"' || char === "'") && input[i - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
    }
    if (!quote && input.slice(i, i + 5).toUpperCase() === ' AND ') {
      out.push(current.trim());
      current = '';
      i += 4;
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function parseCondition(segment) {
  const operators = ['>=', '<=', '!=', '=', '>', '<'];
  for (const operator of operators) {
    const index = segment.indexOf(operator);
    if (index > 0) {
      const field = segment.slice(0, index).trim();
      const value = normalizeValue(segment.slice(index + operator.length));
      if (!field) break;
      return { field, operator, value };
    }
  }
  throw new Error(`Unsupported WHERE condition: ${segment}`);
}

function parseConditions(whereClause) {
  if (!whereClause) return [];
  return splitByAnd(whereClause).map(parseCondition);
}

function parseAssignments(setClause) {
  return splitCsv(setClause).map((pair) => {
    const idx = pair.indexOf('=');
    const field = pair.slice(0, idx).trim();
    const value = normalizeValue(pair.slice(idx + 1));
    return { field, value };
  });
}

function parseSelect(sql) {
  const fromIndex = sql.toUpperCase().indexOf(' FROM ');
  if (fromIndex === -1) return null;

  const columnsPart = sql.slice(7, fromIndex).trim();
  let rest = sql.slice(fromIndex + 6).trim();

  const clauseNames = [' WHERE ', ' GROUP BY ', ' ORDER BY ', ' LIMIT ', ' /*+ INDEX('];
  const restUpper = rest.toUpperCase();
  let splitAt = rest.length;
  for (const clause of clauseNames) {
    const idx = restUpper.indexOf(clause);
    if (idx >= 0 && idx < splitAt) splitAt = idx;
  }

  const table = rest.slice(0, splitAt).trim();
  rest = rest.slice(splitAt);

  let where = null;
  let groupBy = null;
  let orderBy = null;
  let limit = null;
  let indexHint = null;

  while (rest.length) {
    const upper = rest.toUpperCase();
    if (upper.startsWith(' WHERE ')) {
      rest = rest.slice(7);
      const next = [' GROUP BY ', ' ORDER BY ', ' LIMIT ', ' /*+ INDEX(']
        .map((k) => rest.toUpperCase().indexOf(k))
        .filter((v) => v >= 0);
      const end = next.length ? Math.min(...next) : rest.length;
      where = rest.slice(0, end).trim();
      rest = rest.slice(end);
      continue;
    }
    if (upper.startsWith(' GROUP BY ')) {
      rest = rest.slice(10);
      const next = [' ORDER BY ', ' LIMIT ', ' /*+ INDEX(']
        .map((k) => rest.toUpperCase().indexOf(k))
        .filter((v) => v >= 0);
      const end = next.length ? Math.min(...next) : rest.length;
      groupBy = rest.slice(0, end).trim();
      rest = rest.slice(end);
      continue;
    }
    if (upper.startsWith(' ORDER BY ')) {
      rest = rest.slice(10);
      const next = [' LIMIT ', ' /*+ INDEX(']
        .map((k) => rest.toUpperCase().indexOf(k))
        .filter((v) => v >= 0);
      const end = next.length ? Math.min(...next) : rest.length;
      const orderRaw = rest.slice(0, end).trim();
      rest = rest.slice(end);
      const [field, dir] = orderRaw.split(/\s+/);
      orderBy = { field, direction: (dir || 'ASC').toUpperCase() };
      continue;
    }
    if (upper.startsWith(' LIMIT ')) {
      rest = rest.slice(7);
      const next = rest.toUpperCase().indexOf(' /*+ INDEX(');
      const limitRaw = next >= 0 ? rest.slice(0, next).trim() : rest.trim();
      rest = next >= 0 ? rest.slice(next) : '';
      limit = Number(limitRaw);
      continue;
    }
    if (upper.startsWith(' /*+ INDEX(')) {
      const close = rest.indexOf(')');
      indexHint = rest.slice(11, close).trim();
      rest = '';
      continue;
    }
    break;
  }

  return {
    type: 'SELECT',
    table,
    columns: columnsPart === '*' ? ['*'] : splitCsv(columnsPart),
    conditions: parseConditions(where),
    groupBy: groupBy || null,
    orderBy,
    limit: Number.isFinite(limit) ? limit : null,
    indexHint
  };
}

class QueryParser {
  parse(query) {
    const sql = query.trim().replace(/\s+/g, ' ');
    const upper = sql.toUpperCase();

    if (upper.startsWith('SELECT ')) {
      const parsed = parseSelect(sql);
      if (parsed) return parsed;
    }

    if (upper.startsWith('INSERT INTO ')) {
      const body = sql.slice(12).trim();
      const open = body.indexOf('(');
      const close = body.indexOf(')', open + 1);
      const table = body.slice(0, open).trim();
      const columns = splitCsv(body.slice(open + 1, close));
      const valuesKeyword = body.toUpperCase().indexOf(' VALUES ', close);
      const valuesOpen = body.indexOf('(', valuesKeyword);
      const valuesClose = body.lastIndexOf(')');
      const values = splitCsv(body.slice(valuesOpen + 1, valuesClose)).map(normalizeValue);
      const record = Object.fromEntries(columns.map((col, idx) => [col, values[idx]]));
      return { type: 'INSERT', table, record };
    }

    if (upper.startsWith('UPDATE ')) {
      const setIndex = upper.indexOf(' SET ');
      const whereIndex = upper.indexOf(' WHERE ');
      const table = sql.slice(7, setIndex).trim();
      const setClause = whereIndex === -1 ? sql.slice(setIndex + 5) : sql.slice(setIndex + 5, whereIndex);
      const where = whereIndex === -1 ? null : sql.slice(whereIndex + 7);
      return {
        type: 'UPDATE',
        table,
        updates: parseAssignments(setClause),
        conditions: parseConditions(where)
      };
    }

    if (upper.startsWith('DELETE FROM ')) {
      const whereIndex = upper.indexOf(' WHERE ');
      const table = whereIndex === -1 ? sql.slice(12).trim() : sql.slice(12, whereIndex).trim();
      const where = whereIndex === -1 ? null : sql.slice(whereIndex + 7);
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
