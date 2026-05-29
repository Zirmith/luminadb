class ResultProcessor {
  process(result) {
    return {
      rows: Array.isArray(result) ? result : [result],
      rowCount: Array.isArray(result) ? result.length : 1,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { ResultProcessor };
