import { z } from 'zod';

export function safeLink(value: unknown, host?: string): string | null {
  if (typeof value !== 'string' || !value || /[\s<>\\\u0000-\u001f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !url.hostname.includes('.') || url.hostname === 'localhost' || /^(?:\d+\.){3}\d+$/.test(url.hostname)
      || url.hostname.endsWith('.local') || (host && url.hostname !== host
        && !(host === 'kudago.com' && url.hostname === 'kzn.kudago.com'))) return null;
    return value; // Сохраняем исходный адрес, не конструируем URL по ID/названию.
  } catch { return null; }
}
const instant = z.string().datetime({ offset: true });
const date = z.string().date();
const text = z.string().max(4000);
const link = z.string().refine(v => safeLink(v) !== null);
const namespace = z.string().regex(/^(kudago|timepad|synthetic):[a-zA-Z0-9:_-]+$/);
const nullableInstant = instant.nullable();
export const observationSchema = z.object({ retrievedAt: nullableInstant, requestUrl: link.nullable(),
  fields: z.array(z.string()), conflicts: z.array(z.string()) }).strict();
export type Observation = z.infer<typeof observationSchema>;
const interval = z.object({ weekday: z.number().int().min(0).max(6), open: z.number().int().min(0).max(1439),
  close: z.number().int().min(1).max(1440), lastEntry: z.number().int().min(0).max(1440).nullable() }).strict()
  .refine(v => v.close > v.open && (v.lastEntry === null || (v.lastEntry >= v.open && v.lastEntry <= v.close)));
export type OpeningInterval = z.infer<typeof interval>;
export const priceSchema = z.object({ kind: z.enum(['FREE', 'EXACT', 'FROM', 'RANGE', 'CONDITIONAL', 'UNKNOWN', 'CONFLICT']),
  amount: z.number().nonnegative().nullable(), lowerBound: z.number().nonnegative().nullable(), currency: z.literal('RUB').nullable(),
  applicability: z.enum(['SINGLE_ADULT', 'UNRESOLVED']), evidence: text.nullable(), conditions: z.array(text) }).strict();
export type Price = z.infer<typeof priceSchema>;
export const venueSchema = z.object({ id: namespace, title: text.nullable(), city: z.string().nullable(), zone: z.string().nullable(),
  address: text.nullable(), sourceUrl: link.nullable(), websiteUrl: link.nullable(),
  closed: z.boolean().nullable(), stub: z.boolean().nullable(), physical: z.boolean().nullable(),
  observations: z.array(observationSchema),
  coordinates: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable(),
  timetable: text.nullable(), opening: z.array(interval).nullable() }).strict();
export const occurrenceSchema = z.object({ id: namespace, venueId: namespace.nullable(),
  kind: z.enum(['TIMED_SESSION', 'FLEXIBLE_VISIT', 'UNRESOLVED']), timezone: z.literal('Europe/Moscow'),
  start: nullableInstant, end: nullableInstant, durationMinutes: z.number().positive().max(1440).nullable(),
  endBasis: z.enum(['PUBLISHED', 'PUBLISHED_DURATION', 'UNKNOWN']),
  activeFrom: date.nullable(), activeThrough: date.nullable(), startless: z.boolean(), endless: z.boolean(),
  opening: z.array(interval).nullable(), scheduleBasis: z.enum(['PLACE_TIMETABLE', 'STRUCTURED', 'UNKNOWN']),
  metadata: z.object({ continuous: z.boolean().nullable(), usePlaceSchedule: z.boolean().nullable(),
    structuredSchedulePresent: z.boolean(), equalEndpoints: z.boolean(), placeholderEnd: z.boolean() }).strict(),
  issues: z.array(text) }).strict();
export const normalizedEventSchema = z.object({ id: namespace, provider: z.enum(['kudago', 'timepad', 'synthetic']),
  title: text.min(1), city: z.string().nullable(), categories: z.array(z.string()), price: priceSchema,
  admission: z.object({ registration: z.enum(['REQUIRED', 'NOT_REQUIRED', 'UNKNOWN']), conditions: z.array(text),
    ticketAvailability: z.literal('NOT_VERIFIED') }).strict(),
  sourceUrl: link, sourceLabel: text.min(1), organizerUrl: link.nullable(), ticketUrl: link.nullable(),
  publicationAt: nullableInstant, providerUpdatedAt: nullableInstant, retrievedAt: instant,
  observations: z.array(observationSchema), cancelled: z.boolean().nullable(),
  verification: z.enum(['API_FACTS_ONLY', 'SYNTHETIC_FIXTURE']),
  advertisingAssessment: z.enum(['NOT_EXPOSED_BY_API', 'SYNTHETIC']),
  occurrences: z.array(occurrenceSchema), issues: z.array(text) }).strict();
const statistics = z.object({ providerCount: z.number().int().nonnegative().nullable(), retrievedRows: z.number().int().nonnegative(),
  uniqueProviderIds: z.number().int().nonnegative(), duplicateIds: z.number().int().nonnegative(), pages: z.number().int().nonnegative(),
  normalizedEvents: z.number().int().nonnegative(), occurrences: z.number().int().nonnegative(), venues: z.number().int().nonnegative(),
  omitted: z.record(z.string(), z.number().int().nonnegative()) }).strict();
export const snapshotSchema = z.object({ version: z.literal(2), mode: z.enum(['LIVE_PUBLIC', 'SYNTHETIC_FIXTURE']),
  scope: z.object({ city: z.literal('kzn'), timezone: z.literal('Europe/Moscow'), start: instant, end: instant,
    categories: z.array(z.string()), zone: z.null() }).strict(),
  retrievedAt: instant, freshnessHours: z.literal(24), outcome: z.enum(['COMPLETE', 'PARTIAL', 'FAILED']),
  paginationComplete: z.boolean(), venueCoverageComplete: z.boolean(), enrichedAt: nullableInstant,
  coverage: z.literal('PROVIDER_CATALOG_ONLY'),
  publicDisplay: z.literal('NOT_CLEARED'), issues: z.array(text), stats: statistics,
  events: z.array(normalizedEventSchema).max(5000), venues: z.array(venueSchema).max(5000) }).strict().superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
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
      if (e.provider === 'kudago' && safeLink(e.sourceUrl, 'kudago.com') === null) fail('source_host');
      if (e.provider === 'kudago' && e.verification === 'API_FACTS_ONLY' && e.sourceLabel !== 'Источник: KudaGo') fail('source_attribution');
      if (['FREE', 'EXACT'].includes(e.price.kind) && (e.price.amount === null || e.price.currency !== 'RUB'
        || e.price.applicability !== 'SINGLE_ADULT' || (e.price.kind === 'FREE' && e.price.amount !== 0))) fail('price_proof');
      for (const o of e.occurrences) {
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

export const querySchema = z.object({ city: z.literal('kzn'), start: instant, end: instant,
  budgetRub: z.number().nonnegative().nullable(), category: z.string().nullable(), zone: z.string().nullable(),
  kind: z.enum(['ANY', 'TIMED_SESSION', 'FLEXIBLE_VISIT']),
  preferences: z.object({ categories: z.array(z.string()) }).strict() }).strict().refine(q =>
    Date.parse(q.end) > Date.parse(q.start) && Date.parse(q.end) - Date.parse(q.start) <= 7 * 86400000, 'query_interval');
export type Query = z.infer<typeof querySchema>;
