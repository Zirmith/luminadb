class SchemaEngine {
  constructor(storageEngine) {
    this.storageEngine = storageEngine;
    this.schemas = new Map();
  }

  define(table, schema) {
    this.schemas.set(table, schema);
    this.storageEngine.createTable(table, schema);
  }

  validate(table, record) {
    const schema = this.schemas.get(table);
    if (!schema || !schema.fields) return true;
    for (const [field, type] of Object.entries(schema.fields)) {
      const value = record[field];
      if (value == null) continue;
      if (type === 'number' && typeof value !== 'number') return false;
      if (type === 'string' && typeof value !== 'string') return false;
      if (type === 'boolean' && typeof value !== 'boolean') return false;
    }
    return true;
  }
}

module.exports = { SchemaEngine };
