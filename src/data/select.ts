import { type Snapshot, type Query, type NormalizedEvent, type Occurrence, type Venue, querySchema, validateSnapshot } from './contract.js';
import { localDate } from './normalize.js';

export const reasonText: Record<string, string> = {
  OTHER_CITY: 'Площадка находится вне Казани.', VENUE_UNKNOWN: 'Не подтверждена физическая площадка в Казани.',
  CLOSED: 'Площадка отмечена закрытой.', ZONE_UNKNOWN: 'Нет проверенного соответствия площадки выбранной зоне.',
  WRONG_ZONE: 'Площадка вне выбранной зоны.', WRONG_CATEGORY: 'Категория не соответствует запросу.',
  CATEGORY_UNKNOWN: 'Категория неизвестна.', WRONG_KIND: 'Другой режим посещения.',
  TIME_UNKNOWN: 'Нет проверяемого времени окончания или длительности сеанса.',
  PERIOD_UNKNOWN: 'Не установлены границы периода посещения.', OPENING_UNKNOWN: 'Нет применимого расписания на этот день.',
  OUTSIDE_WINDOW: 'Нет подходящего сеанса или пересечения часов входа с окном.',
  PRICE_UNKNOWN: 'Нельзя подтвердить применимую цену для одного взрослого.', OVER_BUDGET: 'Опубликованная цена выше бюджета.',
  NO_OCCURRENCES: 'Нет сведений о конкретных датах посещения.',
};
export type Recommendation = { eventId: string; occurrenceId: string; title: string; kind: Occurrence['kind'];
  from: string; until: string; lastEntry: string | null; source: { label: string; url: string }; reasons: string[];
  price: NormalizedEvent['price']; warnings: string[] };
type Assessment = { hard: string[]; unknown: string[]; match?: Recommendation };
function assess(e: NormalizedEvent, o: Occurrence, venue: Venue | undefined, q: Query, clock: number): Assessment {
  const a: Assessment = { hard: [], unknown: [] };
  if (!venue || venue.city === null || venue.physical !== true) a.unknown.push('VENUE_UNKNOWN');
  if (venue?.city && venue.city !== q.city) a.hard.push('OTHER_CITY');
  if (venue?.closed === true) a.hard.push('CLOSED');
  if (q.zone) {
    if (!venue?.zone) a.unknown.push('ZONE_UNKNOWN'); else if (venue.zone !== q.zone) a.hard.push('WRONG_ZONE');
  }
  if (q.category) {
    if (!e.categories.length) a.unknown.push('CATEGORY_UNKNOWN'); else if (!e.categories.includes(q.category)) a.hard.push('WRONG_CATEGORY');
  }
  if (q.kind !== 'ANY' && q.kind !== o.kind && o.kind !== 'UNRESOLVED') a.hard.push('WRONG_KIND');
  if (q.budgetRub !== null) {
    if (!['FREE', 'EXACT'].includes(e.price.kind) || e.price.amount === null || e.price.currency !== 'RUB'
      || e.price.applicability !== 'SINGLE_ADULT') a.unknown.push('PRICE_UNKNOWN');
    else if (e.price.amount > q.budgetRub) a.hard.push('OVER_BUDGET');
  }
  const lower = Math.max(Date.parse(q.start), clock), upper = Date.parse(q.end);
  let from: string | null = null, until: string | null = null, lastEntry: string | null = null;
  if (o.kind === 'TIMED_SESSION') {
    const start = o.start ? Date.parse(o.start) : null;
    const end = o.end ? Date.parse(o.end) : o.durationMinutes && start !== null ? start + o.durationMinutes * 60000 : null;
    if (start !== null && (start < lower || start >= upper)) a.hard.push('OUTSIDE_WINDOW');
    if (start === null || end === null || end <= start) a.unknown.push('TIME_UNKNOWN');
    else if (end > upper) a.hard.push('OUTSIDE_WINDOW');
    else { from = o.start; until = new Date(end).toISOString(); }
  } else if (o.kind === 'FLEXIBLE_VISIT') {
    if ((!o.activeFrom && !o.startless) || (!o.activeThrough && !o.endless)) a.unknown.push('PERIOD_UNKNOWN');
    if (o.opening === null) a.unknown.push('OPENING_UNKNOWN');
    if (o.activeThrough && o.activeThrough < localDate(q.start)) a.hard.push('OUTSIDE_WINDOW');
    if (o.activeFrom && o.activeFrom > localDate(q.end)) a.hard.push('OUTSIDE_WINDOW');
    if (o.opening !== null) {
      const first = Date.parse(`${localDate(q.start)}T00:00:00+03:00`);
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
  } else a.unknown.push('TIME_UNKNOWN');
  if (a.hard.length || a.unknown.length || from === null || until === null) return a;
  const reasons = [o.kind === 'TIMED_SESSION' ? 'Сеанс целиком в заданном окне по опубликованному времени.'
    : 'Есть пересечение окна с опубликованными часами посещения.', 'Физическая площадка в Казани.'];
  if (q.budgetRub !== null) reasons.push(`Опубликованный вход на одного взрослого: ${e.price.amount} RUB, в пределах ${q.budgetRub} RUB.`);
  if (q.category) reasons.push(`Подтверждена категория: ${q.category}.`);
  if (q.zone) reasons.push(`Подтверждена зона: ${q.zone}.`);
  a.match = { eventId: e.id, occurrenceId: o.id, title: e.title, kind: o.kind, from, until, lastEntry,
    source: { label: e.sourceLabel, url: e.sourceUrl }, reasons, price: e.price,
    warnings: ['Условия организатором повторно не проверены; получение API сегодня не подтверждает их свежесть.',
      'Наличие билета и регистрация не подтверждены.', ...(o.kind === 'FLEXIBLE_VISIT'
        ? ['Продолжительность осмотра и дорога не рассчитаны.', ...(lastEntry === null ? ['Последний вход не указан.'] : [])] : [])] };
  return a;
}

// Чистая функция: только snapshot/query/clock. Без сети, БД и неявного Date.now().
export function select(snapshotInput: unknown | null, queryInput: unknown, clock: Date, allowSynthetic = false) {
  const query = querySchema.parse(queryInput), time = clock.getTime();
  if (!Number.isFinite(time)) throw new Error('INVALID_CLOCK');
  const empty = { recommendations: [] as Recommendation[], strictTotal: 0,
    uncertain: [] as { eventId: string; title: string; source: { label: string; url: string }; reasons: string[] }[], excluded: {} as Record<string, number>,
    coverage: 'PROVIDER_CATALOG_ONLY', catalogIncomplete: true, proposal: null as string | null };
  if (snapshotInput === null) return { ...empty, status: 'SOURCE_UNAVAILABLE' };
  const snapshot = validateSnapshot(snapshotInput);
  if (snapshot.mode === 'SYNTHETIC_FIXTURE' && !allowSynthetic) return { ...empty, status: 'SYNTHETIC_OPT_IN_REQUIRED' };
  if (snapshot.outcome === 'FAILED') return { ...empty, status: 'SOURCE_UNAVAILABLE' };
  if (time < Date.parse(snapshot.retrievedAt) || time - Date.parse(snapshot.retrievedAt) > snapshot.freshnessHours * 3600000)
    return { ...empty, status: 'SOURCE_STALE' };
  if (Date.parse(query.start) < Date.parse(snapshot.scope.start) || Date.parse(query.end) > Date.parse(snapshot.scope.end)
    || (query.category !== null && !snapshot.scope.categories.includes(query.category)))
    return { ...empty, status: 'OUTSIDE_SNAPSHOT_SCOPE' };
  const venues = new Map(snapshot.venues.map(v => [v.id, v]));
  const matches: Recommendation[] = [], uncertain = empty.uncertain, excluded = empty.excluded;
  for (const e of snapshot.events) {
    const assessments = e.occurrences.map(o => assess(e, o, o.venueId ? venues.get(o.venueId) : undefined, query, time));
    const best = assessments.flatMap(a => a.match ? [a.match] : []).sort(compare)[0];
    if (best) { matches.push(best); continue; } // Одно событие — максимум одна позиция.
    if (!assessments.length) assessments.push({ hard: [], unknown: ['NO_OCCURRENCES'] });
    const plausible = assessments.filter(a => !a.hard.length);
    if (plausible.length) uncertain.push({ eventId: e.id, title: e.title, source: { label: e.sourceLabel, url: e.sourceUrl },
      reasons: [...new Set(plausible.flatMap(a => a.unknown))].map(r => reasonText[r]!) });
    for (const code of new Set(assessments.flatMap(a => [...a.hard, ...a.unknown]))) excluded[code] = (excluded[code] ?? 0) + 1;
  }
  // Предпочтения влияют только на порядок уже строгих совпадений; затем время и ID.
  const preferred = (r: Recommendation) => snapshot.events.find(e => e.id === r.eventId)!.categories.some(c => query.preferences.categories.includes(c));
  matches.sort((a, b) => Number(preferred(b)) - Number(preferred(a)) || compare(a, b));
  uncertain.sort((a, b) => a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);
  const catalogIncomplete = !snapshot.paginationComplete;
  const insufficientOmissions = Boolean(snapshot.stats.omitted.UNSAFE_OR_MISSING_SOURCE || snapshot.stats.omitted.CATEGORY_UNKNOWN_OR_OUTSIDE_SCOPE);
  const status = matches.length ? (catalogIncomplete ? 'MATCHES_IN_INCOMPLETE_CATALOG' : 'MATCHES')
    : catalogIncomplete ? 'INCOMPLETE_CATALOG' : uncertain.length || insufficientOmissions ? 'INSUFFICIENT_FACTS' : 'NO_MATCHES_IN_SNAPSHOT';
  const proposal = matches.length >= 3 ? null : excluded.OPENING_UNKNOWN || excluded.TIME_UNKNOWN
    ? 'Предложение для следующего этапа: добавить проверенные часы/длительности; пока показывать непроверяемые варианты отдельно. Фильтры не изменены.'
    : excluded.PRICE_UNKNOWN ? 'Предложение: отдельный осознанный режим без ограничения цены с явной неизвестной стоимостью. Текущий бюджет сохранён.'
    : 'Предложение: дать пользователю явно выбрать другое время или категорию. Текущие ограничения сохранены.';
  return { recommendations: matches.slice(0, 3), strictTotal: matches.length, uncertain, excluded, status,
    coverage: snapshot.coverage, catalogIncomplete, proposal, mode: snapshot.mode,
    order: 'Предпочитаемая категория → ближайшее подходящее время → стабильный ID.',
    publicDisplay: snapshot.publicDisplay, retrievedAt: snapshot.retrievedAt, freshnessHours: snapshot.freshnessHours };
}
function compare(a: Recommendation, b: Recommendation): number {
  return Date.parse(a.from) - Date.parse(b.from) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
    || (a.occurrenceId < b.occurrenceId ? -1 : a.occurrenceId > b.occurrenceId ? 1 : 0);
}
