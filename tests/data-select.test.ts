import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticSnapshot, syntheticClock, representativeQueries } from '../src/data/examples.js';
import { select } from '../src/data/select.js';
import { type Query, type Snapshot } from '../src/data/contract.js';
const query = (): Query => representativeQueries(syntheticClock).weekend500!;
const run = (s: Snapshot = syntheticSnapshot(), q = query(), clock = syntheticClock) => select(s, q, clock, true, true);
function only(s: Snapshot, index: number) {
  s.events = [s.events[index]!]; s.stats.normalizedEvents = 1; s.stats.occurrences = s.events[0]!.occurrences.length; return s;
}
test('0–3 разных события, стабильный порядок и фактические объяснения', () => {
  const s = syntheticSnapshot(), first = run(s); s.events.reverse(); s.venues.reverse();
  assert.deepEqual(first, run(s)); assert.equal(first.recommendations.length, 3); assert.equal(first.strictTotal, 4);
  assert.equal(new Set(first.recommendations.map(r => r.eventId)).size, 3);
  for (const r of first.recommendations) { assert(r.reasons.some(x => x.includes('часами'))); assert(r.source.url && r.source.label); }
});
test('Предпочтения сортируют строгие совпадения и не меняют бюджет', () => {
  const s = syntheticSnapshot(); s.events[2]!.categories.push('theater'); const q = query(); q.preferences.categories = ['theater'];
  assert.equal(run(s, q).recommendations[0]!.eventId, s.events[2]!.id); s.events[2]!.price.amount = 900;
  assert(!run(s, q).recommendations.some(r => r.eventId === s.events[2]!.id));
});
test('Сеанс целиком: конец/опубликованная длительность; неизвестное окончание не ноль', () => {
  const s = only(syntheticSnapshot(), 4), q = { ...query(), start: '2030-04-08T18:00:00+03:00', end: '2030-04-08T20:00:00+03:00' };
  assert.equal(run(s, q).strictTotal, 1); const o = s.events[0]!.occurrences[0]!; o.end = null; o.endBasis = 'UNKNOWN';
  assert.equal(run(s, q).status, 'INSUFFICIENT_FACTS'); o.durationMinutes = 90; o.endBasis = 'PUBLISHED_DURATION'; assert.equal(run(s, q).strictTotal, 1);
  q.end = '2030-04-08T19:00:00+03:00'; assert.equal(run(s, q).status, 'NO_MATCHES_IN_SNAPSHOT');
});
test('Режим посещения не меняется незаметно', () => {
  const q = query(); q.kind = 'TIMED_SESSION'; assert.equal(run(syntheticSnapshot(), q).strictTotal, 0);
});
test('Гибкий визит: применимый день, перерыв, последний вход, без обещания длительности', () => {
  const s = only(syntheticSnapshot(), 0), o = s.events[0]!.occurrences[0]!;
  o.opening = [{ weekday: 6, open: 600, close: 780, lastEntry: 750 }, { weekday: 6, open: 840, close: 1080, lastEntry: 1020 }];
  const q = { ...query(), start: '2030-04-06T13:10:00+03:00', end: '2030-04-06T13:50:00+03:00' };
  assert.equal(run(s, q).status, 'NO_MATCHES_IN_SNAPSHOT');
  q.start = '2030-04-06T17:10:00+03:00'; q.end = '2030-04-06T18:00:00+03:00'; assert.equal(run(s, q).strictTotal, 0);
  q.start = '2030-04-06T16:30:00+03:00'; const r = run(s, q).recommendations[0]!;
  assert.equal(r.lastEntry, '2030-04-06T14:00:00.000Z'); assert(r.warnings.some(x => x.includes('не рассчитаны')));
});
test('Отсутствие часов/границ периода: insufficient facts', () => {
  const s = only(syntheticSnapshot(), 0), o = s.events[0]!.occurrences[0]!;
  o.opening = null; o.scheduleBasis = 'UNKNOWN'; assert.equal(run(s).status, 'INSUFFICIENT_FACTS');
  o.opening = s.venues[0]!.opening; o.scheduleBasis = 'PLACE_TIMETABLE'; o.activeThrough = null;
  assert.equal(run(s).status, 'INSUFFICIENT_FACTS');
});
test('Неизвестная/условная/от/диапазон не проходят бюджет ноль', () => {
  for (const kind of ['UNKNOWN', 'FROM', 'RANGE', 'CONDITIONAL', 'CONFLICT'] as const) {
    const s = only(syntheticSnapshot(), 0); Object.assign(s.events[0]!.price, { kind, amount: null, applicability: 'UNRESOLVED' });
    const result = run(s, { ...query(), budgetRub: 0 });
    assert.equal(result.strictTotal, 0); assert.equal(result.status, 'INSUFFICIENT_FACTS'); assert(result.uncertain.length);
    assert.equal(result.uncertain[0]!.source.url, s.events[0]!.sourceUrl);
    assert.equal(result.uncertain[0]!.source.label, s.events[0]!.sourceLabel);
  }
});
test('FREE подтверждает вход, опубликованный тариф не обещает билет', () => {
  const result = run(syntheticSnapshot(), { ...query(), budgetRub: 0 });
  assert.equal(result.strictTotal, 1); assert.equal(result.recommendations[0]!.price.kind, 'FREE');
  assert(result.recommendations[0]!.warnings.some(x => x.includes('билета')));
});
test('Город площадки, а не слово в адресе; online не физическая Казань', () => {
  const s = syntheticSnapshot(); s.venues[0]!.city = 'msk'; s.venues[0]!.address = 'Слово Казань';
  assert.equal(run(s).status, 'NO_MATCHES_IN_SNAPSHOT'); assert.equal(run(s).excluded.OTHER_CITY, 5);
  s.venues[0]!.city = 'kzn'; s.venues[0]!.physical = null; assert.equal(run(s).status, 'INSUFFICIENT_FACTS');
});
test('Зона не угадывается; надёжная зона остаётся строгим ограничением', () => {
  const s = syntheticSnapshot(), q = { ...query(), zone: 'fixture-zone' };
  assert.equal(run(s, q).status, 'INSUFFICIENT_FACTS'); s.venues[0]!.zone = 'fixture-zone'; assert.equal(run(s, q).strictTotal, 4);
  s.venues[0]!.zone = 'other-fixture-zone'; assert.equal(run(s, q).status, 'NO_MATCHES_IN_SNAPSHOT');
});
test('No-match, unavailable, stale, incomplete и выход за scope различимы', () => {
  assert.equal(select(null, query(), syntheticClock).status, 'SOURCE_UNAVAILABLE');
  assert.equal(run(syntheticSnapshot(), { ...query(), budgetRub: 0, category: 'theater' }).status, 'NO_MATCHES_IN_SNAPSHOT');
  assert.equal(run(syntheticSnapshot(), query(), new Date(syntheticClock.getTime() + 86400001)).status, 'SOURCE_STALE');
  const s = syntheticSnapshot(); s.outcome = 'PARTIAL'; s.paginationComplete = false;
  assert.equal(run(s).status, 'MATCHES_IN_INCOMPLETE_CATALOG');
  assert.equal(run(s, { ...query(), category: 'theater' }).status, 'INCOMPLETE_CATALOG');
  assert.equal(run(s, { ...query(), category: 'unknown-category' }).status, 'OUTSIDE_SNAPSHOT_SCOPE');
});
test('Синтетика требует opt-in и не заменяет live fallback', () => {
  assert.equal(select(syntheticSnapshot(), query(), syntheticClock).status, 'SYNTHETIC_OPT_IN_REQUIRED');
  const s = syntheticSnapshot(); s.mode = 'LIVE_PUBLIC'; assert.throws(() => select(s, query(), syntheticClock));
});
test('Явные часы: прошедший сеанс исключается, будущий retrieval непригоден', () => {
  const s = only(syntheticSnapshot(), 4), q = { ...query(), start: '2030-04-08T18:00:00+03:00', end: '2030-04-08T20:00:00+03:00' };
  s.retrievedAt = '2030-04-08T15:00:00Z'; s.events[0]!.retrievedAt = s.retrievedAt;
  assert.equal(run(s, q, new Date('2030-04-08T15:10:00Z')).strictTotal, 0);
  assert.equal(run(s, q, syntheticClock).status, 'SOURCE_STALE');
});
test('Причины и конкретное предложение без ослабления sparse query', () => {
  const s = only(syntheticSnapshot(), 0); s.events[0]!.occurrences[0]!.opening = null;
  s.events[0]!.occurrences[0]!.scheduleBasis = 'UNKNOWN'; const q = query(), before = structuredClone(q);
  const result = run(s, q); assert.equal(result.strictTotal, 0); assert.equal(result.excluded.OPENING_UNKNOWN, 1);
  assert.match(result.proposal!, /часы/); assert.deepEqual(q, before);
});

test('Известное нарушение бюджета имеет приоритет над неизвестным временем', () => {
  const s = only(syntheticSnapshot(), 4), o = s.events[0]!.occurrences[0]!; o.end = null; o.endBasis = 'UNKNOWN';
  const q = { ...query(), budgetRub: 0, start: '2030-04-08T18:00:00+03:00', end: '2030-04-08T20:00:00+03:00' };
  const result = run(s, q); assert.equal(result.status, 'NO_MATCHES_IN_SNAPSHOT'); assert.equal(result.uncertain.length, 0);
});
