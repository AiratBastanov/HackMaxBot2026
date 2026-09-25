import { createHash } from 'node:crypto';
import { type KudaDownload, type KudaEvent, type KudaPlace, type FactObservation, chronological, observationsOf, culturalCategories, dateSchema, eventSchema, placeSchema } from './kudago.js';
import { type Snapshot, type Price, type OpeningInterval, type Occurrence, type Venue, type Observation, safeLink, validateSnapshot } from './contract.js';
import { cities, cityKeySchema, cityDate, type Timezone } from './cities.js';

export function normalizePrice(raw: string | null | undefined, free: boolean | null | undefined): Price {
  const value = (raw ?? '').trim().toLowerCase().replace(/\u00a0/g, ' ');
  const base: Price = { kind: 'UNKNOWN', amount: null, lowerBound: null, currency: 'RUB', applicability: 'UNRESOLVED', evidence: raw ?? null, conditions: [] };
  const plainlyFree = /^(бесплатно|вход свободный|0 (?:₽|руб\.?|рублей))\.?$/.test(value);
  if (free === false && plainlyFree) return { ...base, kind: 'CONFLICT' };
  if (free === true && (!value || plainlyFree)) return { ...base, kind: 'FREE', amount: 0, applicability: 'SINGLE_ADULT' };
  if (plainlyFree && free !== false) return { ...base, kind: 'FREE', amount: 0, applicability: 'SINGLE_ADULT' };
  if (/групп|льгот|пенсион|студент|дет[ися]|промо|при |по |регистрац|бесплат|свободн/.test(value))
    return { ...base, kind: 'CONDITIONAL', conditions: [raw ?? 'Неизвестные условия'] };
  if (free === true && /\d/.test(value) && !/бесплат|свободн/.test(value)) return { ...base, kind: 'CONFLICT' };
  if (/^от\s+\d/.test(value)) {
    const bound = value.match(/^от\s+(\d+(?: \d{3})*(?:[.,]\d{1,2})?)(?:\s+до\s+\d+(?: \d{3})*(?:[.,]\d{1,2})?)?\s*(?:₽|руб\.?|рублей|рубля)\.?$/);
    return { ...base, kind: 'FROM', lowerBound: bound ? Number(bound[1]!.replace(/ /g, '').replace(',', '.')) : null };
  }
  if (/\d\s*[-–—]\s*\d/.test(value)) return { ...base, kind: 'RANGE' };
  const exact = value.match(/^(?:(?:взрослый билет|для взрослых|вход)\s*[:—-]?\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|рублей|рубля)(?: с человека)?\.?$/);
  if (exact && free !== true) return { ...base, kind: 'EXACT', amount: Number(exact[1]!.replace(',', '.')), applicability: 'SINGLE_ADULT' };
  return base;
}

const dayNames = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
// Малый закрытый язык: «ежедневно 10:00–18:00», «вт–пт 10:00–18:00,
// сб, вс 11:00–17:00». Несколько интервалов через /; закрытые дни — «выходной».
// Любая непонятая часть (праздники, сезонность, касса, по записи) отменяет весь parse.
export function parseTimetable(raw: string | null | undefined): OpeningInterval[] | null {
  if (!raw) return null;
  const value = raw.toLowerCase().replace(/[–—]/g, '-').replace(/\u00a0/g, ' ').trim();
  const segments = value.replace(/(\d|выходной),\s*(?=пн|вт|ср|чт|пт|сб|вс|ежедневно)/g, '$1;').split(/;\s*/);
  const intervals: OpeningInterval[] = [], seen = new Set<number>();
  for (const segment of segments) {
    const match = segment.match(/^(ежедневно|(?:пн|вт|ср|чт|пт|сб|вс)(?:-(?:пн|вт|ср|чт|пт|сб|вс))?(?:,\s*(?:пн|вт|ср|чт|пт|сб|вс))*)\s+(.+)$/);
    if (!match) return null;
    const days: number[] = [];
    if (match[1] === 'ежедневно') days.push(0, 1, 2, 3, 4, 5, 6);
    else for (const part of match[1]!.split(/,\s*/)) {
      const [first, last] = part.split('-'); const start = dayNames.indexOf(first!); const end = last ? dayNames.indexOf(last) : start;
      if (start < 0 || end < start) return null;
      for (let d = start; d <= end; d++) days.push((d + 1) % 7); // JS Sunday = 0
    }
    if (days.some(d => seen.has(d))) return null;
    days.forEach(d => seen.add(d));
    if (match[2] === 'выходной') continue;
    for (const times of match[2]!.split(/\s*\/\s*/)) {
      const time = times.match(/^(\d{1,2}):([0-5]\d)-(\d{1,2}):([0-5]\d)$/);
      if (!time) return null;
      const open = Number(time[1]) * 60 + Number(time[2]), close = Number(time[3]) * 60 + Number(time[4]);
      if (open < 0 || open >= 1440 || close <= open || close > 1440) return null;
      for (const weekday of days) intervals.push({ weekday, open, close, lastEntry: null });
    }
  }
  // В краткой недельной записи не перечисленные дни считаются закрытыми только
  // когда присутствует хотя бы один явный день; исключения текстом отвергаются выше.
  return intervals.sort((a, b) => a.weekday - b.weekday || a.open - b.open);
}
export function isoSeconds(value: number | null | undefined): string | null {
  return value !== null && value !== undefined && Number.isSafeInteger(value) && value >= 0 && value < 4102444800
    ? new Date(value * 1000).toISOString() : null;
}
export const localDate = cityDate;
function dateOnly(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value ? value : null;
}
function venue(row: KudaPlace, observations: Observation[] = []): Venue {
  const coords = row.coords;
  return { id: `kudago:place:${row.id}`, title: row.title ?? null, city: row.location ?? null, zone: null,
    address: row.address ?? null, sourceUrl: safeLink(row.site_url, 'kudago.com'), websiteUrl: safeLink(row.foreign_url),
    closed: row.is_closed ?? null, stub: row.is_stub ?? null, observations,
    physical: Boolean(row.address?.trim()) && row.location !== 'online' ? true : null,
    coordinates: coords?.lat != null && coords.lon != null && Math.abs(coords.lat) <= 90 && Math.abs(coords.lon) <= 180
      ? { lat: coords.lat, lon: coords.lon } : null,
    timetable: row.timetable ?? null, opening: parseTimetable(row.timetable) };
}
function occurrence(event: KudaEvent, raw: unknown, place: Venue | undefined, timezone:Timezone): Occurrence {
  const d = dateSchema.parse(raw), issues: string[] = [];
  const start = isoSeconds(d.start), end = isoSeconds(d.end);
  const delta = start && end ? Date.parse(end) - Date.parse(start) : 0;
  const equal = d.start != null && d.start === d.end;
  const placeholder = d.end != null && (end === null || d.end >= 2145916800); // 2038+ — не длительность сеанса.
  const exhibition = event.categories?.includes('exhibition') ?? false;
  const period = d.is_continuous === true || d.is_endless === true || d.use_place_schedule === true || delta > 86400000;
  // Часы музея сами по себе не делают экскурсию/игру свободным посещением.
  const kind = period ? (exhibition ? 'FLEXIBLE_VISIT' : 'UNRESOLVED') : 'TIMED_SESSION';
  const validEnd = kind === 'TIMED_SESSION' && !placeholder && delta > 0 && delta <= 86400000 ? end : null;
  if (kind === 'TIMED_SESSION' && !validEnd) issues.push('END_OR_DURATION_UNKNOWN');
  const structured = Boolean(d.schedules?.length);
  if (structured) issues.push('UNSUPPORTED_STRUCTURED_SCHEDULE', 'WEEKDAY_CONVENTION_UNVERIFIED');
  const opening = kind === 'FLEXIBLE_VISIT' && d.use_place_schedule === true && !structured ? place?.opening ?? null : null;
  if (kind === 'FLEXIBLE_VISIT' && opening === null && !structured) issues.push('OPENING_UNKNOWN');
  const identity = createHash('sha256').update(JSON.stringify(d)).digest('hex').slice(0, 20);
  return { id: `kudago:${event.id}:occ:${identity}`, venueId: place?.id ?? null, kind, timezone,
    start: kind === 'TIMED_SESSION' ? start : null, end: validEnd, durationMinutes: null,
    endBasis: validEnd ? 'PUBLISHED' : 'UNKNOWN',
    activeFrom: d.is_startless ? null : dateOnly(d.start_date) ?? (start ? localDate(start,timezone) : null),
    activeThrough: d.is_endless || placeholder ? null : dateOnly(d.end_date) ?? (end ? localDate(end,timezone) : null),
    startless: d.is_startless === true, endless: d.is_endless === true, opening,
    scheduleBasis: opening === null ? 'UNKNOWN' : 'PLACE_TIMETABLE',
    metadata: { continuous: d.is_continuous ?? null, usePlaceSchedule: d.use_place_schedule ?? null,
      structuredSchedulePresent: structured, equalEndpoints: equal, placeholderEnd: placeholder }, issues };
}
export function normalizeKudago(download: KudaDownload, mode: Snapshot['mode'] = 'LIVE_PUBLIC'): Snapshot {
  const scopeCity=cityKeySchema.parse(download.city??'kzn'),timezone=cities[scopeCity].timezone;
  const events = download.events.rows.map(e => eventSchema.parse(e));
  const observations = chronological(observationsOf(download));
  const describe = (rows: FactObservation[]): Observation[] => {
    let previous: Record<string, unknown> = {};
    return rows.map(row => {
      const data = row.data as Record<string, unknown>;
      const conflicts = Object.keys(data).filter(key => key !== 'id' && previous[key] !== undefined && previous[key] !== null && previous[key] !== ''
        && JSON.stringify(previous[key]) !== JSON.stringify(data[key]));
      previous = { ...previous, ...data };
      return { retrievedAt: row.retrievedAt ?? (mode === 'SYNTHETIC_FIXTURE' ? download.retrievedAt : null),
        requestUrl: row.requestUrl, fields: Object.keys(data), conflicts };
    });
  };
  const placeObservations = observations.flatMap(row => row.entity === 'place' ? [row]
    : row.data.place ? [{ ...row, entity: 'place' as const, data: row.data.place }] : []);
  const placeRows = new Map<number, KudaPlace>();
  // Расширенная идентичность полезна, но не обещает timetable или полный профиль.
  for (const event of events) if (event.place) placeRows.set(event.place.id, { ...placeRows.get(event.place.id), ...event.place });
  for (const p of download.places.rows) placeRows.set(p.id, { ...placeRows.get(p.id), ...placeSchema.parse(p) });
  // Более новые наблюдения имеют приоритет; отсутствующие поля не стирают кеш.
  for (const row of placeObservations)
    placeRows.set(row.data.id, { ...placeRows.get(row.data.id), ...row.data });
  const venues = [...placeRows.values()].map(p => venue(p, describe(placeObservations.filter(o => o.data.id === p.id))));
  const placeMap = new Map(venues.map(p => [p.id, p]));
  for (const event of events) if (event.place && !placeMap.has(`kudago:place:${event.place.id}`)) {
    const placeholder = venue({ id: event.place.id }); venues.push(placeholder); placeMap.set(placeholder.id, placeholder);
  }
  const omitted: Record<string, number> = {};
  const omit = (reason: string) => { omitted[reason] = (omitted[reason] ?? 0) + 1; };
  const normalized: Snapshot['events'] = [];
  for (const event of events) {
    const sourceUrl = safeLink(event.site_url, 'kudago.com');
    if (!sourceUrl) { omit('UNSAFE_OR_MISSING_SOURCE'); continue; }
    if (!/\p{L}{2}/u.test(event.title.trim()) || new URL(sourceUrl).pathname === '/') { omit('UNUSABLE_RECORD'); continue; }
    // Не удаляем рекламную маркировку ради рекомендации. API не документирует ad-флаг.
    if (/реклама|erid\s*[:=]/iu.test(`${event.title} ${event.price ?? ''} ${sourceUrl}`)) { omit('AD_MARKER'); continue; }
    if (!event.categories?.some(c => culturalCategories.includes(c))) { omit('CATEGORY_UNKNOWN_OR_OUTSIDE_SCOPE'); continue; }
    const city = typeof event.location === 'string' ? event.location : event.location?.slug ?? null;
    const place = event.place ? placeMap.get(`kudago:place:${event.place.id}`) : undefined;
    const unique = new Map<string, Occurrence>();
    for (const d of event.dates ?? []) {
      const o = occurrence(event, d, place,timezone);
      // Длинный период сохраняем по пересечению, не по публикации/началу в окне.
      if (o.activeThrough && o.activeThrough < localDate(download.window.start,timezone)) { omit('PAST_OCCURRENCE'); continue; }
      if (o.activeFrom && o.activeFrom >= localDate(download.window.end,timezone)) { omit('FUTURE_OCCURRENCE'); continue; }
      unique.set(o.id, o);
    }
    if (event.dates?.length && unique.size === 0) { omit('NO_OCCURRENCE_IN_WINDOW'); continue; }
    normalized.push({ id: `kudago:${event.id}`, provider: 'kudago', title: event.title, city,
      categories: event.categories, price: normalizePrice(event.price, event.is_free),
      ...(event.age_restriction!==undefined?{providerAgeLabel:event.age_restriction}:{}),
      admission: { registration: 'UNKNOWN', conditions: [], ticketAvailability: 'NOT_VERIFIED' },
      sourceUrl, sourceLabel: mode === 'LIVE_PUBLIC' ? 'Источник: KudaGo' : 'СИНТЕТИЧЕСКИЙ ПРИМЕР (формат KudaGo)', organizerUrl: null, ticketUrl: null,
      publicationAt: isoSeconds(event.publication_date), providerUpdatedAt: null,
      retrievedAt: observations.filter(o => o.entity === 'event' && o.data.id === event.id).at(-1)?.retrievedAt ?? download.retrievedAt,
      observations: describe(observations.filter(o => o.entity === 'event' && o.data.id === event.id)), cancelled: null,
      verification: mode === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC_FIXTURE' : 'API_FACTS_ONLY',
      advertisingAssessment: mode === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC' : 'NOT_EXPOSED_BY_API',
      occurrences: [...unique.values()], issues: ['CONDITIONS_NOT_REVERIFIED_BY_ORGANIZER', ...(!place ? ['VENUE_UNKNOWN'] : [])] });
  }
  const complete = download.events.complete && download.places.complete;
  return validateSnapshot({ version: 2, mode, scope: { city:scopeCity, timezone, ...download.window,
    categories: culturalCategories, zone: null }, retrievedAt: download.retrievedAt, freshnessHours: 24,
    outcome: complete ? 'COMPLETE' : normalized.length ? 'PARTIAL' : 'FAILED', paginationComplete: download.events.complete,
    venueCoverageComplete: download.places.complete,
    enrichedAt: observations.filter(o => o.requestUrl !== null).map(o => o.retrievedAt).filter((t): t is string => t !== null).sort().at(-1) ?? null,
    coverage: 'PROVIDER_CATALOG_ONLY', publicDisplay: 'NOT_CLEARED',
    issues: [...download.issues, ...download.events.issues, ...download.places.issues],
    stats: { providerCount: download.events.count, retrievedRows: download.events.retrieved, uniqueProviderIds: events.length,
      duplicateIds: download.events.duplicates, pages: download.events.pages, normalizedEvents: normalized.length,
      occurrences: normalized.reduce((n, e) => n + e.occurrences.length, 0), venues: venues.length, omitted },
    events: normalized, venues });
}
