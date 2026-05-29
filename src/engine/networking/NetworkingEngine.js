const EventEmitter = require('node:events');

class NetworkingEngine extends EventEmitter {
  constructor() {
    super();
    this.transports = {
      rest: 'express',
      realtime: 'websocket',
      internalPubSub: 'redis'
    };
    this.started = false;
  }

  start() {
    this.started = true;
    this.emit('started', this.transports);
    return this.transports;
  }

  stop() {
    this.started = false;
    this.emit('stopped');
  }
}

module.exports = { NetworkingEngine };
