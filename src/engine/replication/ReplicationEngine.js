const EventEmitter = require('node:events');

class ReplicationEngine extends EventEmitter {
  constructor({ strategy = 'timestamp' } = {}) {
    super();
    this.strategy = strategy;
    this.events = [];
  }

  publishChange(type, table, payload) {
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      table,
      payload,
      timestamp: Date.now()
    };
    this.events.push(event);
    this.emit('change', event);
    return event;
  }

  resolveConflict(local, remote, priority = 'remote') {
    if (this.strategy === 'timestamp') {
      return local.timestamp >= remote.timestamp ? local : remote;
    }
    if (this.strategy === 'priority') {
      return priority === 'local' ? local : remote;
    }
    return { ...local, ...remote };
  }
}

module.exports = { ReplicationEngine };
