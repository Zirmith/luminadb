const fs = require('node:fs');
const path = require('node:path');
const { ExecutionEngine } = require('../core/ExecutionEngine');

class StorageEngine {
  constructor({ dataDir = process.cwd(), filename = 'data.lumina' } = {}) {
    this.dataDir = dataDir;
    this.filename = filename;
    this.filePath = path.join(this.dataDir, this.filename);
    this.tables = new Map();
    this.indexes = new Map();
    this.wal = [];
  }

  createTable(table, { primaryKey = 'id' } = {}) {
    if (!this.tables.has(table)) {
      this.tables.set(table, { rows: [], nextId: 1, primaryKey });
      this.indexes.set(table, new Map());
    }
  }

  ensureTable(table) {
    if (!this.tables.has(table)) {
      this.createTable(table);
    }
  }

  createIndex(table, field) {
    this.ensureTable(table);
    const tableIndexes = this.indexes.get(table);
    if (tableIndexes.has(field)) return;
    const map = new Map();
    const rows = this.tables.get(table).rows;
    rows.forEach((row, idx) => {
      const value = row[field];
      if (!map.has(value)) map.set(value, new Set());
      map.get(value).add(idx);
    });
    tableIndexes.set(field, map);
  }

  getIndexes(table) {
    return this.indexes.get(table) || new Map();
  }

  serializeRecord(record) {
    return Buffer.from(JSON.stringify(record));
  }

  insert(table, record) {
    this.ensureTable(table);
    const tableData = this.tables.get(table);
    const primaryKey = tableData.primaryKey;
    const row = { ...record };
    if (row[primaryKey] == null) {
      row[primaryKey] = tableData.nextId++;
    }

    tableData.rows.push(row);
    this.rebuildIndexes(table);
    this.journal({ op: 'INSERT', table, row });
    return row;
  }

  select(table, conditions = [], preferredIndex = null) {
    this.ensureTable(table);
    const rows = this.tables.get(table).rows;
    if (!conditions.length) {
      return rows.map((row) => ({ ...row }));
    }

    let sourceRows = rows;
    if (preferredIndex) {
      const index = this.indexes.get(table)?.get(preferredIndex);
      const condition = conditions.find((item) => item.field === preferredIndex && item.operator === '=');
      if (index && condition) {
        const candidates = index.get(condition.value) || new Set();
        sourceRows = Array.from(candidates).map((i) => rows[i]).filter(Boolean);
      }
    }

    return sourceRows.filter((row) => ExecutionEngine.matches(row, conditions)).map((row) => ({ ...row }));
  }

  update(table, conditions, updates) {
    this.ensureTable(table);
    const rows = this.tables.get(table).rows;
    let count = 0;
    rows.forEach((row) => {
      if (ExecutionEngine.matches(row, conditions)) {
        updates.forEach(({ field, value }) => {
          row[field] = value;
        });
        count += 1;
      }
    });
    this.rebuildIndexes(table);
    this.journal({ op: 'UPDATE', table, conditions, updates, count });
    return count;
  }

  delete(table, conditions) {
    this.ensureTable(table);
    const tableData = this.tables.get(table);
    const kept = [];
    let removed = 0;
    tableData.rows.forEach((row) => {
      if (ExecutionEngine.matches(row, conditions)) {
        removed += 1;
      } else {
        kept.push(row);
      }
    });
    tableData.rows = kept;
    this.rebuildIndexes(table);
    this.journal({ op: 'DELETE', table, conditions, removed });
    return removed;
  }

  rebuildIndexes(table) {
    const fields = Array.from(this.indexes.get(table)?.keys() || []);
    this.indexes.set(table, new Map());
    fields.forEach((field) => this.createIndex(table, field));
  }

  journal(entry) {
    this.wal.push({ ...entry, timestamp: Date.now() });
  }

  checkpoint() {
    this.snapshot(this.filePath);
    this.wal = [];
  }

  compact() {
    for (const [table, tableData] of this.tables.entries()) {
      tableData.rows = tableData.rows.filter(Boolean);
      this.tables.set(table, tableData);
    }
  }

  snapshot(filePath = this.filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = {
      version: 1,
      tables: structuredClone(Array.from(this.tables.entries())),
      indexes: Array.from(this.indexes.entries()).map(([table, idxMap]) => [
        table,
        Array.from(idxMap.entries()).map(([field, valueMap]) => [
          field,
          Array.from(valueMap.entries()).map(([key, set]) => [key, Array.from(set)])
        ])
      ]),
      wal: this.wal
    };
    fs.writeFileSync(filePath, Buffer.from(JSON.stringify(payload)));
  }

  load(filePath = this.filePath) {
    if (!fs.existsSync(filePath)) return;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    this.tables = new Map(payload.tables || []);
    this.indexes = new Map(
      (payload.indexes || []).map(([table, idxEntries]) => [
        table,
        new Map(
          idxEntries.map(([field, values]) => [
            field,
            new Map(values.map(([value, setValues]) => [value, new Set(setValues)]))
          ])
        )
      ])
    );
    this.wal = payload.wal || [];
  }

  cloneState() {
    return {
      tables: structuredClone(Array.from(this.tables.entries())),
      indexes: Array.from(this.indexes.entries()).map(([table, idxMap]) => [
        table,
        Array.from(idxMap.entries()).map(([field, valueMap]) => [
          field,
          Array.from(valueMap.entries()).map(([value, set]) => [value, Array.from(set)])
        ])
      ]),
      wal: structuredClone(this.wal)
    };
  }

  restoreState(state) {
    this.tables = new Map(state.tables || []);
    this.indexes = new Map(
      (state.indexes || []).map(([table, idxEntries]) => [
        table,
        new Map(
          idxEntries.map(([field, values]) => [
            field,
            new Map(values.map(([value, setValues]) => [value, new Set(setValues)]))
          ])
        )
      ])
    );
    this.wal = state.wal || [];
  }
}

module.exports = { StorageEngine };
