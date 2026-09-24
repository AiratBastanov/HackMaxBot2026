import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticDownload, syntheticSnapshot, syntheticClock } from '../src/data/examples.js';
import { normalizeKudago, normalizePrice, parseTimetable, isoSeconds } from '../src/data/normalize.js';
import { eventSchema, moscowWindow, mergeEvent } from '../src/data/kudago.js';
import { safeLink, validateSnapshot } from '../src/data/contract.js';

test('Схема провайдера: обязательные поля, отсутствующие детали, удаление медиа', () => {
  assert.deepEqual(eventSchema.parse({ id: 1, title: 'Синтетика', images: ['не сохранять'] }), { id: 1, title: 'Синтетика' });
  for (const value of [{ title: 'Нет ID' }, { id: 1 }, { id: 1.5, title: 'Дробь' }, { id: 1, title: 'x', dates: 'не массив' }])
    assert.equal(eventSchema.safeParse(value).success, false);
});
test('UTC seconds и Europe/Moscow: ровно 30 местных дат, граница полуночи', () => {
  const w = moscowWindow(new Date('2026-09-23T21:00:00Z'));
  assert.equal(w.start, '2026-09-23T21:00:00.000Z'); assert.equal(w.end, '2026-10-23T21:00:00.000Z');
  assert.equal(moscowWindow(new Date('2026-09-23T20:59:59Z')).start, '2026-09-22T21:00:00.000Z');
  assert.equal(isoSeconds(1790197200), w.start); assert.equal(isoSeconds(1790197200000), null);
});
test('Endless/startless/place schedule не становятся тысячелетним сеансом', () => {
  const d = syntheticDownload(); d.events.rows[0]!.dates = [{ start: -62135433000, end: 253370754000,
    is_endless: true, is_startless: true, is_continuous: false, use_place_schedule: true }];
  const o = normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[0]!.occurrences[0]!;
  assert.equal(o.kind, 'FLEXIBLE_VISIT'); assert.equal(o.end, null); assert.equal(o.start, null);
  assert(o.endless && o.startless && o.opening?.length && o.metadata.placeholderEnd);
});
test('Равные endpoints не доказывают нулевую длительность', () => {
  const d = syntheticDownload(), e = d.events.rows[4]!; e.dates![0]!.end = e.dates![0]!.start;
  const o = normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[4]!.occurrences[0]!;
  assert.equal(o.end, null); assert.equal(o.durationMinutes, null); assert(o.metadata.equalEndpoints);
});
test('Старая публикация не исключает действующий период и не становится updated_at', () => {
  const d = syntheticDownload(); d.events.rows[0]!.publication_date = 1415904534;
  const e = normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[0]!;
  assert.match(e.publicationAt!, /^2014/); assert.equal(e.providerUpdatedAt, null);
  assert.equal(e.retrievedAt, syntheticClock.toISOString()); assert(e.occurrences.length);
});
test('Разные сеансы сохранены, повтор occurrence схлопнут без умножения площадок', () => {
  const d = syntheticDownload(), date = d.events.rows[4]!.dates![0]!;
  d.events.rows[4]!.dates!.push({ ...date }, { start: date.start! + 86400, end: date.end! + 86400 });
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE'), occurrences = s.events[4]!.occurrences;
  assert.equal(occurrences.length, 2); assert.equal(new Set(occurrences.map(o => o.venueId)).size, 1);
  assert.notEqual(occurrences[0]!.id, occurrences[1]!.id); assert.equal(s.venues.length, 1);
});
test('Разные события с одинаковым названием не объединяются', () => {
  const d = syntheticDownload(); d.events.rows[1]!.title = d.events.rows[0]!.title;
  assert.equal(normalizeKudago(d, 'SYNTHETIC_FIXTURE').events.length, 5);
});
test('Повтор ID: дополнительные даты только при совпадении остальных фактов', () => {
  const row = syntheticDownload().events.rows[4]!;
  const later = { ...row, dates: [{ start: row.dates![0]!.start! + 86400, end: row.dates![0]!.end! + 86400 }] };
  assert.equal(mergeEvent(row, later).dates!.length, 2);
  assert.throws(() => mergeEvent(row, { ...later, place: { id: 42 } }), /CONFLICTING/);
});
test('Timetable: дни, интервалы, перерыв; непонятный хвост отменяет parse целиком', () => {
  assert.equal(parseTimetable('пн–пт 10:00–13:00 / 14:00–18:00; сб, вс 11:00–17:00')?.length, 12);
  for (const text of ['примерно с десяти', 'ежедневно 10:00–18:00, кроме праздников', 'пн 18:00–10:00', 'пн 25:00–26:00', 'пн 10:00–18:00; пн 12:00–19:00'])
    assert.equal(parseTimetable(text), null);
});
test('use_place_schedule не угадывается; неизвестные structured schedules не игнорируются', () => {
  for (const patch of [{ use_place_schedule: false }, { schedules: [{ undocumented: true }] }]) {
    const d = syntheticDownload(); Object.assign(d.events.rows[0]!.dates![0]!, patch);
    const o = normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[0]!.occurrences[0]!;
    assert.equal(o.opening, null); assert.equal(o.scheduleBasis, 'UNKNOWN');
  }
});
test('Место без адреса и online не объявляются физической Казанью', () => {
  for (const patch of [{ address: '' }, { location: 'online' }]) {
    const d = syntheticDownload(); Object.assign(d.places.rows[0]!, patch);
    const v = normalizeKudago(d, 'SYNTHETIC_FIXTURE').venues[0]!;
    assert(v.physical !== true || v.city !== 'kzn'); assert.equal(v.zone, null);
  }
});
test('Цены: неизвестная, от, диапазон, группа, промокод, льгота и условно бесплатно', () => {
  const cases: [string, boolean, string][] = [['', false, 'UNKNOWN'], ['от 100 рублей', false, 'FROM'],
    ['100–300 рублей', false, 'RANGE'], ['300 рублей на группу', false, 'CONDITIONAL'],
    ['0 рублей по промокоду', true, 'CONDITIONAL'], ['бесплатно для студентов', true, 'CONDITIONAL'],
    ['бесплатно при регистрации', true, 'CONDITIONAL'], ['300 рублей', true, 'CONFLICT'], ['бесплатно', false, 'CONFLICT']];
  for (const [raw, free, kind] of cases) { const p = normalizePrice(raw, free); assert.equal(p.kind, kind, raw); assert.equal(p.amount, null); }
  assert.equal(normalizePrice('взрослый билет 400 рублей', false).amount, 400); assert.equal(normalizePrice('', true).kind, 'FREE');
});
test('Исходная ссылка и атрибуция сохранены; site_url не становится сайтом организатора', () => {
  const d = syntheticDownload(); d.events.rows[0]!.site_url = 'https://kzn.kudago.com/event/synthetic-fixture/';
  const e = normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[0]!;
  assert.equal(e.sourceUrl, d.events.rows[0]!.site_url); assert.match(e.sourceLabel, /СИНТЕТИЧЕСКИЙ ПРИМЕР/);
  assert.equal(e.organizerUrl, null); assert.equal(e.ticketUrl, null);
});
test('Опасные ссылки и маркированная реклама исключаются; неизвестный ad status не скрыт', () => {
  for (const url of ['javascript:alert(1)', 'https://kudago.com.evil.invalid/a', 'https://user:secret@kudago.com/a', 'http://127.0.0.1/a'])
    assert.equal(safeLink(url, 'kudago.com'), null);
  const d = syntheticDownload(); d.events.rows[0]!.title = 'Реклама: синтетический материал'; d.events.rows[1]!.site_url = null;
  const s = normalizeKudago(d, 'SYNTHETIC_FIXTURE');
  assert.equal(s.events.length, 3); assert.equal(s.stats.omitted.AD_MARKER, 1); assert.equal(s.publicDisplay, 'NOT_CLEARED');
});
test('Валидация snapshot отклоняет испорченные ссылки, ассоциации, цену и счётчики', () => {
  for (const alter of [
    (s: ReturnType<typeof syntheticSnapshot>) => { s.events[0]!.sourceUrl = 'javascript:alert(1)'; },
    (s: ReturnType<typeof syntheticSnapshot>) => { s.events[0]!.occurrences[0]!.venueId = 'kudago:place:404'; },
    (s: ReturnType<typeof syntheticSnapshot>) => { s.events[0]!.price.amount = null; },
    (s: ReturnType<typeof syntheticSnapshot>) => { s.stats.occurrences = 100; },
  ]) { const s = syntheticSnapshot(); alter(s); assert.throws(() => validateSnapshot(s)); }
});

test('Часы места не превращают экскурсию/игру в свободный визит', () => {
  const d = syntheticDownload(); d.events.rows[0]!.categories = ['tour'];
  assert.equal(normalizeKudago(d, 'SYNTHETIC_FIXTURE').events[0]!.occurrences[0]!.kind, 'UNRESOLVED');
});
test('Неподтверждённая длительность и отсутствующая атрибуция не проходят контракт', () => {
  const s = syntheticSnapshot(); s.events[4]!.occurrences[0]!.durationMinutes = 60;
  assert.throws(() => validateSnapshot(s), /unpublished_duration/);
  const live = normalizeKudago(syntheticDownload()); live.events[0]!.sourceLabel = 'Без источника';
  assert.throws(() => validateSnapshot(live), /source_attribution/);
});
