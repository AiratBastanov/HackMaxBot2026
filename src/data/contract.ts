import { z } from 'zod';
import { cities, cityKeySchema, timezoneSchema } from './cities.js';

export function safeLink(value: unknown, host?: string): string | null {
  if (typeof value !== 'string' || !value || /[\s<>\\\u0000-\u001f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !url.hostname.includes('.') || url.hostname === 'localhost' || /^(?:\d+\.){3}\d+$/.test(url.hostname)
      || url.hostname.endsWith('.local') || (host && url.hostname !== host
        && !(host === 'kudago.com' && Object.keys(cities).some(c => url.hostname === `${c}.kudago.com`)))) return null;
    return value; // Сохраняем исходный адрес, не конструируем URL по ID/названию.
  } catch { return null; }
}
const instant = z.string().datetime({ offset: true });
const date = z.string().date();
const text = z.string().max(4000);
const link = z.string().refine(v => safeLink(v) !== null);
const namespace = z.string().regex(/^(kudago|timepad|synthetic|kazan-kremlin|mie|tatmuseum|kamal|uralopera|sgaf):[a-zA-Z0-9:_-]+$/);
const nullableInstant = instant.nullable();
export const observationSchema = z.object({ retrievedAt: nullableInstant, requestUrl: link.nullable(),
  fields: z.array(z.string()), conflicts: z.array(z.string()),
  provenance: z.object({ extractor: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    method: z.enum(['AUTOMATIC_HTML', 'PREPARED_REAL']) }).strict().optional() }).strict();
export type Observation = z.infer<typeof observationSchema>;
const interval = z.object({ weekday: z.number().int().min(0).max(6), open: z.number().int().min(0).max(1439),
  close: z.number().int().min(1).max(1440), lastEntry: z.number().int().min(0).max(1440).nullable(),
  salesCutoff: z.number().int().min(0).max(1440).nullable().optional() }).strict()
  .refine(v => v.close > v.open && (v.lastEntry === null || (v.lastEntry >= v.open && v.lastEntry <= v.close)));
export type OpeningInterval = z.infer<typeof interval>;
export const priceSchema = z.object({ kind: z.enum(['FREE', 'EXACT', 'FROM', 'RANGE', 'CONDITIONAL', 'UNKNOWN', 'CONFLICT']),
  amount: z.number().nonnegative().nullable(), lowerBound: z.number().nonnegative().nullable(), upperBound:z.number().nonnegative().nullable().optional(), currency: z.literal('RUB').nullable(),
  applicability: z.enum(['SINGLE_ADULT', 'UNRESOLVED']), evidence: text.nullable(), conditions: z.array(text) }).strict();
export type Price = z.infer<typeof priceSchema>;
export const partySchema = z.object({ adults: z.number().int().min(1).max(8),
  childAges: z.array(z.number().int().min(0).max(17).nullable()).max(7) }).strict()
  .refine(p => p.adults + p.childAges.length <= 8, 'party_max_8');
export type Party = z.infer<typeof partySchema>;
export const tariffSchema = z.object({ audience: z.enum(['ADULT', 'CHILD', 'GROUP']),
  minAge: z.number().int().min(0).max(17).nullable(), maxAge: z.number().int().min(0).max(17).nullable(),
  kind: z.enum(['EXACT', 'FREE', 'FROM', 'CONDITIONAL', 'PACKAGE', 'UNKNOWN']),
  amount: z.number().nonnegative().nullable(), lowerBound: z.number().nonnegative().nullable(),
  currency: z.literal('RUB'), applicable: z.boolean(), conditions: z.array(text), evidence: text.nullable() }).strict()
  .refine(t => t.minAge === null || t.maxAge === null || t.minAge <= t.maxAge, 'tariff_age_band')
  .refine(t => !['EXACT','FREE'].includes(t.kind) || t.amount !== null && (t.kind !== 'FREE' || t.amount === 0), 'tariff_amount');
export const venueSchema = z.object({ id: namespace, title: text.nullable(), city: z.string().nullable(), zone: z.string().nullable(),
  address: text.nullable(), sourceUrl: link.nullable(), websiteUrl: link.nullable(),
  closed: z.boolean().nullable(), stub: z.boolean().nullable(), physical: z.boolean().nullable(),
  observations: z.array(observationSchema),
  coordinates: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable(),
  timetable: text.nullable(), opening: z.array(interval).nullable() }).strict();
export const occurrenceSchema = z.object({ id: namespace, venueId: namespace.nullable(),
  sourceUrl:link.optional(),ticketUrl:link.optional(),closedDates:z.array(date).max(40).optional(),
  kind: z.enum(['TIMED_SESSION', 'FLEXIBLE_VISIT', 'UNRESOLVED']), timezone: timezoneSchema,
  start: nullableInstant, end: nullableInstant, durationMinutes: z.number().positive().max(1440).nullable(),
  endBasis: z.enum(['PUBLISHED', 'PUBLISHED_DURATION', 'UNKNOWN']),
  activeFrom: date.nullable(), activeThrough: date.nullable(), startless: z.boolean(), endless: z.boolean(),
  opening: z.array(interval).nullable(), scheduleBasis: z.enum(['PLACE_TIMETABLE', 'STRUCTURED', 'UNKNOWN']),
  metadata: z.object({ continuous: z.boolean().nullable(), usePlaceSchedule: z.boolean().nullable(),
    structuredSchedulePresent: z.boolean(), equalEndpoints: z.boolean(), placeholderEnd: z.boolean() }).strict(),
  issues: z.array(text) }).strict();
export const normalizedEventSchema = z.object({ id: namespace, provider: z.enum(['kudago', 'timepad', 'synthetic', 'kazan-kremlin', 'mie','tatmuseum','kamal','uralopera','sgaf']),
  title: text.min(1), city: z.string().nullable(), categories: z.array(z.string()), price: priceSchema,
  tariffs: z.array(tariffSchema).max(30).optional(), providerAgeLabel: text.nullable().optional(),
  admission: z.object({ registration: z.enum(['REQUIRED', 'NOT_REQUIRED', 'UNKNOWN']), conditions: z.array(text),
    requirements: z.object({ minimumAge: z.number().int().min(0).max(99).nullable(),
      children: z.enum(['ALLOWED', 'PROHIBITED', 'UNKNOWN']), accompaniedByAdult: z.enum(['REQUIRED', 'NOT_REQUIRED', 'UNKNOWN']) }).strict().optional(),
    ticketAvailability: z.literal('NOT_VERIFIED') }).strict(),
  sourceUrl: link, sourceLabel: text.min(1), organizerUrl: link.nullable(), ticketUrl: link.nullable(),
  publicationAt: nullableInstant, providerUpdatedAt: nullableInstant, retrievedAt: instant,
  observations: z.array(observationSchema), cancelled: z.boolean().nullable(),
  verification: z.enum(['API_FACTS_ONLY', 'SYNTHETIC_FIXTURE', 'EXTRACTED_FACTS', 'PREPARED_REAL']),
  advertisingAssessment: z.enum(['NOT_EXPOSED_BY_API', 'SYNTHETIC', 'FACTS_ONLY']),
  occurrences: z.array(occurrenceSchema), issues: z.array(text) }).strict();
const statistics = z.object({ providerCount: z.number().int().nonnegative().nullable(), retrievedRows: z.number().int().nonnegative(),
  uniqueProviderIds: z.number().int().nonnegative(), duplicateIds: z.number().int().nonnegative(), pages: z.number().int().nonnegative(),
  normalizedEvents: z.number().int().nonnegative(), occurrences: z.number().int().nonnegative(), venues: z.number().int().nonnegative(),
  omitted: z.record(z.string(), z.number().int().nonnegative()) }).strict();
export const snapshotSchema = z.object({ version: z.literal(2), mode: z.enum(['LIVE_PUBLIC', 'SYNTHETIC_FIXTURE', 'REAL_CATALOG']),
  scope: z.object({ city: cityKeySchema, timezone: timezoneSchema, start: instant, end: instant,
    categories: z.array(z.string()), zone: z.null() }).strict(),
  retrievedAt: instant, freshnessHours: z.number().int().min(1).max(168), outcome: z.enum(['COMPLETE', 'PARTIAL', 'FAILED']),
  paginationComplete: z.boolean(), venueCoverageComplete: z.boolean(), enrichedAt: nullableInstant,
  coverage: z.literal('PROVIDER_CATALOG_ONLY'),
  publicDisplay: z.literal('NOT_CLEARED'), issues: z.array(text), stats: statistics,
  events: z.array(normalizedEventSchema).max(5000), venues: z.array(venueSchema).max(5000) }).strict().superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (cities[s.scope.city].timezone !== s.scope.timezone) fail('city_timezone');
    if(s.mode!=='REAL_CATALOG'&&s.freshnessHours!==24)fail('legacy_freshness');
    if (Date.parse(s.scope.end) <= Date.parse(s.scope.start)) fail('scope_interval');
    if (s.outcome === 'COMPLETE' && (!s.paginationComplete || !s.venueCoverageComplete)) fail('completeness');
    if (s.outcome === 'FAILED' && s.events.length) fail('failed_with_events');
    const eventIds = new Set<string>(), venueIds = new Set<string>(), occurrenceIds = new Set<string>();
    for (const v of s.venues) { if (venueIds.has(v.id)) fail('duplicate_venue'); venueIds.add(v.id); }
    for (const e of s.events) {
      if (eventIds.has(e.id)) fail('duplicate_event'); eventIds.add(e.id);
      if (!e.id.startsWith(`${e.provider}:`)) fail('provider_namespace');
      if (s.mode === 'LIVE_PUBLIC' && (e.provider === 'synthetic' || e.verification !== 'API_FACTS_ONLY')) fail('synthetic_in_live');
      if (s.mode === 'SYNTHETIC_FIXTURE' && e.verification !== 'SYNTHETIC_FIXTURE') fail('unmarked_fixture');
      if (s.mode === 'REAL_CATALOG' && (!['kazan-kremlin','mie','tatmuseum','kamal','uralopera','sgaf'].includes(e.provider)
        || !['EXTRACTED_FACTS','PREPARED_REAL'].includes(e.verification)
        || !e.observations.length || e.observations.some(o => !o.provenance || !o.retrievedAt))) fail('real_provenance');
      if(s.mode==='REAL_CATALOG'&&e.observations.some(o=>o.requestUrl===null||new URL(o.requestUrl).origin!==new URL(e.sourceUrl).origin))fail('real_provenance_origin');
      if (e.provider === 'kudago' && safeLink(e.sourceUrl, 'kudago.com') === null) fail('source_host');
      if (e.provider === 'kudago' && e.verification === 'API_FACTS_ONLY' && e.sourceLabel !== 'Источник: KudaGo') fail('source_attribution');
      if (['FREE', 'EXACT'].includes(e.price.kind) && (e.price.amount === null || e.price.currency !== 'RUB'
        || e.price.applicability !== 'SINGLE_ADULT' || (e.price.kind === 'FREE' && e.price.amount !== 0))) fail('price_proof');
      for (const o of e.occurrences) {
        if (o.timezone !== s.scope.timezone) fail('occurrence_timezone');
        if (!o.id.startsWith(`${e.id}:`) || occurrenceIds.has(o.id)) fail('occurrence_identity'); occurrenceIds.add(o.id);
        if (o.venueId !== null && !venueIds.has(o.venueId)) fail('missing_venue');
        if (o.end && (!o.start || Date.parse(o.end) <= Date.parse(o.start))) fail('invalid_session_end');
        if (o.durationMinutes !== null && o.endBasis !== 'PUBLISHED_DURATION') fail('unpublished_duration');
        if (o.endBasis === 'PUBLISHED_DURATION' && (o.start === null || o.durationMinutes === null
          || (o.end !== null && Date.parse(o.end) !== Date.parse(o.start) + o.durationMinutes * 60000))) fail('duration_units');
        if (o.end !== null && o.endBasis === 'UNKNOWN') fail('unknown_end_basis');
        if (o.activeFrom && o.activeThrough && o.activeThrough < o.activeFrom) fail('invalid_period');
        if (o.opening !== null && o.scheduleBasis === 'UNKNOWN') fail('schedule_evidence');
      }
    }
    if (s.stats.normalizedEvents !== s.events.length || s.stats.occurrences !== occurrenceIds.size
      || s.stats.venues !== s.venues.length) fail('statistics');
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type Occurrence = z.infer<typeof occurrenceSchema>;
export type Venue = z.infer<typeof venueSchema>;
export function validateSnapshot(value: unknown): Snapshot {
  // Только детерминированная миграция v1; старые файлы на диске не переписываются.
  // В v1 времени наблюдения площадки не было: не приписываем ей дату события.
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
    const old = structuredClone(value) as Record<string, any>;
    old.version = 2; old.enrichedAt = null; old.venueCoverageComplete = old.paginationComplete;
    if (Array.isArray(old.events)) for (const e of old.events) {
      e.observations = []; e.cancelled = null;
      if (e.price) e.price.lowerBound = null;
    }
    if (Array.isArray(old.venues)) for (const v of old.venues) { v.observations = []; v.stub = null; }
    return snapshotSchema.parse(old);
  }
  return snapshotSchema.parse(value);
}

export const querySchema = z.object({ version: z.literal(2).optional(), city: cityKeySchema, timezone: timezoneSchema.optional(), start: instant, end: instant,
  // Границы местного дня ограничивают начало сеанса, но не его опубликованное окончание.
  timeMode: z.literal('ANY').optional(),
  party: partySchema.optional(), budgetBasis: z.enum(['PARTY_TOTAL', 'SINGLE_ADULT']).optional(),
  budgetRub: z.number().nonnegative().nullable(), category: z.string().nullable(), zone: z.string().nullable(),
  kind: z.enum(['ANY', 'TIMED_SESSION', 'FLEXIBLE_VISIT']),
  preferences: z.object({ categories: z.array(z.string()) }).strict() }).strict().refine(q =>
    Date.parse(q.end) > Date.parse(q.start) && Date.parse(q.end) - Date.parse(q.start) <= 7 * 86400000, 'query_interval')
  .refine(q => q.timezone === undefined || q.timezone === cities[q.city].timezone, 'query_timezone')
  .refine(q => q.version !== 2 || Boolean(q.party && q.timezone && q.budgetBasis === 'PARTY_TOTAL'), 'query_v2_context')
  .refine(q => q.budgetBasis === 'PARTY_TOTAL' || !q.party || q.party.adults === 1 && !q.party.childAges.length, 'legacy_budget_basis');
export type Query = z.infer<typeof querySchema>;
export const queryParty = (q: Query): Party => q.party ?? { adults: 1, childAges: [] };
