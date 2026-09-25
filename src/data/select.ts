import { type Snapshot, type Query, type NormalizedEvent, type Occurrence, type Venue, type Observation, querySchema, validateSnapshot } from './contract.js';
import { localDate } from './normalize.js';
import { sourceReviews, type SourceReview } from './reviews.js';
import { cities, cityDate, cityInstant, localISO } from './cities.js';
import { assessParty, partyPrice, type PartyAssessment } from './party.js';

export const reasonText: Record<string, string> = {
  OTHER_CITY: 'В событии или площадке указан другой город.', VENUE_UNKNOWN: 'Не подтверждена физическая площадка в выбранном городе.',
  CLOSED: 'Площадка отмечена закрытой.', ZONE_UNKNOWN: 'Нет проверенного соответствия площадки выбранной зоне.',
  WRONG_ZONE: 'Площадка вне выбранной зоны.', WRONG_CATEGORY: 'Категория не соответствует запросу.',
  CATEGORY_UNKNOWN: 'Категория неизвестна.', WRONG_KIND: 'Другой режим посещения.',
  TIME_UNKNOWN: 'Не установлены начало, окончание или длительность конкретного сеанса.',
  PERIOD_UNKNOWN: 'Не установлены границы периода посещения.', OPENING_UNKNOWN: 'Нет применимого расписания на этот день.',
  OUTSIDE_WINDOW: 'Нет подходящего сеанса или пересечения часов входа с окном.',
  PRICE_UNKNOWN: 'Нельзя подтвердить итоговую цену для всех посетителей.', OVER_BUDGET: 'Доказанная стоимость выше бюджета на всех.',
  ADMISSION_UNKNOWN: 'Допуск выбранного состава посетителей требует уточнения.', ADMISSION_MISMATCH: 'Известные требования допуска несовместимы с составом посетителей.',
  NO_OCCURRENCES: 'Нет сведений о конкретных датах посещения.',
  CITY_UNKNOWN: 'Город указан только областью запроса провайдера; город события и площадки не подтверждён.',
  VENUE_CONFLICT: 'В наблюдениях расходятся город или адрес площадки; нужен актуальный адрес у источника.',
  CANCELLED: 'Событие отмечено отменённым.', FACTS_STALE: 'Давность применимых фактов больше 24 часов либо время их получения неизвестно.',
  KIND_UNKNOWN: 'Режим посещения не установлен.', UNUSABLE_RECORD: 'Нет содержательного названия или прямой ссылки на материал.',
};
export type Recommendation = { eventId: string; occurrenceId: string; title: string; kind: Occurrence['kind'];
  from: string; until: string; lastEntry: string | null; source: { label: string; url: string }; reasons: string[];
  price: NormalizedEvent['price']; warnings: string[]; eventRetrievedAt: string;
  eventObservations: Observation[]; venueObservations: Observation[]; partyPrice: PartyAssessment };
export type Predicate = { name: string; state: 'MATCH' | 'MISMATCH' | 'UNKNOWN'; detail: string };
export type Candidate = { eventId: string; occurrenceId: string | null; title: string;
  source: { label: string; url: string }; predicates: Predicate[]; factsMatched: string[]; usefulFacts: string[];
  reasons: string[]; checkAtSource: string[]; price: NormalizedEvent['price'];
  time: { from: string | null; until: string | null; lastEntry: string | null; assessment: Predicate };
  eventRetrievedAt: string; eventObservations: Observation[]; venueObservations: Observation[]; warnings: string[]; partyPrice: PartyAssessment };
type Assessment = { hard: string[]; unknown: string[]; predicates: Predicate[]; facts: string[]; match?: Recommendation; candidate?: Candidate };
function assess(e: NormalizedEvent, o: Occurrence | undefined, venue: Venue | undefined, q: Query, clock: number): Assessment {
  const a: Assessment = { hard: [], unknown: [], predicates: [], facts: [] };
  const zone = q.timezone ?? cities[q.city].timezone, localDate = (s: string) => cityDate(s, zone), cost = assessParty(e, q);
  const predicate = (name: string, codes: string[], success: string) => {
    const hard = a.hard.filter(c => codes.includes(c)), unknown = a.unknown.filter(c => codes.includes(c));
    a.predicates.push({ name, state: hard.length ? 'MISMATCH' : unknown.length ? 'UNKNOWN' : 'MATCH',
      detail: [...hard, ...unknown].map(c => reasonText[c]).join(' ') || success });
  };
  if (!/\p{L}{2}/u.test(e.title.trim()) || new URL(e.sourceUrl).pathname === '/') a.hard.push('UNUSABLE_RECORD');
  if (!venue || venue.physical !== true || !venue.address?.trim()) a.unknown.push('VENUE_UNKNOWN');
  if ((e.city && e.city !== q.city) || (venue?.city && venue.city !== q.city)) a.hard.push('OTHER_CITY');
  if (e.city !== q.city && venue?.city !== q.city) a.unknown.push('CITY_UNKNOWN');
  if (venue?.observations.some(o => o.conflicts.some(f => ['location', 'address'].includes(f)))) a.unknown.push('VENUE_CONFLICT');
  predicate('city', ['OTHER_CITY', 'CITY_UNKNOWN', 'VENUE_CONFLICT'], `Город: ${cities[q.city].name}.`);
  predicate('destination', ['VENUE_UNKNOWN', 'VENUE_CONFLICT'], `Опубликован адрес: ${venue?.address}.`);
  if (venue?.closed === true) a.hard.push('CLOSED');
  if (e.cancelled === true) a.hard.push('CANCELLED');
  predicate('availability', ['CLOSED', 'CANCELLED'], 'В полученных полях нет отметки закрытия или отмены; наличие билетов не проверено.');
  if (q.zone) {
    if (!venue?.zone) a.unknown.push('ZONE_UNKNOWN'); else if (venue.zone !== q.zone) a.hard.push('WRONG_ZONE');
    predicate('zone', ['ZONE_UNKNOWN', 'WRONG_ZONE'], `Подтверждена зона: ${q.zone}.`);
  }
  if (q.category) {
    if (!e.categories.length) a.unknown.push('CATEGORY_UNKNOWN'); else if (!e.categories.includes(q.category)) a.hard.push('WRONG_CATEGORY');
    predicate('category', ['CATEGORY_UNKNOWN', 'WRONG_CATEGORY'], `Подтверждена категория: ${q.category}.`);
  }
  if (q.kind !== 'ANY') {
    if (!o || o.kind === 'UNRESOLVED') a.unknown.push('KIND_UNKNOWN');
    else if (q.kind !== o.kind) a.hard.push('WRONG_KIND');
    predicate('kind', ['KIND_UNKNOWN', 'WRONG_KIND'], 'Режим посещения соответствует запросу.');
  }
  if (q.budgetRub !== null) {
    if (cost.lowerBound > q.budgetRub) a.hard.push('OVER_BUDGET');
    else if (cost.total === null) a.unknown.push('PRICE_UNKNOWN');
    predicate('price', ['PRICE_UNKNOWN', 'OVER_BUDGET'], `${partyPrice(cost)}, в пределах ${q.budgetRub} ₽.`);
  }
  if (cost.admission === 'MISMATCH') a.hard.push('ADMISSION_MISMATCH');
  if (cost.admission === 'UNKNOWN') a.unknown.push('ADMISSION_UNKNOWN');
  predicate('admission', ['ADMISSION_UNKNOWN','ADMISSION_MISMATCH'], cost.admissionNotes.join(' ') || 'Известные требования допуска не противоречат составу посетителей.');
  if (e.price.evidence?.trim()) a.facts.push(`Цена в источнике: «${e.price.evidence}».`);
  else if (e.price.kind === 'FREE') a.facts.push('В источнике указан бесплатный вход.');
  if (e.price.kind === 'CONFLICT') a.facts.push('Текст цены противоречит признаку бесплатного входа; требуется уточнить применимый тариф.');
  if (venue?.stub === true) a.facts.push('Редакционная карточка площадки — заглушка; это не отметка закрытия.');
  const lower = Math.max(Date.parse(q.start), clock), upper = Date.parse(q.end);
  if (upper <= clock) a.hard.push('OUTSIDE_WINDOW');
  let from: string | null = null, until: string | null = null, lastEntry: string | null = null;
  if (o?.activeThrough && o.activeThrough < localDate(new Date(lower).toISOString())) a.hard.push('OUTSIDE_WINDOW');
  if (o?.activeFrom && o.activeFrom > localDate(new Date(upper - 1).toISOString())) a.hard.push('OUTSIDE_WINDOW');
  if (o?.kind === 'TIMED_SESSION') {
    const start = o.start ? Date.parse(o.start) : null;
    const end = o.end ? Date.parse(o.end) : o.durationMinutes && start !== null ? start + o.durationMinutes * 60000 : null;
    if (start !== null && (start < lower || start >= upper)) a.hard.push('OUTSIDE_WINDOW');
    if (o.start) a.facts.push(`Начало: ${localISO(o.start, zone).slice(0,16).replace('T',' ')}; ${end === null ? 'окончание не указано' : `окончание: ${localISO(new Date(end).toISOString(),zone).slice(11,16)}`} (${zone}).`);
    if (start === null || end === null || end <= start) a.unknown.push('TIME_UNKNOWN');
    else if (end > upper) a.hard.push('OUTSIDE_WINDOW');
    else { from = o.start; until = new Date(end).toISOString(); }
  } else if (o?.kind === 'FLEXIBLE_VISIT') {
    if ((!o.activeFrom && !o.startless) || (!o.activeThrough && !o.endless)) a.unknown.push('PERIOD_UNKNOWN');
    if (o.opening === null) a.unknown.push('OPENING_UNKNOWN');
    if (o.activeThrough && o.activeThrough < localDate(q.start)) a.hard.push('OUTSIDE_WINDOW');
    if (o.activeFrom && o.activeFrom > localDate(q.end)) a.hard.push('OUTSIDE_WINDOW');
    if (o.opening !== null) {
      const first = Date.parse(cityInstant(localDate(q.start), '00:00', zone));
      for (let day = first; day < upper && !from; day += 86400000) {
        const date = localDate(new Date(day).toISOString());
        if ((o.activeFrom && date < o.activeFrom) || (o.activeThrough && date > o.activeThrough)) continue;
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        for (const hours of o.opening.filter(h => h.weekday === weekday).sort((a, b) => a.open - b.open)) {
          const begin = Math.max(lower, day + hours.open * 60000), finish = Math.min(upper, day + hours.close * 60000);
          const entry = hours.lastEntry === null ? null : day + hours.lastEntry * 60000;
          if (begin < finish && (entry === null || begin < entry)) {
            from = new Date(begin).toISOString(); until = new Date(finish).toISOString();
            lastEntry = entry === null ? null : new Date(entry).toISOString(); break;
          }
        }
      }
      if (!from) a.hard.push('OUTSIDE_WINDOW');
    }
  } else a.unknown.push(o ? 'TIME_UNKNOWN' : 'NO_OCCURRENCES');
  predicate('time', ['TIME_UNKNOWN', 'PERIOD_UNKNOWN', 'OPENING_UNKNOWN', 'OUTSIDE_WINDOW', 'NO_OCCURRENCES'],
    o?.kind === 'TIMED_SESSION' ? 'Сеанс целиком в заданном окне по опубликованному времени.' : 'Есть пересечение окна с опубликованными часами посещения.');
  if (o?.issues.includes('WEEKDAY_CONVENTION_UNVERIFIED')) a.facts.push('Числовые дни structured schedules сохранены; соглашение о днях недели не подтверждено.');
  const fieldTime = (rows: Observation[], field: string, fallback: string | null) =>
    rows.length ? rows.filter(r => r.fields.includes(field)).at(-1)?.retrievedAt ?? null : fallback;
  const fresh = (t: string | null) => t !== null && clock >= Date.parse(t) && clock - Date.parse(t) <= 86400000;
  const checks = [fieldTime(e.observations, 'dates', e.retrievedAt)];
  if (q.budgetRub !== null) checks.push(fieldTime(e.observations,
    e.price.kind === 'FREE' && !e.price.evidence?.trim() ? 'is_free' : 'price', e.retrievedAt));
  if (q.category) checks.push(fieldTime(e.observations, 'categories', e.retrievedAt));
  const venueFallback = e.verification === 'SYNTHETIC_FIXTURE' ? e.retrievedAt : null;
  const cityTimes = [e.city === q.city ? fieldTime(e.observations, 'location', e.retrievedAt) : null,
    venue?.city === q.city ? fieldTime(venue.observations, 'location', venueFallback) : null];
  checks.push(cityTimes.find(fresh) ?? null);
  if (venue?.physical) {
    checks.push(fieldTime(venue.observations, 'address', venueFallback));
    if (o?.scheduleBasis === 'PLACE_TIMETABLE') checks.push(fieldTime(venue.observations, 'timetable', venueFallback));
  }
  if (checks.some(t => !fresh(t))) a.unknown.push('FACTS_STALE');
  predicate('freshness', ['FACTS_STALE'], 'Применимые факты получены не более 24 часов назад; источник не сообщает дату изменения условий.');
  if (a.hard.length) return a;
  if (a.unknown.length || !o || from === null || until === null) {
    a.candidate = { eventId: e.id, occurrenceId: o?.id ?? null, title: e.title, source: { label: e.sourceLabel, url: e.sourceUrl },
      predicates: a.predicates, factsMatched: a.predicates.filter(p => p.state === 'MATCH').map(p => p.detail), usefulFacts: a.facts,
      reasons: [...new Set(a.unknown)].map(c => reasonText[c]!),
      checkAtSource: a.predicates.filter(p => p.state === 'UNKNOWN').map(p => `Проверить у источника: ${p.detail}`),
      time: { from, until, lastEntry, assessment: a.predicates.find(p => p.name === 'time')! },
      price: e.price, partyPrice: cost, eventRetrievedAt: e.retrievedAt, eventObservations: e.observations, venueObservations: venue?.observations ?? [],
      warnings: ['Непроверенный вариант; соответствие всем условиям запроса не установлено.', 'Наличие билета и выполнение регистрации пользователем не подтверждены.'] };
    return a;
  }
  const reasons = [o.kind === 'TIMED_SESSION' ? 'Сеанс целиком в заданном окне по опубликованному времени.'
    : 'Есть пересечение окна с опубликованными часами посещения.', `Площадка с опубликованным адресом; город: ${cities[q.city].name}.`];
  if (q.budgetRub !== null) reasons.push(`${partyPrice(cost)}, в пределах ${q.budgetRub} ₽.`);
  if (q.category) reasons.push(`Подтверждена категория: ${q.category}.`);
  if (q.zone) reasons.push(`Подтверждена зона: ${q.zone}.`);
  a.match = { eventId: e.id, occurrenceId: o.id, title: e.title, kind: o.kind, from, until, lastEntry,
    source: { label: e.sourceLabel, url: e.sourceUrl }, reasons, price: e.price, partyPrice: cost,
    eventRetrievedAt: e.retrievedAt, eventObservations: e.observations, venueObservations: venue?.observations ?? [],
    warnings: ['Условия организатором повторно не проверены; получение API сегодня не подтверждает их свежесть.',
      ...(venue?.stub ? ['Редакционная карточка площадки — заглушка; сведения о помещении независимо не проверены.'] : []),
      'Наличие билета и выполнение регистрации пользователем не подтверждены.', ...(o.kind === 'FLEXIBLE_VISIT'
        ? ['Продолжительность осмотра и дорога не рассчитаны.', ...(lastEntry === null ? ['Последний вход не указан.'] : [])] : [])] };
  return a;
}

// Чистая функция: только snapshot/query/clock. Без сети, БД и неявного Date.now().
export function select(snapshotInput: unknown | null, queryInput: unknown, clock: Date, allowSynthetic = false, includeUncertain = false,
  reviews: readonly SourceReview[] = sourceReviews) {
  const query = querySchema.parse(queryInput), time = clock.getTime();
  if (!Number.isFinite(time)) throw new Error('INVALID_CLOCK');
  const empty = { recommendations: [] as Recommendation[], strictTotal: 0,
    uncertain: [] as Candidate[], uncertainTotal: 0, candidateMode: includeUncertain, excluded: {} as Record<string, number>,
    coverage: 'PROVIDER_CATALOG_ONLY', catalogIncomplete: true, proposal: null as string | null };
  if (snapshotInput === null) return { ...empty, status: 'SOURCE_UNAVAILABLE' };
  const snapshot = validateSnapshot(snapshotInput);
  if (snapshot.scope.city !== query.city) return { ...empty, status: 'CITY_UNAVAILABLE' };
  if (snapshot.mode === 'SYNTHETIC_FIXTURE' && !allowSynthetic) return { ...empty, status: 'SYNTHETIC_OPT_IN_REQUIRED' };
  if (snapshot.outcome === 'FAILED') return { ...empty, status: 'SOURCE_UNAVAILABLE' };
  if (time < Date.parse(snapshot.retrievedAt)) return { ...empty, status: 'SOURCE_STALE' };
  const catalogStale = time < Date.parse(snapshot.retrievedAt) || time - Date.parse(snapshot.retrievedAt) > snapshot.freshnessHours * 3600000;
  if (Date.parse(query.start) < Date.parse(snapshot.scope.start) || Date.parse(query.end) > Date.parse(snapshot.scope.end)
    || (query.category !== null && !snapshot.scope.categories.includes(query.category)))
    return { ...empty, status: 'OUTSIDE_SNAPSHOT_SCOPE' };
  const venues = new Map(snapshot.venues.map(v => [v.id, v]));
  const matches: Recommendation[] = [], uncertain = empty.uncertain, excluded = empty.excluded;
  for (const e of snapshot.events) {
    if (reviews.some(r => r.eventId === e.id && r.status === 'QUARANTINED')) {
      excluded.SOURCE_IDENTITY_CONFLICT = (excluded.SOURCE_IDENTITY_CONFLICT ?? 0) + 1; continue;
    }
    const assessments = e.occurrences.length ? e.occurrences.map(o => assess(e, o, o.venueId ? venues.get(o.venueId) : undefined, query, time))
      : [assess(e, undefined, undefined, query, time)];
    const best = assessments.flatMap(a => a.match ? [a.match] : []).sort(compare)[0];
    if (best) { matches.push(best); continue; } // Одно событие — максимум одна позиция.
    const plausible = assessments.flatMap(a => a.candidate ? [a.candidate] : []).sort(compareCandidates);
    if (plausible[0]) uncertain.push(plausible[0]);
    for (const code of new Set(assessments.flatMap(a => [...a.hard, ...a.unknown]))) excluded[code] = (excluded[code] ?? 0) + 1;
  }
  // Предпочтения влияют только на порядок уже строгих совпадений; затем время и ID.
  const preferred = (r: Recommendation) => snapshot.events.find(e => e.id === r.eventId)!.categories.some(c => query.preferences.categories.includes(c));
  matches.sort((a, b) => Number(preferred(b)) - Number(preferred(a)) || compare(a, b));
  uncertain.sort((a, b) => Number(snapshot.events.find(e => e.id === b.eventId)!.categories.some(c => query.preferences.categories.includes(c)))
    - Number(snapshot.events.find(e => e.id === a.eventId)!.categories.some(c => query.preferences.categories.includes(c))) || compareCandidates(a, b));
  const catalogIncomplete = snapshot.outcome !== 'COMPLETE';
  const insufficientOmissions = Boolean(snapshot.stats.omitted.UNSAFE_OR_MISSING_SOURCE || snapshot.stats.omitted.CATEGORY_UNKNOWN_OR_OUTSIDE_SCOPE);
  const status = matches.length ? (catalogIncomplete ? 'MATCHES_IN_INCOMPLETE_CATALOG' : 'MATCHES')
    : catalogStale ? 'SOURCE_STALE' : catalogIncomplete ? 'INCOMPLETE_CATALOG' : uncertain.length || insufficientOmissions ? 'INSUFFICIENT_FACTS' : 'NO_MATCHES_IN_SNAPSHOT';
  const proposal = matches.length >= 3 ? null : excluded.OPENING_UNKNOWN || excluded.TIME_UNKNOWN
    ? 'Предложение для следующего этапа: добавить проверенные часы/длительности; пока показывать непроверяемые варианты отдельно. Фильтры не изменены.'
    : excluded.PRICE_UNKNOWN ? 'Предложение: отдельный осознанный режим без ограничения цены с явной неизвестной стоимостью. Текущий бюджет сохранён.'
    : 'Предложение: дать пользователю явно выбрать другое время или категорию. Текущие ограничения сохранены.';
  return { recommendations: matches.slice(0, 3), strictTotal: matches.length, uncertain: includeUncertain ? uncertain.slice(0, 3) : [],
    uncertainTotal: uncertain.length, candidateMode: includeUncertain, excluded, status,
    coverage: snapshot.coverage, catalogIncomplete, proposal, mode: snapshot.mode,
    order: 'Предпочитаемая категория → ближайшее подходящее время → стабильный ID.',
    candidateOrder: 'Предпочитаемая категория → подтверждённое время → подтверждённый бюджет → адрес → число установленных условий → ID.',
    publicDisplay: snapshot.publicDisplay, retrievedAt: snapshot.retrievedAt, enrichedAt: snapshot.enrichedAt,
    catalogFreshness: catalogStale ? 'STALE' : 'WITHIN_24H', eventPaginationComplete: snapshot.paginationComplete,
    venueCoverageComplete: snapshot.venueCoverageComplete, freshnessHours: snapshot.freshnessHours };
}
function compareCandidates(a: Candidate, b: Candidate): number {
  const matches = (c: Candidate, name: string) => Number(c.predicates.some(p => p.name === name && p.state === 'MATCH'));
  for (const name of ['time', 'price', 'destination']) {
    const difference = matches(b, name) - matches(a, name); if (difference) return difference;
  }
  return b.factsMatched.length - a.factsMatched.length || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
    || (a.occurrenceId ?? '').localeCompare(b.occurrenceId ?? '', 'en');
}
function compare(a: Recommendation, b: Recommendation): number {
  return Date.parse(a.from) - Date.parse(b.from) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
    || (a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0);
}
