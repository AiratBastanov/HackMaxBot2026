import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syntheticDownload, syntheticSnapshot, syntheticClock, representativeQueries } from '../src/data/examples.js';
import { normalizeKudago, normalizePrice, parseTimetable } from '../src/data/normalize.js';
import { select } from '../src/data/select.js';
import { validateSnapshot, type Snapshot } from '../src/data/contract.js';
import { addObservation, validateDownload } from '../src/data/kudago.js';
import { BoundedClient, DataError, type NetworkLedger } from '../src/data/http.js';
import { enrichTargeted, runEnrichmentCampaign, enrichmentLimits } from '../src/data/enrich.js';
import { atomicJson, readSnapshot, writeSnapshot } from '../src/data/cache.js';

const query = () => representativeQueries(syntheticClock).weekend500!;
const run = (s: Snapshot, q = query(), opt = true) => select(s, q, syntheticClock, true, opt);
const only = (index = 0) => {
  const s = syntheticSnapshot(); s.events = [s.events[index]!];
  s.stats.normalizedEvents = 1; s.stats.occurrences = s.events[0]!.occurrences.length; return s;
};
const timedQuery = () => ({ ...query(), start: '2030-04-08T18:00:00+03:00', end: '2030-04-08T20:00:00+03:00' });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function directory() { await mkdir('.cache/data-tests', { recursive: true }); return mkdtemp(resolve('.cache/data-tests/correction-')); }

test('Хороший сеанс проходит в partial без часов, координат, зоны и полной редакционной карточки', () => {
  const d = syntheticDownload(), p = d.places.rows[0]!;
  p.is_stub = true; delete p.timetable; delete p.coords; d.places.complete = false;
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE'), result = run(s, timedQuery());
  assert.equal(result.strictTotal, 1); assert.equal(result.status, 'MATCHES_IN_INCOMPLETE_CATALOG');
  assert.equal(s.paginationComplete, true); assert.equal(s.venueCoverageComplete, false);
  assert.equal(s.venues[0]!.stub, true); assert.equal(s.venues[0]!.closed, false); assert.equal(s.venues[0]!.physical, true);
  p.is_closed = true;
  const closed = run(normalizeKudago(d, 'SYNTHETIC_FIXTURE'), timedQuery());
  assert.equal(closed.strictTotal, 0); assert.equal(closed.uncertain.length, 0); assert(closed.excluded.CLOSED);
});
test('Расширенный place сохраняет адрес/город; timetable не появляется из наличия expansion', () => {
  const d = syntheticDownload(); d.events.rows[4]!.place = { ...d.places.rows[0]!, timetable: undefined };
  d.places.rows = []; d.places.complete = false;
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE');
  assert.equal(s.venues[0]!.city, 'kzn'); assert.equal(s.venues[0]!.opening, null);
  assert.equal(run(s, timedQuery()).strictTotal, 1); assert.equal(run(s).strictTotal, 0);
});
test('Документированные clauses и списки дней с запятыми не теряют части расписания', () => {
  const clauses = parseTimetable('вт–пт 11:00–18:00, сб 11:00–20:00, вс 11:00–19:00')!;
  assert.equal(clauses.length, 6); assert.equal(clauses.find(h => h.weekday === 6)!.close, 1200);
  const days = parseTimetable('пн, ср, пт 10:00–18:00, вт, чт 11:00–19:00')!;
  assert.equal(days.length, 5); assert.equal(days.find(h => h.weekday === 2)!.open, 660);
  for (const text of ['ежедневно 10:00–18:00, кроме праздников', 'пн–пт 10:00–18:00; летом 10:00–20:00',
    'пн–пт 10:00–18:00, сб, вс по записи']) assert.equal(parseTimetable(text), null);
});
test('Числовое соглашение weekday не угадывается и остаётся именованным ограничением', () => {
  const d = syntheticDownload(); d.events.rows[0]!.dates![0]!.schedules = [{ days_of_week: [1,2,3,4,5], start_time: '09:00:00', end_time: '18:00:00' }];
  const o = normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[0]!.occurrences[0]!;
  assert.equal(o.opening, null); assert(o.issues.includes('WEEKDAY_CONVENTION_UNVERIFIED'));
});
test('FROM сохраняет нижнюю границу, не превращается в EXACT; выше бюджета — MISMATCH', () => {
  const s = only(); s.events[0]!.price = normalizePrice('от 700 рублей', false);
  assert.equal(s.events[0]!.price.kind, 'FROM'); assert.equal(s.events[0]!.price.amount, null);
  assert.equal(run(s).uncertain.length, 0); assert.equal(run(s).excluded.OVER_BUDGET, 1);
  s.events[0]!.price = normalizePrice('от 300 рублей', false);
  const result = run(s); assert.equal(result.strictTotal, 0);
  assert.equal(result.uncertain[0]!.predicates.find(p => p.name === 'price')!.state, 'UNKNOWN');
  assert(result.uncertain[0]!.usefulFacts.some(f => f.includes('от 300')));
  assert(!result.uncertain[0]!.factsMatched.some(f => f.includes('в пределах')));
  assert.equal(normalizePrice('800 рублей с человека', false).amount, 800);
});
test('Кандидаты требуют opt-in даже при пустой strict; максимум три, порядок устойчивый', () => {
  const s = syntheticSnapshot(); for (const e of s.events) { e.price = normalizePrice('от 300 рублей', false); }
  assert.deepEqual(run(s, query(), false).uncertain, []); assert.equal(run(s, query(), false).uncertainTotal, 4);
  const first = run(s); assert.equal(first.uncertain.length, 3);
  s.events.reverse(); s.venues.reverse(); assert.deepEqual(first, run(s));
});
test('Неизвестный конец не обещает попадание целиком; известное начало вне окна исключает', () => {
  const s = only(4), o = s.events[0]!.occurrences[0]!; o.end = null; o.endBasis = 'UNKNOWN';
  const result = run(s, timedQuery()), card = result.uncertain[0]!;
  assert.equal(result.strictTotal, 0); assert(card.usefulFacts.some(f => f.includes('18:00') && f.includes('окончание не указано')));
  assert(!card.factsMatched.some(f => f.includes('Сеанс целиком'))); assert(card.checkAtSource.some(f => f.includes('окончание')));
  assert.equal(run(s, { ...timedQuery(), start: '2030-04-08T19:00:00+03:00' }).uncertain.length, 0);
});
test('Город события — отдельное свидетельство; listing без города/адреса остаётся UNKNOWN', () => {
  const s = only(4), v = s.venues[0]!; v.city = null; v.physical = null; v.address = null;
  let card = run(s, timedQuery()).uncertain[0]!;
  assert.equal(card.predicates.find(p => p.name === 'city')!.state, 'MATCH');
  assert.equal(card.predicates.find(p => p.name === 'destination')!.state, 'UNKNOWN');
  s.events[0]!.city = null; card = run(s, timedQuery()).uncertain[0]!;
  assert.equal(card.predicates.find(p => p.name === 'city')!.state, 'UNKNOWN');
  v.city = 'msk'; assert.equal(run(s, timedQuery()).uncertain.length, 0);
});
test('Конфликт города события с площадкой, закрытие и отмена никогда не кандидаты', () => {
  for (const alter of [(s: Snapshot) => { s.events[0]!.city = 'msk'; }, (s: Snapshot) => { s.venues[0]!.closed = true; },
    (s: Snapshot) => { s.events[0]!.cancelled = true; }]) {
    const s = only(); s.events[0]!.price = normalizePrice('', false); alter(s);
    assert.equal(run(s).strictTotal, 0); assert.equal(run(s).uncertain.length, 0);
  }
});
test('Нет дат не скрывает известную дорогую цену/другую категорию', () => {
  const s = only(); s.events[0]!.occurrences = []; s.stats.occurrences = 0; s.events[0]!.price = normalizePrice('900 рублей', false);
  assert.equal(run(s).uncertain.length, 0);
  s.events[0]!.price = normalizePrice('', false);
  assert.equal(run(s, { ...query(), category: 'theater' }).uncertain.length, 0);
});
test('Истёкшее окно не становится кандидатом при неизвестных часах', () => {
  const s = only(); s.events[0]!.occurrences[0]!.opening = null; s.events[0]!.occurrences[0]!.scheduleBasis = 'UNKNOWN';
  const q = { ...query(), start: '2030-04-05T00:00:00+03:00', end: '2030-04-05T08:00:00+03:00' };
  assert.equal(run(s, q).uncertain.length, 0); assert.equal(run(s, q).excluded.OUTSIDE_WINDOW, 1);
});
test('Конфликт цены объяснён и не обещает соответствие бюджету', () => {
  const s = only(); s.events[0]!.price = normalizePrice('300 рублей', true);
  const c = run(s).uncertain[0]!; assert(c.usefulFacts.some(f => f.includes('противоречит')));
  assert(!c.factsMatched.some(f => f.includes('в пределах')));
});
test('Строгие и кандидаты не повторяют событие с несколькими occurrences', () => {
  const s = syntheticSnapshot(), e = s.events[0]!;
  const o = structuredClone(e.occurrences[0]!); o.id += '-other'; o.opening = null; o.scheduleBasis = 'UNKNOWN';
  e.occurrences.push(o); s.stats.occurrences++; s.events[1]!.price = normalizePrice('', false);
  const r = run(s); assert(r.recommendations.some(c => c.eventId === e.id));
  assert(!r.uncertain.some(c => c.eventId === e.id));
  assert.equal(new Set([...r.uncertain, ...r.recommendations].map(c => c.eventId)).size, r.uncertain.length + r.recommendations.length);
});
test('Бессодержательная запись и корневая ссылка не показываются', () => {
  const s = only(); s.events[0]!.price = normalizePrice('', false); s.events[0]!.title = '   ';
  assert.equal(run(s).uncertain.length, 0); s.events[0]!.title = 'Синтетический материал'; s.events[0]!.sourceUrl = 'https://kudago.com/';
  assert.equal(run(s).uncertain.length, 0);
});
test('Новые наблюдения сохраняют отсутствующие поля, старую цену и timestamps, показывают новый конфликт', () => {
  const d = syntheticDownload(), old = d.retrievedAt, fresh = '2030-04-05T07:00:00Z';
  addObservation(d, { entity: 'place', data: { id: 900001, is_closed: true, location: 'msk' }, retrievedAt: fresh,
    requestUrl: 'https://kudago.com/public-api/v1.4/places/900001/' });
  const s = normalizeKudago(validateDownload(d), 'SYNTHETIC_FIXTURE');
  assert.equal(s.retrievedAt, old); assert.equal(s.events[0]!.retrievedAt, old); assert.equal(s.enrichedAt, fresh);
  assert.equal(s.venues[0]!.address, 'Синтетический адрес'); assert.equal(s.venues[0]!.closed, true);
  assert(s.venues[0]!.observations.at(-1)!.conflicts.includes('location')); assert.equal(run(s).uncertain.length, 0);
});
test('Обогащение события без price не омолаживает старый тариф', () => {
  const d = syntheticDownload(); addObservation(d, { entity: 'event', data: { id: 990001, title: 'СИНТЕТИКА: обновлённое название' },
    retrievedAt: '2030-04-07T06:00:00Z', requestUrl: 'https://kudago.com/public-api/v1.4/events/990001/' });
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE');
  const result = select(s, query(), new Date('2030-04-07T06:01:00Z'), true, true);
  assert.equal(result.strictTotal, 0); assert(s.events[0]!.observations[0]!.fields.includes('price'));
  assert(!s.events[0]!.observations[1]!.fields.includes('price')); assert.equal(s.events[0]!.price.kind, 'FREE');
});
test('Поздний импорт старого наблюдения не прячет более новую closure', () => {
  const d = syntheticDownload(), url = 'https://kudago.com/public-api/v1.4/places/900001/';
  addObservation(d, { entity: 'place', data: { id: 900001, is_closed: true }, requestUrl: url, retrievedAt: '2030-04-05T08:00:00Z' });
  addObservation(d, { entity: 'place', data: { id: 900001, is_closed: false }, requestUrl: url, retrievedAt: '2030-04-05T07:00:00Z' });
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE');
  assert.equal(d.places.rows[0]!.is_closed, true); assert.equal(s.venues[0]!.closed, true);
  assert.equal(s.enrichedAt, '2030-04-05T08:00:00Z');
});
test('Частичный event detail не стирает прежний expanded адрес', () => {
  const d = syntheticDownload(); d.events.rows[4]!.place = d.places.rows[0]!; d.places.rows = [];
  addObservation(d, { entity: 'event', data: { id: 990005, title: d.events.rows[4]!.title, place: { id: 900001 } },
    retrievedAt: '2030-04-05T07:00:00Z', requestUrl: 'https://kudago.com/public-api/v1.4/events/990005/' });
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE');
  assert.equal(s.venues[0]!.address, 'Синтетический адрес');
  assert.equal(s.venues[0]!.observations.filter(o => o.fields.includes('address')).at(-1)!.retrievedAt, d.retrievedAt);
});
test('Детализация, явно обнулившая timetable, не сохраняет старые часы', () => {
  const d = syntheticDownload(); addObservation(d, { entity: 'place', data: { id: 900001, timetable: null },
    retrievedAt: syntheticClock.toISOString(), requestUrl: 'https://kudago.com/public-api/v1.4/places/900001/' });
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE'); assert.equal(s.venues[0]!.opening, null); assert.equal(run(s).strictTotal, 0);
});
test('Невалидный join детали не сохраняет чужую площадку', async () => {
  const steps: import('../src/data/enrich.js').EnrichmentStep[] = [];
  const d = syntheticDownload();
  const r = await enrichTargeted({ get: async () => ({ id: 99, is_closed: false }) }, d,
    [{ entity: 'place', id: 900001, reason: 'Проверить фактическую площадку' }], async () => {}, steps);
  assert.equal(steps[0]!.outcome, 'PLACE_ID_MISMATCH'); assert(!r.places.rows.some(p => p.id === 99));
});
test('Контракт v1 мигрирует без выдуманного времени площадки, неизвестная версия отвергается', () => {
  const old = JSON.parse(JSON.stringify(syntheticSnapshot())); old.version = 1;
  delete old.enrichedAt; delete old.venueCoverageComplete;
  for (const e of old.events) { delete e.observations; delete e.cancelled; delete e.price.lowerBound; }
  for (const v of old.venues) { delete v.observations; delete v.stub; }
  const next = validateSnapshot(old); assert.equal(next.version, 2); assert.deepEqual(next.venues[0]!.observations, []);
  assert.equal(old.version, 1); assert.throws(() => validateSnapshot({ ...old, version: 42 }));
});
test('Checkpoint до следующего запроса, ID join и отдельная schema-ошибка', async () => {
  const d = syntheticDownload(); d.places.rows = []; d.places.complete = false;
  let saved = 0, n = 0;
  const r = await enrichTargeted({ get: async () => {
    if (++n === 1) return { id: 900001, address: 'Синтетический адрес', location: 'kzn' };
    assert.equal(saved, 1); return { id: 990001, title: 25 };
  } }, d, [{ entity: 'place', id: 900001, reason: 'Нужен опубликованный адрес' },
    { entity: 'event', id: 990001, reason: 'Нужно расписание события' }], async (_, steps) => { saved++; if (saved === 2) assert.equal(steps[1]!.outcome, 'PROVIDER_SCHEMA'); });
  assert.equal(r.places.rows.length, 1); assert.equal(saved, 2);
  await assert.rejects(enrichTargeted({ get: async () => { throw new Error('no network'); } }, d,
    [{ entity: 'place', id: 42, reason: 'Несвязанный идентификатор' }], async () => {}), /OUTSIDE_DOWNLOAD/);
});
test('Отмена после успешного обогащения сохраняет факт и не выдаётся за provider failure', async () => {
  const d = syntheticDownload(), steps: import('../src/data/enrich.js').EnrichmentStep[] = [];
  let n = 0, saved = 0;
  const result = await enrichTargeted({ get: async () => {
    if (++n === 1) return { id: 900001, is_closed: true }; throw new DataError('CANCELLED');
  } }, d, [{ entity: 'place', id: 900001, reason: 'Проверить статус площадки' },
    { entity: 'event', id: 990001, reason: 'Проверить время события' }], async () => { saved++; }, steps);
  assert.equal(saved, 2); assert.equal(result.places.rows[0]!.is_closed, true); assert.equal(steps[1]!.outcome, 'CANCELLED');
});
test('Две эквивалентные ошибки останавливают маршрут', async () => {
  const d = syntheticDownload(); let requests = 0; const steps: import('../src/data/enrich.js').EnrichmentStep[] = [];
  await enrichTargeted({ get: async () => { requests++; throw new DataError('TIMEOUT'); } }, d,
    [990001,990002,990003].map(id => ({ entity: 'event', id, reason: 'Нужно опубликованное время' })), async () => {}, steps);
  assert.equal(requests, 2); assert.equal(steps[2]!.outcome, 'ROUTE_STOPPED');
});
test('Deadline кампании не обрезает запрос; глобально максимум один transient retry', async () => {
  let now = 1000000, calls = 0; const ledger: NetworkLedger = { requests: [], decodedBytes: 0 };
  const client = new BoundedClient(ledger, async () => {}, async () => { calls++; return json({}, calls % 2 ? 503 : 200); },
    { ...enrichmentLimits, timeoutMs: 100, operationMs: 5000 }, () => now, async ms => { now += ms; });
  const url = 'https://kudago.com/public-api/v1.4/places/900001/';
  await client.get(url, true); await assert.rejects(client.get(url + '?fields=id', true), /HTTP_503/);
  assert.equal(ledger.requests.filter(r => r.retry).length, 1);
  const tight = new BoundedClient(undefined, async () => {}, async () => { throw new Error('must not start'); },
    { ...enrichmentLimits, operationMs: 100 });
  await assert.rejects(tight.get(url), /OPERATION_DEADLINE/); assert.equal(tight.ledger.requests.length, 0);
});
test('Отмена во время паузы между запросами не начинает следующий GET', async () => {
  const abort = new AbortController(); let calls = 0, sleeps = 0;
  const client = new BoundedClient(undefined, async () => {}, async () => { calls++; return json({}); },
    enrichmentLimits, Date.now, async () => { if (++sleeps === 2) abort.abort(); }, abort.signal);
  const url = 'https://kudago.com/public-api/v1.4/places/900001/';
  await client.get(url); await assert.rejects(client.get(url), /CANCELLED/); assert.equal(calls, 1);
});
test('Перезапуск кампании не сбрасывает deadline и журнал', async () => {
  const dir = await directory(), path = join(dir, 'campaign.json'), d = syntheticDownload();
  const plan = [{ entity: 'place', id: 900001, reason: 'Проверить часы площадки' }];
  await atomicJson(path, { version: 1, startedAt: '2020-01-01T00:00:00Z', deadlineAt: '2020-01-01T00:04:00Z',
    finishedAt: null, plan, ledger: { requests: [], decodedBytes: 0 }, download: d, steps: [] });
  const r = await runEnrichmentCampaign(path, d, plan, 'native', async () => {});
  assert.equal(r.ledger.requests.length, 0); assert.equal(r.steps[0]!.outcome, 'OPERATION_DEADLINE');
  const second = await runEnrichmentCampaign(path, d, plan, 'native', async () => {}); assert.deepEqual(second, r);
});
test('Новая явная closure не прячется за complete cache при enrichment', async () => {
  const path = join(await directory(), 'snapshot.json'), s = syntheticSnapshot(); await writeSnapshot(path, s);
  const next = structuredClone(s); next.outcome = 'PARTIAL'; next.venueCoverageComplete = false;
  next.venues[0]!.closed = true; next.enrichedAt = '2030-04-05T07:00:00Z';
  assert.equal((await writeSnapshot(path, next)).replaced, true); assert.equal((await readSnapshot(path)).venues[0]!.closed, true);
});
test('CLI --include-uncertain явный и независим от --synthetic', async () => {
  const dir = await directory(), s = only(); s.events[0]!.price = normalizePrice('от 300 рублей', false);
  await atomicJson(join(dir, 'snapshot.json'), s); await atomicJson(join(dir, 'query.json'), query());
  const args = ['dist/scripts/data.js', 'recommend', '--snapshot', join(dir, 'snapshot.json'), '--query', join(dir, 'query.json'), '--clock', syntheticClock.toISOString()];
  const invoke = (flags: string[]) => JSON.parse(spawnSync(process.execPath, [...args, ...flags], { timeout: 10000, windowsHide: true, encoding: 'utf8' }).stdout);
  assert.equal(invoke(['--include-uncertain']).status, 'SYNTHETIC_OPT_IN_REQUIRED');
  assert.equal(invoke(['--synthetic']).uncertain.length, 0); assert.equal(invoke(['--synthetic', '--include-uncertain']).uncertain.length, 1);
  assert.equal(JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8')).mode, 'SYNTHETIC_FIXTURE');
});
