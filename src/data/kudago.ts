import { z } from 'zod';
import { DataError, type JsonClient } from './http.js';
import { cities, cityKeySchema, timezoneSchema, cityWindow, type CityKey } from './cities.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nullableText = z.string().max(4000).nullable().optional();
export const dateSchema = z.object({
  start: z.number().int().nullable().optional(), end: z.number().int().nullable().optional(),
  start_date: nullableText, end_date: nullableText, start_time: nullableText, end_time: nullableText,
  is_continuous: z.boolean().optional(), is_endless: z.boolean().optional(), is_startless: z.boolean().optional(),
  use_place_schedule: z.boolean().optional(), schedules: z.array(z.unknown()).optional(),
});
export const eventSchema = z.object({
  id, title: z.string().min(1).max(1000), site_url: nullableText,
  publication_date: z.number().int().nullable().optional(),
  dates: z.array(dateSchema).max(10000).optional(),
  place: z.lazy(() => placeSchema).nullable().optional(),
  location: z.union([z.string(), z.object({ slug: z.string() })]).nullable().optional(),
  categories: z.array(z.string()).optional(), price: nullableText, is_free: z.boolean().nullable().optional(), age_restriction: nullableText,
});
export const placeSchema = z.object({
  id, title: nullableText, address: nullableText, location: z.string().nullable().optional(),
  timetable: nullableText, site_url: nullableText, foreign_url: nullableText,
  is_closed: z.boolean().nullable().optional(), is_stub: z.boolean().nullable().optional(),
  coords: z.object({ lat: z.number().nullable(), lon: z.number().nullable() }).nullable().optional(),
});
export type KudaEvent = z.infer<typeof eventSchema>;
export type KudaPlace = z.infer<typeof placeSchema>;
export const culturalCategories = ['exhibition', 'theater', 'concert', 'cinema', 'education', 'festival', 'tour'];
export const base = 'https://kudago.com/public-api/v1.4/';
export const eventFields = 'id,title,site_url,publication_date,dates,place,location,categories,price,is_free,age_restriction';
export const placeFields = 'id,title,address,location,timetable,site_url,foreign_url,is_closed,is_stub,coords';
export type PageResult<T> = { rows: T[]; count: number | null; retrieved: number; duplicates: number; pages: number;
  complete: boolean; issues: string[] };

// next используется как проверяемое свидетельство. Сам URL запроса строится заново
// с исходными фильтрами; чужой host/path/смена scope никогда не переходят в fetch.
export function nextPage(next: string, original: URL, current: number): number {
  const candidate = new URL(next, original);
  if (candidate.origin !== original.origin || candidate.pathname !== original.pathname
    || candidate.username || candidate.password || candidate.hash) throw new DataError('UNSAFE_PAGINATION');
  const page = Number(candidate.searchParams.get('page'));
  if (candidate.searchParams.getAll('page').length !== 1 || !Number.isSafeInteger(page) || page !== current + 1)
    throw new DataError('REPEATED_OR_SKIPPED_PAGE');
  for (const [key, value] of original.searchParams) {
    if (key !== 'page' && (candidate.searchParams.getAll(key).length !== 1 || candidate.searchParams.get(key) !== value))
      throw new DataError('PAGINATION_SCOPE_CHANGED');
  }
  for (const key of candidate.searchParams.keys()) if (key !== 'page' && !original.searchParams.has(key))
    throw new DataError('PAGINATION_SCOPE_CHANGED');
  return page;
}

export async function pages<T extends { id: number }>(client: JsonClient, url: URL, schema: z.ZodType<T>, maxPages: number,
  mergeDuplicate?: (first: T, later: T) => T): Promise<PageResult<T>> {
  const result: PageResult<T> = { rows: [], count: null, retrieved: 0, duplicates: 0, pages: 0, complete: false, issues: [] };
  const ids = new Set<number>(), fingerprints = new Set<string>();
  const conflicts = new Set<number>();
  let page = 1;
  try {
    for (let n = 0; n < maxPages; n++) {
      const request = new URL(url); request.searchParams.set('page', String(page));
      const envelope = z.object({ count: z.number().int().nonnegative(), next: z.string().nullable(), results: z.array(z.unknown()) }).parse(await client.get(request.href));
      result.pages++; result.retrieved += envelope.results.length;
      if (result.count !== null && result.count !== envelope.count) result.issues.push('COUNT_CHANGED');
      result.count ??= envelope.count;
      const valid: T[] = [];
      for (const row of envelope.results) {
        const parsed = schema.safeParse(row);
        if (!parsed.success) { result.issues.push('INVALID_ROW'); continue; }
        valid.push(parsed.data);
      }
      const fingerprint = JSON.stringify(valid);
      if (fingerprints.has(fingerprint)) { result.issues.push('REPEATED_PAGE'); break; }
      fingerprints.add(fingerprint);
      for (const row of valid) {
        if (conflicts.has(row.id)) continue;
        if (ids.has(row.id)) {
          result.duplicates++; result.issues.push('DUPLICATE_ID');
          const index = result.rows.findIndex(r => r.id === row.id);
          if (mergeDuplicate) try { result.rows[index] = mergeDuplicate(result.rows[index]!, row); }
          catch {
            result.rows.splice(index, 1); conflicts.add(row.id); result.issues.push('CONFLICTING_DUPLICATE_EVENT');
          }
          continue;
        }
        ids.add(row.id); result.rows.push(row);
      }
      if (envelope.next === null) {
        result.complete = result.issues.length === 0 && result.rows.length === result.count;
        if (result.rows.length !== result.count) result.issues.push('COUNT_MISMATCH');
        break;
      }
      page = nextPage(envelope.next, url, page);
    }
    if (!result.complete && result.issues.length === 0) result.issues.push('PAGE_BUDGET');
  } catch (error) { result.issues.push(error instanceof DataError ? error.code : 'PROVIDER_SCHEMA'); }
  return result;
}

export type KudaDownload = {
  city?: CityKey;
  retrievedAt: string; window: { start: string; end: string }; location: { slug: string; name: string; timezone: string } | null;
  categories: { slug: string; name: string }[]; events: PageResult<KudaEvent>; places: PageResult<KudaPlace>;
  issues: string[];
  observations?: FactObservation[];
};
const factObservationSchema = z.discriminatedUnion('entity', [
  z.object({ entity: z.literal('event'), data: eventSchema, retrievedAt: z.string().datetime({ offset: true }).nullable(),
    requestUrl: z.string().url().nullable() }),
  z.object({ entity: z.literal('place'), data: placeSchema, retrievedAt: z.string().datetime({ offset: true }).nullable(),
    requestUrl: z.string().url().nullable() }),
]);
export type FactObservation = z.infer<typeof factObservationSchema>;
export function observationsOf(download: KudaDownload): FactObservation[] {
  return download.observations ?? [
    ...download.events.rows.map(data => ({ entity: 'event' as const, data, retrievedAt: download.retrievedAt, requestUrl: null })),
    ...download.places.rows.map(data => ({ entity: 'place' as const, data, retrievedAt: null, requestUrl: null })),
  ];
}
export function chronological(observations: FactObservation[]): FactObservation[] {
  return observations.map((row, index) => ({ row, index })).sort((a, b) =>
    Date.parse(a.row.retrievedAt ?? '1970-01-01T00:00:00Z') - Date.parse(b.row.retrievedAt ?? '1970-01-01T00:00:00Z')
    || a.index - b.index).map(item => item.row);
}
export function addObservation(download: KudaDownload, input: FactObservation): void {
  const observation = factObservationSchema.parse(input);
  download.observations = chronological([...observationsOf(download), observation]);
  const rows = observation.entity === 'event' ? download.events.rows : download.places.rows;
  const index = rows.findIndex(row => row.id === observation.data.id);
  // Только присутствующие поля. Явные null/false/закрытие не скрываются старым значением.
  const merged = Object.assign({}, ...download.observations
    .filter(row => row.entity === observation.entity && row.data.id === observation.data.id).map(row => row.data));
  if (index >= 0) rows[index] = merged as KudaEvent & KudaPlace;
  else rows.push(merged as KudaEvent & KudaPlace);
}
export function validateDownload(value: unknown): KudaDownload {
  const page = <T extends z.ZodType>(row: T) => z.object({ rows: z.array(row), count: z.number().int().nonnegative().nullable(),
    retrieved: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(), pages: z.number().int().nonnegative(),
    complete: z.boolean(), issues: z.array(z.string()) });
  return z.object({ retrievedAt: z.string().datetime({ offset: true }),
    window: z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) })
      .refine(w => Date.parse(w.end) - Date.parse(w.start) === 30 * 86400000),
    city:cityKeySchema.optional(),location: z.object({ slug:cityKeySchema,name:z.string(),timezone:timezoneSchema }).nullable(),
    categories: z.array(z.object({ slug: z.string(), name: z.string() })),
    events: page(eventSchema), places: page(placeSchema), issues: z.array(z.string()),
    observations: z.array(factObservationSchema).optional() }).refine(d=>!d.location||d.location.slug===(d.city??'kzn')&&d.location.timezone===cities[d.city??'kzn'].timezone,'download_city').parse(value);
}
export function mergeEvent(first: KudaEvent, later: KudaEvent): KudaEvent {
  const { dates: firstDates, ...a } = first, { dates: laterDates, ...b } = later;
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new DataError('CONFLICTING_DUPLICATE_EVENT');
  return { ...first, dates: [...new Map([...(firstDates ?? []), ...(laterDates ?? [])].map(d => [JSON.stringify(d), d])).values()] };
}
export function moscowWindow(clock: Date): { start: string; end: string } {
  const date = new Date(clock.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00+03:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 30 * 86400000).toISOString() };
}

export async function enrichFromCityPlaces(client: JsonClient, previous: KudaDownload): Promise<KudaDownload> {
  const result = structuredClone(previous), url = new URL(`${base}places/`);
  url.search = new URLSearchParams({ location: cityKeySchema.parse(previous.city??'kzn'), fields: placeFields, order_by: 'id', page_size: '100' }).toString();
  const found = await pages(client, url, placeSchema, 2);
  const needed = new Set(result.events.rows.flatMap(e => e.place ? [e.place.id] : []));
  const known = new Map(result.places.rows.map(p => [p.id, p]));
  for (const p of found.rows) if (needed.has(p.id)) known.set(p.id, p);
  result.places.rows = [...known.values()].sort((a, b) => a.id - b.id);
  result.places.retrieved += found.retrieved; result.places.pages += found.pages;
  result.places.complete = [...needed].every(id => known.has(id));
  result.places.issues = result.places.complete ? [] : [...new Set([...result.places.issues, ...found.issues, 'CITY_PLACE_COVERAGE_PARTIAL'])];
  return result;
}

// Документированная детализация — ограниченное дополнение после неуспешного
// bulk endpoint. Сначала площадки публично бесплатных событий для запроса FREE,
// затем числовой ID. Это порядок получения недостающих фактов, не рейтинг событий.
export async function enrichPlaces(client: JsonClient, previous: KudaDownload, limit = 12,
  priorityIds: number[] = [], attemptedIds: number[] = []): Promise<KudaDownload> {
  const result = structuredClone(previous);
  const ids = [...new Set(result.events.rows.flatMap(e => e.place ? [e.place.id] : []))];
  const freeIds = new Set(result.events.rows.filter(e => e.is_free).flatMap(e => e.place ? [e.place.id] : []));
  const known = new Map(result.places.rows.map(p => [p.id, p]));
  const priority = (id: number) => priorityIds.includes(id) ? priorityIds.indexOf(id) : Number.MAX_SAFE_INTEGER;
  const missing = ids.filter(id => !known.has(id) && !attemptedIds.includes(id)).sort((a, b) =>
    Number(freeIds.has(b)) - Number(freeIds.has(a)) || priority(a) - priority(b) || a - b);
  let failures = 0;
  for (const id of missing.slice(0, Math.min(12, limit))) {
    try {
      const row = placeSchema.parse(await client.get(`${base}places/${id}/`));
      if (row.id !== id) throw new DataError('PLACE_ID_MISMATCH');
      known.set(row.id, row); result.places.retrieved++;
    } catch (error) {
      result.places.issues.push(error instanceof DataError ? error.code : 'PROVIDER_SCHEMA');
      if (++failures >= 2) break;
    }
  }
  result.places.rows = [...known.values()].sort((a, b) => a.id - b.id);
  result.places.complete = ids.every(id => known.has(id));
  if (result.places.complete) result.places.issues = [];
  else if (!result.places.issues.includes('DETAIL_COVERAGE_PARTIAL')) result.places.issues.push('DETAIL_COVERAGE_PARTIAL');
  return result;
}

export async function fetchKudago(client: JsonClient, clock: Date, previous?: KudaDownload, expanded = false, city:CityKey='kzn'): Promise<KudaDownload> {
  city=cityKeySchema.parse(city);
  const empty = <T>(): PageResult<T> => ({ rows: [], count: null, retrieved: 0, duplicates: 0, pages: 0, complete: false, issues: [] });
  const result: KudaDownload = { city,retrievedAt: clock.toISOString(), window: cityWindow(clock,city), location: null,
    categories: [], events: empty(), places: empty(), issues: [] };
  if (previous && ((previous.city??'kzn')!==city||previous.window.start !== result.window.start || previous.window.end !== result.window.end))
    throw new DataError('RESUME_SCOPE_CHANGED');
  if (previous) result.retrievedAt = previous.retrievedAt;
  if (previous) result.location = previous.location;
  else try {
    result.location = z.object({ slug: z.literal(city), name: z.literal(cities[city].name), timezone: z.literal(cities[city].timezone) })
      .parse(await client.get(`${base}locations/${city}/?fields=slug,name,timezone`));
  } catch { result.issues.push('LOCATION_UNAVAILABLE'); }
  try {
    const url = new URL(`${base}events/`);
    const params = { location: city, actual_since: String(Date.parse(result.window.start) / 1000),
      actual_until: String(Date.parse(result.window.end) / 1000 - 1), order_by: 'id', page_size: '100',
      fields: eventFields, expand: expanded ? 'dates,place,location' : 'dates', categories: culturalCategories.join(',') };
    url.search = new URLSearchParams(params).toString();
    result.events = previous?.events.complete && !expanded ? previous.events : await pages(client, url, eventSchema, 6, mergeEvent);
    const venueIds = [...new Set(result.events.rows.flatMap(e => e.place ? [e.place.id] : []))].sort((a, b) => a - b);
    result.places = previous ? structuredClone(previous.places) : { ...empty<KudaPlace>(), count: 0, complete: true };
    if (expanded) {
      result.places.rows = [...new Map(result.events.rows.flatMap(e => e.place && e.place.address ? [[e.place.id, e.place] as const] : [])).values()];
      result.places.count = result.places.rows.length; result.places.retrieved = result.places.rows.length;
      result.places.complete = result.places.rows.length === venueIds.length;
    }
    const missingIds = venueIds.filter(id => !result.places.rows.some(p => p.id === id));
    for (let i = 0; !expanded && i < missingIds.length; i += 50) {
      const placesUrl = new URL(`${base}places/`);
      placesUrl.search = new URLSearchParams({ ids: missingIds.slice(i, i + 50).join(','), fields: placeFields, order_by: 'id', page_size: '100' }).toString();
      const part = await pages(client, placesUrl, placeSchema, 2);
      result.places.rows.push(...part.rows); result.places.count! += part.count ?? 0;
      result.places.retrieved += part.retrieved; result.places.pages += part.pages; result.places.duplicates += part.duplicates;
      result.places.complete &&= part.complete; result.places.issues.push(...part.issues);
    }
    const allPlaces = venueIds.every(id => result.places.rows.some(p => p.id === id));
    const conflictingPlaces = result.places.issues.some(issue => /DUPLICATE|CONFLICT|INVALID|COUNT_CHANGED|REPEATED|PAGINATION|PROVIDER_SCHEMA/.test(issue));
    result.places.complete = allPlaces && !conflictingPlaces;
    if (result.places.complete) result.places.issues = [];
    else if (!allPlaces) result.places.issues.push('MISSING_VENUES');
  } catch (error) { result.issues.push(error instanceof DataError ? error.code : 'PROVIDER_SCHEMA'); }
  try {
    result.categories = previous?.categories.length ? previous.categories : z.array(z.object({ slug: z.string(), name: z.string() }))
      .parse(await client.get(`${base}event-categories/?fields=slug,name&order_by=slug`));
  } catch { result.issues.push('CATEGORIES_UNAVAILABLE'); }
  if (!result.location && !result.issues.includes('LOCATION_UNAVAILABLE')) result.issues.push('LOCATION_UNAVAILABLE');
  return result;
}
