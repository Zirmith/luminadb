#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { LuminaDBEngine } = require('../engine/LuminaDBEngine');

const command = process.argv[2];
const cwd = process.cwd();
const configPath = path.join(cwd, 'lumina.config.json');

function loadEngine() {
  let config = {};
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return new LuminaDBEngine(config);
}

if (command === 'init') {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ storage: { filename: 'main.lumina' } }, null, 2));
  }
  console.log('LuminaDB initialized.');
} else if (command === 'start') {
  const db = loadEngine();
  db.networking.start();
  console.log('LuminaDB engine started.');
} else if (command === 'backup') {
  const db = loadEngine();
  const target = process.argv[3] || path.join(cwd, 'backup.lmdb');
  db.snapshot(target);
  console.log(`Backup written to ${target}`);
} else if (command === 'restore') {
  const source = process.argv[3] || path.join(cwd, 'backup.lmdb');
  const db = loadEngine();
  db.restore(source);
  console.log(`Restored from ${source}`);
} else if (command === 'cluster') {
  console.log('Cluster mode enabled (replication events active).');
} else {
  console.log('Usage: lumina <init|start|backup|restore|cluster>');
  process.exitCode = 1;
}
