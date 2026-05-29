const crypto = require('node:crypto');

class SecurityEngine {
  constructor({ encryptionKey, apiKeys = new Set() } = {}) {
    this.encryptionKey = encryptionKey || crypto.randomBytes(32);
    this.apiKeys = apiKeys;
    this.auditLog = [];
    this.roles = new Map();
  }

  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(payload) {
    const [ivHex, encryptedHex] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, Buffer.from(ivHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  registerApiKey(key) {
    this.apiKeys.add(key);
  }

  validateApiKey(key) {
    const valid = this.apiKeys.has(key);
    this.log('api_key_check', { keySuffix: key.slice(-4), valid });
    return valid;
  }

  setRole(identity, role) {
    this.roles.set(identity, role);
  }

  authorize(identity, requiredRole) {
    const role = this.roles.get(identity);
    const allowed = role === requiredRole || role === 'admin';
    this.log('rbac_check', { identity, requiredRole, role, allowed });
    return allowed;
  }

  log(event, context) {
    this.auditLog.push({ event, context, at: new Date().toISOString() });
  }
}

module.exports = { SecurityEngine };
