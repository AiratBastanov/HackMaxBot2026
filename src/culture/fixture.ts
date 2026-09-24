import { syntheticSnapshot, syntheticClock } from '../data/examples.js';
import { validateSnapshot } from '../data/contract.js';
import { moscowWindow } from '../data/kudago.js';
import { localDate } from '../data/normalize.js';
export { syntheticClock };
// Только явно выбранный технический режим. Никаких реальных афиш/площадок.
export function flowFixture(clock: Date = syntheticClock) {
  const s = syntheticSnapshot(); s.events = s.events.slice(0, 3);
  for (const [i, e] of s.events.entries()) {
    const previous = e.id; e.id = `synthetic:flow:${i + 1}`; e.provider = 'synthetic';
    e.sourceUrl = `https://example.org/synthetic-cultural-option-${i + 1}`;
    e.sourceLabel = 'Источник: синтетический пример';
    for (const o of e.occurrences) o.id = o.id.replace(previous, e.id);
  }
  s.events[0]!.title = 'СИНТЕТИКА: выставка света';
  s.events[1]!.title = 'СИНТЕТИКА: мастерская цвета';
  s.events[1]!.price = { kind: 'FROM', amount: null, lowerBound: 300, currency: 'RUB', applicability: 'UNRESOLVED', evidence: 'от 300 рублей', conditions: [] };
  s.events[2]!.title = 'СИНТЕТИКА: дорогой зал';
  s.events[2]!.price.amount = 2000; s.events[2]!.price.evidence = '2000 рублей';
  s.stats.normalizedEvents = s.events.length; s.stats.occurrences = s.events.reduce((n,e) => n + e.occurrences.length, 0);
  // Генерация НОВЫХ вымышленных данных для реального технического клиента.
  // Реальные снимки эта функция не принимает и никогда не передатирует.
  if (clock.getTime() !== syntheticClock.getTime()) {
    const window = moscowWindow(clock); s.scope.start = window.start; s.scope.end = window.end; s.retrievedAt = clock.toISOString(); s.enrichedAt = null;
    for (const e of s.events) {
      e.retrievedAt = s.retrievedAt; for (const obs of e.observations) obs.retrievedAt = s.retrievedAt;
      for (const o of e.occurrences) { o.activeFrom = localDate(window.start); o.activeThrough = localDate(new Date(Date.parse(window.end)-1).toISOString()); }
    }
    for (const v of s.venues) for (const obs of v.observations) obs.retrievedAt = s.retrievedAt;
  }
  return validateSnapshot(s);
}
