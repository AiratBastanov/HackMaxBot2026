import { type KudaDownload, type KudaEvent, type KudaPlace, moscowWindow } from './kudago.js';
import { normalizeKudago, localDate } from './normalize.js';
import { type Query } from './contract.js';

export const syntheticClock = new Date('2030-04-05T09:00:00+03:00');
const seconds = (value: string) => Date.parse(value) / 1000;
// Все факты вымышлены. Используется тот же нормализатор, что и у живого адаптера.
export function syntheticDownload(): KudaDownload {
  const places: KudaPlace[] = [{ id: 900001, title: 'Вымышленный музей', address: 'Синтетический адрес', location: 'kzn',
    is_stub: false, is_closed: false, timetable: 'ежедневно 10:00–20:00',
    site_url: 'https://kudago.com/kzn/place/synthetic-fixture/', foreign_url: 'https://museum.example.invalid/' }];
  const events: KudaEvent[] = [1, 2, 3, 4].map(n => ({ id: 990000 + n, title: `СИНТЕТИКА: выставка ${n}`,
    site_url: `https://kudago.com/kzn/event/synthetic-fixture-${n}/`, location: 'kzn', place: { id: 900001 },
    categories: ['exhibition'], price: n === 1 ? 'бесплатно' : '300 рублей', is_free: n === 1,
    dates: [{ start: seconds('2029-01-01T00:00:00+03:00'), end: seconds('2030-05-01T23:59:59+03:00'),
      is_continuous: true, use_place_schedule: true, is_endless: false, is_startless: false, schedules: [] }] }));
  events.push({ id: 990005, title: 'СИНТЕТИКА: вечерний сеанс', site_url: 'https://kudago.com/kzn/event/synthetic-session/',
    location: 'kzn', place: { id: 900001 }, categories: ['theater'], price: '400 рублей', is_free: false,
    dates: [{ start: seconds('2030-04-08T18:00:00+03:00'), end: seconds('2030-04-08T19:30:00+03:00') }] });
  const rows = <T>(data: T[]) => ({ rows: data, count: data.length, retrieved: data.length, duplicates: 0, pages: 1, complete: true, issues: [] });
  return { retrievedAt: syntheticClock.toISOString(), window: moscowWindow(syntheticClock),
    location: { slug: 'kzn', name: 'Казань', timezone: 'Europe/Moscow' }, categories: [], events: rows(events), places: rows(places), issues: [] };
}
export function syntheticSnapshot() { return normalizeKudago(syntheticDownload(), 'SYNTHETIC_FIXTURE'); }
export function representativeQueries(clock: Date): Record<string, Query> {
  const today = localDate(clock.toISOString()), midnight = Date.parse(`${today}T00:00:00+03:00`);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const saturday = midnight + ((6 - weekday + 7) % 7 || 7) * 86400000;
  let nextWeekday = midnight + 86400000;
  while ([0, 6].includes(new Date(nextWeekday + 12 * 3600000).getUTCDay())) nextWeekday += 86400000;
  const make = (day: number, hour: number, hours: number, budget: number | null, category: string | null = null): Query => ({
    city: 'kzn', start: new Date(day + hour * 3600000).toISOString(), end: new Date(day + (hour + hours) * 3600000).toISOString(),
    budgetRub: budget, category, zone: null, kind: 'ANY', preferences: { categories: [] },
  });
  return { weekend500: make(saturday, 12, 6, 500), weekdayEvening: make(nextWeekday, 18, 4, null),
    free: make(saturday, 10, 10, 0), deliberateNoMatch: make(saturday, 3, 0.25, 0, 'theater') };
}
