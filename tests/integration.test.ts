import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Storage, type ProbeRow } from '../src/storage.js';
import { MaxError, type MaxTransport, type MaxOperation } from '../src/max.js';
import { ACTOR, OTHER, CHAT, SECRET, encode, lifecycle, callback, reply } from './fixtures.js';

function setup(t: TestContext, transport?: MaxTransport) {
  const root = resolve('.tmp/tests'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(resolve(root, 'g1-'));
  let now = Date.now();
  const config = loadConfig({ APP_MODE: 'local', DATABASE_PATH: resolve(dir, 'probe.sqlite'), MAX_WEBHOOK_SECRET: SECRET, PROBE_TESTER_IDS: `${ACTOR},${OTHER}` });
  let runtime = createApp(config, { clock: () => now, transport });
  t.after(async () => { await runtime.app.close(); if (!dir.startsWith(root + sep)) throw new Error('unsafe_cleanup'); rmSync(dir, { recursive: true }); });
  return {
    get runtime() { return runtime; }, config,
    now: () => now, advance: (ms: number) => { now += ms; },
    post: (body: unknown, headers: Record<string, string> = {}) => runtime.app.inject({ method: 'POST', url: '/webhooks/max', payload: typeof body === 'string' ? body : encode(body), headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': SECRET, ...headers } }),
    async restart() { await runtime.app.close(); runtime = createApp(config, { clock: () => now, transport }); },
    async enter(actor = ACTOR) { await this.post(lifecycle('bot_started', now, actor)); await runtime.worker.tick(); return runtime.store.latestProbe(actor)!; },
    async question() { const p = await this.enter(); await this.post(callback(p.id, 'cb-question', ACTOR, now)); await runtime.worker.tick(); await runtime.worker.tick(); return runtime.store.probe(p.id)!; },
  };
}
const count = (store: Storage, table: 'inbox' | 'outbox' | 'probes') => (store.db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

test('200 выдаётся после commit SQLite; приём не запускает сеть и обработку', async t => {
  let calls = 0; const s = setup(t, { execute: async () => { calls++; return { simulated: true, mid: 'synthetic' }; } });
  const r = await s.post(lifecycle('bot_started', s.now())); assert.equal(r.statusCode, 200); assert.equal(r.json().status, 'accepted');
  assert.equal(calls, 0); assert.equal(count(s.runtime.store, 'inbox'), 1); assert.equal(count(s.runtime.store, 'probes'), 0);
  await s.restart(); assert.equal(count(s.runtime.store, 'inbox'), 1); await s.runtime.worker.tick(); assert.equal(calls, 1);
});
test('Повтор доставки не создаёт вторую команду/outbox, даже после restart', async t => {
  const s = setup(t); const event = lifecycle('bot_started', s.now()); await s.post(event); await s.runtime.worker.tick(); await s.restart();
  const duplicate = await s.post(event); assert.equal(duplicate.json().status, 'duplicate'); await s.runtime.worker.tick();
  assert.equal(count(s.runtime.store, 'probes'), 1); assert.equal(count(s.runtime.store, 'outbox'), 1);
});
test('Полный синтетический probe: кнопка, отдельный вопрос, reply, restart', async t => {
  const s = setup(t); const p = await s.question(); assert.equal(p.state, 'WAITING_REPLY'); assert(p.question_mid?.startsWith('synthetic-'));
  await s.restart(); const r = await s.post(reply(p.question_mid!, s.now())); assert.equal(r.statusCode, 200); await s.runtime.worker.tick();
  assert.equal(s.runtime.store.probe(p.id)?.state, 'COMPLETE');
  const out = s.runtime.store.db.prepare('SELECT status FROM outbox').all() as { status: string }[]; assert(out.every(r => r.status === 'SIMULATED'));
});
test('HTTP boundary сохраняет int64 до JSON number, проверяет health и SQLite', async t => {
  const s = setup(t); await s.runtime.app.listen({ port: 0, host: '127.0.0.1' });
  const address = s.runtime.app.server.address(); assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  const raw = encode(lifecycle('bot_started', s.now())); assert(raw.includes(`"user_id":${ACTOR}`));
  const r = await fetch(`${origin}/webhooks/max`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': SECRET }, body: raw });
  assert.equal(r.status, 200); await s.runtime.worker.tick();
  const p = s.runtime.store.latestProbe(ACTOR)!; assert.equal(p.actor, ACTOR); assert.equal(p.chat, CHAT);
  const stored = s.runtime.store.db.prepare('SELECT payload FROM inbox').get() as { payload: string }; assert(stored.payload.includes(ACTOR)); assert(!stored.payload.includes('first_name'));
});
test('Неверный секрет, JSON, структура, envelope и размер отклоняются', async t => {
  const s = setup(t);
  assert.equal((await s.post(lifecycle(), { 'x-max-bot-api-secret': 'wrong' })).statusCode, 401);
  for (const body of ['{', '{}', '{"updates":[]}', '{"update_type":"bot_started","timestamp":1}', '{"update_type":"unknown","timestamp":"1"}']) assert.equal((await s.post(body)).statusCode, 400);
  assert.equal((await s.post('x'.repeat(65537))).statusCode, 413);
  assert.equal(count(s.runtime.store, 'inbox'), 0);
});
test('Корректный нерелевантный тип и посторонний тестировщик безопасно игнорируются', async t => {
  const s = setup(t);
  assert.equal((await s.post({ update_type: 'future_event', timestamp: s.now() })).json().status, 'ignored');
  assert.equal((await s.post(lifecycle('bot_started', s.now(), '123'))).json().status, 'ignored');
  assert.equal(count(s.runtime.store, 'inbox'), 0);
});
test('Реальный отказ SQLite (query_only) даёт 503, затем повтор можно принять', async t => {
  const s = setup(t); const event = lifecycle('bot_started', s.now()); s.runtime.store.db.pragma('query_only = ON');
  assert.equal((await s.post(event)).statusCode, 503); assert.equal(count(s.runtime.store, 'inbox'), 0);
  s.runtime.store.db.pragma('query_only = OFF'); assert.equal((await s.post(event)).json().status, 'accepted');
});
test('Блокировка записи другой SQLite connection даёт ограниченный 503', async t => {
  const s = setup(t); const other = new Storage(s.config.databasePath, s.config);
  other.db.exec('BEGIN IMMEDIATE'); const start = Date.now();
  try { assert.equal((await s.post(lifecycle('bot_started', s.now()))).statusCode, 503); assert(Date.now()-start < 2500); }
  finally { other.db.exec('ROLLBACK'); other.close(); }
});
test('Чужой actor не исполняет команду и не изменяет чужой probe', async t => {
  const s = setup(t); const p = await s.enter(); await s.enter(OTHER);
  await s.post(callback(p.id, 'wrong-actor', OTHER, s.now())); await s.runtime.worker.tick();
  assert.equal(s.runtime.store.probe(p.id)?.state, 'BUTTON');
  const row = s.runtime.store.db.prepare("SELECT result FROM inbox WHERE kind='message_callback'").get() as { result: string }; assert.equal(row.result, 'WRONG_ACTOR');
});
test('Новый callback со старой кнопки отвергается; одинаковый callback дедуплицируется', async t => {
  const s = setup(t); const p = await s.question();
  assert.equal((await s.post(callback(p.id, 'cb-question', ACTOR, s.now()))).json().status, 'duplicate');
  await s.post(callback(p.id, 'cb-new-id', ACTOR, s.now())); await s.runtime.worker.tick();
  assert.equal(s.runtime.store.probe(p.id)?.state, 'WAITING_REPLY');
  assert.equal((s.runtime.store.db.prepare("SELECT count(*) n FROM outbox WHERE purpose='question'").get() as { n: number }).n, 1);
  assert.equal((s.runtime.store.db.prepare("SELECT result FROM inbox ORDER BY id DESC LIMIT 1").get() as { result: string }).result, 'REPEATED_COMMAND');
});
test('Равенство expiry запрещает команду; старый ack не продлевает срок', async t => {
  const s = setup(t); const p = await s.enter(); await s.post(callback(p.id, 'expires', ACTOR, s.now())); s.advance(s.config.probeTtlMs);
  await s.runtime.worker.tick(); assert.equal(s.runtime.store.probe(p.id)?.state, 'BUTTON');
  assert.equal((s.runtime.store.db.prepare("SELECT result FROM inbox ORDER BY id DESC LIMIT 1").get() as { result: string }).result, 'EXPIRED_COMMAND');
});
test('Текст без нужного reply и ответ на другой вопрос не завершают probe', async t => {
  const s = setup(t); const p = await s.question();
  for (const [index, mid] of [undefined, 'unrelated-question'].entries()) {
    await s.post(reply(mid, s.now(), 'готово', ACTOR, `reply-${index}`)); await s.runtime.worker.tick();
    assert.equal(s.runtime.store.probe(p.id)?.state, 'WAITING_REPLY');
  }
  assert.equal((s.runtime.store.db.prepare("SELECT count(*) n FROM outbox WHERE purpose='guidance'").get() as { n: number }).n, 2);
});
test('Повторный вход заменяет старый probe; произвольный deep-link payload не создаёт продукт', async t => {
  const s = setup(t); const p = await s.enter(); s.advance(1); const next = await s.enter(); assert.notEqual(next.id, p.id);
  assert.equal(s.runtime.store.probe(p.id)?.state, 'SUPERSEDED');
  s.advance(1); await s.post({ ...lifecycle('bot_started', s.now()), payload: 'meeting-never-created' }); await s.runtime.worker.tick();
  assert.equal(count(s.runtime.store, 'probes'), 2);
});
test('Lifecycle: поздний stop не отменяет новый start; равные конфликтные timestamps запрещают исходящие', async t => {
  const s = setup(t); const base = s.now();
  await s.post(lifecycle('bot_started', base)); await s.post(lifecycle('bot_stopped', base-1)); await s.runtime.worker.tick();
  assert.equal(s.runtime.store.contact(ACTOR)?.access_mask, 1);
  await s.post(lifecycle('dialog_removed', base)); await s.runtime.worker.tick(); assert.equal(s.runtime.store.contact(ACTOR)?.access_mask, 3);
  await s.post(lifecycle('dialog_cleared', base+1)); await s.post(lifecycle('dialog_muted', base+2)); await s.post(lifecycle('dialog_unmuted', base+2)); await s.runtime.worker.tick();
  assert.equal(s.runtime.store.contact(ACTOR)?.access_mask, 3); assert.equal(s.runtime.store.contact(ACTOR)?.mute_mask, 3);
  assert.equal(s.runtime.store.contact(ACTOR)?.clear_ts, base+1);
});
test('Остановка до отправки подавляет outbox; start не оживляет прежнюю отправку', async t => {
  const s = setup(t); await s.post(lifecycle('bot_started', s.now())); await s.post(lifecycle('bot_stopped', s.now()+1)); await s.runtime.worker.tick();
  const row = s.runtime.store.db.prepare('SELECT status FROM outbox').get() as { status: string }; assert.equal(row.status, 'SUPPRESSED_CONTACT');
  s.advance(2); await s.enter(); assert.equal((s.runtime.store.db.prepare('SELECT status FROM outbox ORDER BY id LIMIT 1').get() as { status: string }).status, 'SUPPRESSED_CONTACT');
});
test('Сеть не выполняется внутри транзакции; 200/success:false не отменяет результат команды', async t => {
  let store: Storage; const transport: MaxTransport = { execute: async op => { assert.equal(store.db.inTransaction, false); if (op.method === 'answers') throw new MaxError('SEMANTIC', 200); return { simulated: true, mid: 'synthetic-question' }; } };
  const s = setup(t, transport); store = s.runtime.store; const p = await s.question(); assert.equal(p.state, 'WAITING_REPLY');
  assert.equal((store.db.prepare("SELECT status FROM outbox WHERE purpose='callback_answer'").get() as { status: string }).status, 'FAILED_SEMANTIC');
});
test('401 сохраняет остановку отправок через restart', async t => {
  let calls = 0; const s = setup(t, { execute: async () => { calls++; throw new MaxError('AUTH', 401); } });
  await s.enter(); assert.equal(s.runtime.store.getMeta('auth_blocked'), 'true'); await s.restart(); s.advance(1); await s.enter(); assert.equal(calls, 1);
});
test('429 повторяется максимум три раза с задержкой; другие ошибки не маскируются', async t => {
  let calls = 0; const s = setup(t, { execute: async () => { calls++; throw new MaxError('RATE_LIMIT', 429, 5000); } });
  await s.enter(); await s.runtime.worker.tick(); assert.equal(calls, 1);
  s.advance(4999); await s.runtime.worker.tick(); assert.equal(calls, 1);
  s.advance(1); await s.runtime.worker.tick(); s.advance(5000); await s.runtime.worker.tick(); s.advance(10000); await s.runtime.worker.tick();
  assert.equal(calls, 3); assert.equal((s.runtime.store.db.prepare('SELECT status FROM outbox').get() as { status: string }).status, 'FAILED_RATE_LIMIT');
});
test('Неоднозначный timeout не повторяется и не создаёт question_mid', async t => {
  let calls = 0; const s = setup(t, { execute: async () => { calls++; throw new MaxError('TIMEOUT_AMBIGUOUS'); } });
  await s.enter(); await s.restart(); await s.runtime.worker.tick(); assert.equal(calls, 1);
  assert.equal((s.runtime.store.db.prepare('SELECT status FROM outbox').get() as { status: string }).status, 'UNKNOWN_RESULT');
});
test('Crash с SENDING сохраняет UNKNOWN_RESULT вместо повторной отправки', async t => {
  const s = setup(t); await s.enter(); s.runtime.store.db.prepare("UPDATE outbox SET status='SENDING'").run();
  await s.restart(); await s.runtime.worker.tick();
  assert.equal((s.runtime.store.db.prepare('SELECT result FROM outbox').get() as { result: string }).result, 'RESTART_DURING_SEND');
});
test('Локальную SQLite нельзя подключить как live или как другого бота', async t => {
  const s = setup(t); assert.throws(() => new Storage(s.config.databasePath, { mode: 'live', botId: '777' }));
});
