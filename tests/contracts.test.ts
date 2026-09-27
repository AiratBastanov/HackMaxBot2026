import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadConfig } from '../src/config.js';
import { int64, lifecycleTypes, parseJson, parseUpdate } from '../src/contracts.js';
import { LiveMax, LocalMax, MaxError } from '../src/max.js';
import { ACTOR, CHAT, SECRET, encode, lifecycle, message, reply } from './fixtures.js';

const config = loadConfig({ APP_MODE: 'live', DATABASE_PATH: ':memory:', MAX_WEBHOOK_SECRET: SECRET, PROBE_TESTER_IDS: ACTOR,
  MAX_BOT_TOKEN: 'synthetic-contract-token', MAX_EXPECTED_BOT_ID: '777', PUBLIC_BASE_URL: 'https://probe.example.org', LIVE_SCOPE_CONFIRMED: 'true', MAX_REQUEST_TIMEOUT_MS: '100' });
const operation = { method: 'answers' as const, callbackId: 'synthetic', body: { notification: 'Тест' } };
function client(body: unknown, status = 200, headers?: HeadersInit) {
  return new LiveMax(config, (async () => new Response(typeof body === 'string' ? body : encode(body), { status, headers })) as typeof fetch);
}
test('Парсер сохраняет верхнюю и нижнюю границы int64; строки/fraction/exponent отвергаются', () => {
  for (const v of ['9223372036854775807', '-9223372036854775808', ACTOR]) assert.equal(int64.parse(parseJson(v)), v);
  for (const v of ['9223372036854775808', '1.2', '1e3', '"123"']) assert.throws(() => int64.parse(parseJson(v)));
});
test('Повреждённый JSON, конфликтующие ключи, prototype и чрезмерная вложенность отвергаются', () => {
  for (const value of ['{', '{"a":1,"a":2}', '{"__proto__":{"x":1}}', '{"constructor":1}', '['.repeat(40)+'0'+']'.repeat(40)]) assert.throws(() => parseJson(value));
});
test('Webhook не принимает Long Polling envelope', () => assert.throws(() => parseUpdate(parseJson('{"updates":[],"marker":0}'), '777')));
test('Все шесть lifecycle подтипов распознаются с документированными user/chat_id', () => {
  for (const kind of lifecycleTypes) {
    const event = parseUpdate(parseJson(encode(lifecycle(kind))), '777'); assert(!event.ignored);
    assert.equal(event.event.actor, ACTOR); assert.equal(event.event.chat, CHAT); assert.equal(event.event.kind, kind);
  }
});
test('Точная связь reply через link.message.mid, forward не считается ответом', () => {
  const v = reply('question'); const event = parseUpdate(parseJson(encode(v)), '777'); assert(!event.ignored); assert.equal(event.event.replyMid, 'question');
  const forward = { ...v, message: { ...v.message, link: { ...v.message.link!, type: 'forward' } } };
  const parsed = parseUpdate(parseJson(encode(forward)), '777'); assert(!parsed.ignored); assert.equal(parsed.event.replyMid, undefined);
});
test('answers требует boolean success:true', async () => {
  assert.deepEqual(await client({ success: true }).execute(operation), { simulated: false });
  await assert.rejects(client({ success: false }).execute(operation), { kind: 'SEMANTIC' });
  for (const body of [{ success: 'true' }, {}, '{']) await assert.rejects(client(body).execute(operation), { kind: 'MALFORMED' });
});
test('messages проверяет Message/body/mid/seq и точного получателя', async () => {
  const op = { method: 'messages' as const, recipient: ACTOR, body: { text: 'Тест' } };
  assert.equal((await client({ message: message() }).execute(op)).mid, 'synthetic-mid');
  for (const raw of [{ success: true }, { message: message('123') }, { message: { ...message(), body: { mid: 'x' } } }, { message: { ...message(), body: null } }]) {
    await assert.rejects(client(raw).execute(op), { kind: 'MALFORMED' });
  }
});
for (const [status, kind] of [[401, 'AUTH'], [403, 'PERMISSION'], [429, 'RATE_LIMIT'], [503, 'SERVER'], [400, 'INVALID_REQUEST']] as const) {
  test(`HTTP ${status} сохраняет отдельный класс ${kind}`, async () => {
    await assert.rejects(client({}, status, { 'retry-after': '3' }).execute(operation), e => e instanceof MaxError && e.kind === kind && e.status === status && (status !== 429 || e.retryAfterMs === 3000));
  });
}
test('subscriptions и me имеют собственные схемы и проверку идентичности', async () => {
  assert.deepEqual(await client({ subscriptions: [] }).subscriptions(), []);
  await assert.rejects(client({ success: true }).subscriptions(), { kind: 'MALFORMED' });
  await assert.rejects(client({ success: false }).subscribe('https://probe.example.org/webhooks/max', []), { kind: 'SEMANTIC' });
  await assert.rejects(client({ user_id: 778, first_name: 'Тест', is_bot: true }).me(), { kind: 'AUTH' });
  assert.equal((await client({ user_id: 777, first_name: 'Тест', is_bot: true }).me()).user_id, '777');
});
test('Авторизация только в header, int64 в query не округляется, redirects запрещены', async () => {
  let called = false;
  const max = new LiveMax(config, (async (input, init) => {
    called = true; const url = new URL(String(input)); assert.equal(url.origin, 'https://platform-api2.max.ru');
    assert.equal(url.searchParams.get('user_id'), ACTOR); assert(!url.href.includes(config.token!));
    assert.equal(new Headers(init?.headers).get('Authorization'), config.token); assert.equal(init?.redirect, 'error');
    return new Response(encode({ message: message() }));
  }) as typeof fetch);
  await max.execute({ method: 'messages', recipient: ACTOR, body: { text: 'Тест' } }); assert(called);
});
test('Deadline охватывает реальный HTTP и зависшее тело; timeout остаётся неоднозначным', async t => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const fetcher: typeof fetch = async (_url, init) => fetch(`http://127.0.0.1:${address.port}`, init);
  const started = Date.now();
  await assert.rejects(new LiveMax(config, fetcher).execute(operation), { kind: 'TIMEOUT_AMBIGUOUS' });
  assert(Date.now()-started < 1500);
});
test('Разрыв транспорта отличается от semantic/HTTP и не раскрывает исходную ошибку', async () => {
  const c = new LiveMax(config, (async () => { throw new Error('private-token-and-body'); }) as typeof fetch);
  await assert.rejects(c.execute(operation), e => e instanceof MaxError && e.kind === 'TRANSPORT_AMBIGUOUS' && !e.message.includes('private'));
});
test('LocalMax физически не использует fetch', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
  try { assert.equal((await new LocalMax().execute(operation)).simulated, true); assert.throws(() => new LiveMax({ ...config, mode: 'local' })); }
  finally { globalThis.fetch = original; }
});
