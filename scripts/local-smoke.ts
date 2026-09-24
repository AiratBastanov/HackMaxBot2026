import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';
import { lifecycle, callback, reply, encode, ACTOR } from '../tests/fixtures.js';

const config = loadConfig(process.env);
if (config.mode !== 'local' || !config.testers.has(ACTOR)) throw new Error('Smoke разрешён только для синтетического local');
const origin = `http://127.0.0.1:${config.port}`;
const db = new Database(config.databasePath, { readonly: true });
const waitUntil = async <T>(fn: () => T | undefined): Promise<T> => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); }
  throw new Error('Smoke: время ожидания исчерпано');
};
const post = async (value: unknown) => {
  const r = await fetch(`${origin}/webhooks/max`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': config.webhookSecret! }, body: encode(value), signal: AbortSignal.timeout(5000) });
  assert.equal(r.status, 200); return r.json() as Promise<{ status: string }>;
};
type Probe = { id: string; state: string; question_mid: string | null };
try {
  const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200); assert.equal((await health.json() as { mode: string }).mode, 'local');
  if (process.argv.includes('--verify-restart')) {
    const p = db.prepare("SELECT id,state,question_mid FROM probes WHERE actor=? AND state='COMPLETE' ORDER BY created_at DESC LIMIT 1").get(ACTOR) as Probe | undefined;
    assert(p?.question_mid); console.log(JSON.stringify({ check: 'local_restart_persistence', result: 'PASS', realMax: false }));
  } else {
    const timestamp = Date.now(); const start = lifecycle('bot_started', timestamp);
    assert.equal((await post(start)).status, 'accepted'); assert.equal((await post(start)).status, 'duplicate');
    const p = await waitUntil(() => db.prepare('SELECT id,state,question_mid FROM probes WHERE actor=? AND created_at>=? ORDER BY created_at DESC LIMIT 1').get(ACTOR, timestamp) as Probe | undefined);
    await post(callback(p.id, `synthetic-${timestamp}`, ACTOR));
    const question = await waitUntil(() => { const v = db.prepare('SELECT id,state,question_mid FROM probes WHERE id=?').get(p.id) as Probe; return v.state === 'WAITING_REPLY' ? v : undefined; });
    await post(reply(question.question_mid!, Date.now(), 'готово', ACTOR, `synthetic-reply-${timestamp}`));
    await waitUntil(() => (db.prepare('SELECT state FROM probes WHERE id=?').get(p.id) as Probe).state === 'COMPLETE' || undefined);
    console.log(JSON.stringify({ check: 'local_http_probe', assertions: ['health', 'durable_acceptance', 'duplicate', 'callback', 'question', 'linked_reply'], result: 'PASS', realMax: false }));
  }
} finally { db.close(); }
