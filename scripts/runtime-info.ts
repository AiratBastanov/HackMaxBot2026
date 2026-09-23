import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
const config = loadConfig(process.env);
const db = new Database(config.databasePath, { readonly: true });
try {
  console.log(JSON.stringify({ operation: 'runtime_info', uid: process.getuid?.() ?? 'windows-user', node: process.version,
    sqlite: (db.prepare('SELECT sqlite_version() version').get() as { version: string }).version, mode: config.mode }));
} finally { db.close(); }
