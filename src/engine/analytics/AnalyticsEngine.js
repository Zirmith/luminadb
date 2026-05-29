class AnalyticsEngine {
  constructor() {
    this.events = [];
  }

  track(eventName, payload = {}) {
    const event = {
      eventName,
      payload,
      timestamp: new Date().toISOString()
    };
    this.events.push(event);
    return event;
  }

  query(filter = {}) {
    return this.events.filter((event) => Object.entries(filter).every(([k, v]) => event[k] === v));
  }
}

module.exports = { AnalyticsEngine };
