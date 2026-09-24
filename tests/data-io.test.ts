import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BoundedClient, allowedApiUrl, type NetworkLedger } from '../src/data/http.js';
import { eventSchema, pages, nextPage, mergeEvent, fetchKudago, enrichPlaces } from '../src/data/kudago.js';
import { checkTimepad } from '../src/data/timepad.js';
import { syntheticDownload, syntheticSnapshot } from '../src/data/examples.js';
import { atomicJson, readSnapshot, writeSnapshot } from '../src/data/cache.js';

const api = 'https://kudago.com/public-api/v1.4/events/?location=kzn&order_by=id';
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
function fake(transport: typeof fetch, limits = {}) {
  let now = 1000000; const waits: number[] = [], ledger: NetworkLedger = { requests: [], decodedBytes: 0 };
  const client = new BoundedClient(ledger, async () => {}, transport,
    { requests: 24, bytes: 16 * 1024 * 1024, timeoutMs: 100, spacingMs: 1000, operationMs: 55000, ...limits },
    () => now, async ms => { waits.push(ms); now += ms; });
  return { client, ledger, waits };
}
test('HTTP 200 с HTML, повреждённым JSON или отсутствующим content-type отвергается', async () => {
  for (const response of [new Response('<html>'), new Response('{broken', { headers: { 'content-type': 'application/json' } }), new Response('{}')]) {
    const { client } = fake(async () => response); await assert.rejects(client.get(api), /NON_JSON_200|MALFORMED_JSON/);
  }
});
test('Allowlist API: только HTTPS и известные paths, без чужих hosts/redirects', async () => {
  for (const url of ['http://kudago.com/public-api/v1.4/events/', 'https://evil.invalid/public-api/v1.4/events/',
    'https://kudago.com/private/', 'https://user:pass@kudago.com/public-api/v1.4/events/', 'https://api.timepad.ru/v1/orders.json'])
    assert.throws(() => allowedApiUrl(url));
  const { client } = fake(async (_, options) => { assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
    assert.equal(new Headers(options?.headers).has('authorization'), false); return json({}); }); await client.get(api);
});
test('Сериализация запросов, минимум секунда между началами, общий счётчик и body budget', async () => {
  const { client, ledger } = fake(async () => json({ ok: true })); await Promise.all([client.get(api), client.get(api)]);
  assert.equal(ledger.requests.length, 2); assert(Date.parse(ledger.requests[1]!.startedAt) - Date.parse(ledger.requests[0]!.startedAt) >= 1000);
  assert(ledger.decodedBytes > 0);
  const small = fake(async () => json({ tooLarge: 'x'.repeat(100) }), { bytes: 16 });
  await assert.rejects(small.client.get(api), /BODY_BUDGET/); await assert.rejects(small.client.get(api), /NETWORK_BUDGET/);
});
test('Не более 24 попыток, ledger сохраняется до начала запроса', async () => {
  const { client, ledger } = fake(async () => json({}), { requests: 2 }); await client.get(api); await client.get(api);
  await assert.rejects(client.get(api), /NETWORK_BUDGET/); assert.equal(ledger.requests.length, 2);
  let saved = false;
  const ordered = new BoundedClient(undefined, async () => { saved = true; }, async () => { assert(saved); return json({}); });
  await ordered.get(api);
});
test('Одно разрешённое повторение transient GET и уважение Retry-After', async () => {
  let calls = 0; const { client, waits } = fake(async () => ++calls === 1 ? json({}, 503, { 'retry-after': '2' }) : json({ ok: true }));
  assert.deepEqual(await client.get(api, true), { ok: true }); assert.equal(calls, 2); assert(waits.includes(2000));
  const tooLong = fake(async () => json({}, 429, { 'retry-after': '60' }));
  await assert.rejects(tooLong.client.get(api, true), /HTTP_429/); assert.equal(tooLong.ledger.requests.length, 1);
});
test('401/403 не повторяются даже после нового вызова', async () => {
  for (const status of [401, 403]) {
    const { client, ledger } = fake(async () => json({}, status));
    await assert.rejects(client.get(api, true), /ACCESS_DENIED/); await assert.rejects(client.get(api), /CREDENTIALS_REQUIRED/);
    assert.equal(ledger.requests.length, 1);
  }
});
test('Таймаут действует и во время чтения тела', async () => {
  const { client } = fake(async (_, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
  } }), { headers: { 'content-type': 'application/json' } }), { timeoutMs: 20 });
  await assert.rejects(client.get(api), /TIMEOUT/);
});
test('Пагинация: разные occurrences повторного ID сохранены, каталог помечен partial', async () => {
  const row = syntheticDownload().events.rows[4]!, later = { ...row, dates: [{ start: row.dates![0]!.start! + 86400, end: row.dates![0]!.end! + 86400 }] };
  let n = 0; const p = await pages({ get: async () => ++n === 1
    ? { count: 1, next: api + '&page=2', results: [row] } : { count: 1, next: null, results: [later] } }, new URL(api), eventSchema, 3, mergeEvent);
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0]!.dates!.length, 2); assert.equal(p.duplicates, 1); assert.equal(p.complete, false);
});
test('Повторённая страница и next-ссылка обнаруживаются', async () => {
  const row = syntheticDownload().events.rows[0]!; let n = 0;
  const p = await pages({ get: async () => ({ count: 2, next: api + `&page=${++n + 1}`, results: [row] }) }, new URL(api), eventSchema, 5);
  assert.equal(n, 2); assert(p.issues.includes('REPEATED_PAGE')); assert.equal(p.complete, false);
  for (const next of [api + '&page=1', api + '&page=2&page=3', api.replace('kzn', 'msk') + '&page=2', 'https://evil.invalid/?page=2'])
    assert.throws(() => nextPage(next, new URL(api), 1));
});
test('Частичная загрузка, ошибка/omitted поля/неверная схема не превращаются в complete empty', async () => {
  let n = 0; const row = syntheticDownload().events.rows[0]!;
  const p = await pages({ get: async () => { if (++n > 1) throw new Error('offline'); return { count: 2, next: api + '&page=2', results: [row] }; } }, new URL(api), eventSchema, 3);
  assert.equal(p.rows.length, 1); assert.equal(p.complete, false);
  for (const body of [{ results: [] }, { count: 1, next: null, results: [{ title: 'без ID' }] }]) {
    const result = await pages({ get: async () => body }, new URL(api), eventSchema, 1); assert.equal(result.complete, false); assert(result.issues.length);
  }
});
test('Adapter: метаданные не блокируют события; query город/даты/id, без descriptions/media', async () => {
  const seen: string[] = [];
  const result = await fetchKudago({ get: async url => { seen.push(url); if (url.includes('locations/')) throw new Error('offline');
    if (url.includes('event-categories/')) return []; return { count: 0, next: null, results: [] }; } }, new Date('2026-09-24T07:00:00Z'));
  const events = new URL(seen.find(u => u.includes('/events/'))!);
  assert.equal(events.searchParams.get('order_by'), 'id'); assert.equal(events.searchParams.get('location'), 'kzn');
  assert.equal(events.searchParams.get('actual_since'), '1790197200'); assert(!events.searchParams.get('fields')!.includes('description'));
  assert(result.events.complete); assert(result.issues.includes('LOCATION_UNAVAILABLE'));
});
test('Timepad: один публичный featured GET, без скрытых/частных/участников/регистрационных данных', async () => {
  let seen = '';
  const result = await checkTimepad({ get: async url => { seen = url; return { total: 0, values: [] }; } }, syntheticDownload().window);
  const params = new URL(seen).searchParams; assert.equal(params.get('moderation_statuses'), 'featured');
  assert.equal(params.get('cities'), 'Казань'); assert(!params.has('access_statuses')); assert.equal(result.reason, 'NO_APPROVED_PUBLIC_RECORDS');
  assert(!seen.includes('questions') && !seen.includes('participants') && !seen.includes('token'));
});
test('Detail enrichment не подменяет venue ID и останавливается после двух неудач', async () => {
  const d = syntheticDownload(); d.places.rows = []; d.places.complete = false; let n = 0;
  const result = await enrichPlaces({ get: async () => { n++; return { id: 7 }; } }, d);
  assert.equal(n, 1); assert.equal(result.places.rows.length, 0); assert(result.places.issues.includes('PLACE_ID_MISMATCH'));
});
async function directory() { const parent = resolve('.cache/data-tests'); await mkdir(parent, { recursive: true }); return mkdtemp(join(parent, 'case-')); }
test('Кеш: атомарное сохранение, validated read, отсутствие временных файлов', async () => {
  const dir = await directory(), path = join(dir, 'snapshot.json'), s = syntheticSnapshot();
  assert.equal((await writeSnapshot(path, s)).replaced, true); assert.deepEqual(await readSnapshot(path), s);
  assert(!(await readdir(dir)).some(n => n.endsWith('.tmp') || n.endsWith('.lock')));
  await writeFile(path, '{}'); await assert.rejects(readSnapshot(path));
});
test('Неудачный/partial/пустой refresh сохраняет хороший complete, попытка видна отдельно', async () => {
  const path = join(await directory(), 'snapshot.json'), s = syntheticSnapshot(); await writeSnapshot(path, s);
  for (const outcome of ['PARTIAL', 'FAILED', 'COMPLETE'] as const) {
    const attempt = structuredClone(s); attempt.outcome = outcome; attempt.paginationComplete = outcome === 'COMPLETE';
    attempt.events = []; attempt.stats.normalizedEvents = 0; attempt.stats.occurrences = 0;
    const saved = await writeSnapshot(path, attempt); assert.equal(saved.replaced, false); assert.deepEqual(await readSnapshot(path), s);
    assert.equal((await readSnapshot(path + '.attempt.json')).outcome, outcome);
  }
});
test('Кеш: старая загрузка, смена режима и ошибка atomic rename не разрушают файлы', async () => {
  const dir = await directory(), path = join(dir, 'snapshot.json'), s = syntheticSnapshot(); await writeSnapshot(path, s);
  const old = structuredClone(s); old.retrievedAt = '2030-04-04T06:00:00.000Z'; old.events.forEach(e => { e.retrievedAt = old.retrievedAt; });
  assert.equal((await writeSnapshot(path, old)).reason, 'OLDER_REFRESH');
  const target = join(dir, 'directory'); await mkdir(target); await assert.rejects(atomicJson(target, {}));
  assert.deepEqual(await readSnapshot(path), s); assert(!(await readdir(dir)).some(n => n.endsWith('.tmp')));
});
test('CLI: синтетический demo явно маркирован, recommendation воспроизводим без сети', async () => {
  const dir = await directory();
  const invoke = (args: string[]) => spawnSync(process.execPath, ['dist/scripts/data.js', ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const refused = invoke(['demo', '--cache', dir]); assert.equal(refused.status, 1);
  const demo = invoke(['demo', '--synthetic', '--cache', dir]); assert.equal(demo.status, 0, demo.stderr + demo.stdout);
  assert.equal(JSON.parse(demo.stdout).mode, 'SYNTHETIC_FIXTURE');
  const checked = invoke(['validate', '--snapshot', join(dir, 'synthetic.snapshot.json')]); assert.equal(checked.status, 0);
  const result = invoke(['recommend', '--snapshot', join(dir, 'synthetic.snapshot.json'), '--query', join(dir, 'synthetic.query.json'),
    '--clock', '2030-04-05T06:00:00Z', '--synthetic']); assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).strictTotal, 4);
  assert.equal(JSON.parse(await readFile(join(dir, 'synthetic.snapshot.json'), 'utf8')).mode, 'SYNTHETIC_FIXTURE');
});

test('Конфликтующий повтор ID изолирован: первая цена не остаётся строгим фактом', async () => {
  const row = syntheticDownload().events.rows[0]!; let n = 0;
  const p = await pages({ get: async () => ++n === 1 ? { count: 1, next: api + '&page=2', results: [row] }
    : { count: 1, next: null, results: [{ ...row, price: '900 рублей' }] } }, new URL(api), eventSchema, 3, mergeEvent);
  assert.equal(p.rows.length, 0); assert.equal(p.complete, false); assert(p.issues.includes('CONFLICTING_DUPLICATE_EVENT'));
});
test('Первый failed refresh сохраняет только попытку, активного пустого каталога нет', async () => {
  const path = join(await directory(), 'snapshot.json'), failed = syntheticSnapshot();
  failed.events = []; failed.stats.normalizedEvents = 0; failed.stats.occurrences = 0;
  failed.outcome = 'FAILED'; failed.paginationComplete = false;
  const result = await writeSnapshot(path, failed); assert.equal(result.active, false);
  await assert.rejects(readSnapshot(path), /ENOENT/); assert.equal((await readSnapshot(path + '.attempt.json')).outcome, 'FAILED');
});
test('Отказ 401 во время медленного тела всё равно запрещает новый анонимный запрос', async () => {
  const { client, ledger } = fake(async (_, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener('abort', () => controller.error(new Error('abort')));
  } }), { status: 401 }), { timeoutMs: 20 });
  await assert.rejects(client.get(api), /TIMEOUT/); await assert.rejects(client.get(api), /CREDENTIALS_REQUIRED/);
  assert.equal(ledger.requests.length, 1);
});

test('Resume сохраняет уже полученные площадки и завершает покрытие без повторной сети', async () => {
  const prior = syntheticDownload(); prior.places.complete = false; prior.places.issues = ['TIMEOUT'];
  prior.categories = [{ slug: 'exhibition', name: 'Выставки' }];
  const result = await fetchKudago({ get: async () => { throw new Error('unexpected network'); } }, new Date(prior.retrievedAt), prior);
  assert.equal(result.places.rows.length, 1); assert.equal(result.places.complete, true); assert.deepEqual(result.places.issues, []);
});
