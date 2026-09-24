import { randomBytes, randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { AcceptedEvent } from '../contracts.js';
import { type Query, safeLink } from '../data/contract.js';
import { localDate } from '../data/normalize.js';
import { select, type Candidate, type Recommendation } from '../data/select.js';
import { sourceReviews } from '../data/reviews.js';
import type { Button, MaxOperation } from '../max.js';
import { canSend, observeContact } from '../probe.js';
import type { Storage } from '../storage.js';
import { Catalog, digest } from './catalog.js';

type Stage = 'home' | 'date' | 'time' | 'budget' | 'interest' | 'summary' | 'results' | 'detail' | 'saved' | 'bookmark' | 'input' | 'delete' | 'erase' | 'about';
type Draft = { date: string; from: string; until: string; budget: number | null; category: string | null };
export type Card = { identity: string; eventId: string; occurrenceId: string | null; title: string;
  source: { label: string; url: string }; kind: 'STRICT' | 'UNCERTAIN'; facts: string[]; unknown: string[];
  snapshotVersion: string; fingerprint: string; retrievedAt: string; synthetic: boolean; query: Query;
  occurrence: { kind: string; start: string | null; end: string | null } | null };
type State = { stage: Stage; draft: Draft; editing: boolean; optIn: boolean; cards: Card[];
  route?: 'probe';
  selected?: string; page: number; bookmark?: { identity: string; generation: string };
  input?: { field: 'date' | 'time' | 'budget'; token: string }; notice?: string };
export type StateRow = { actor: string; revision: number; event_ts: number; updated_at: number; data: string };
type Action = { actor: string; revision: number; purpose: string; data: string; expires_at: number };
type Bookmark = { identity: string; generation: string; data: string; saved_at: number };
const TTL = 15 * 60000;
const label = (c: Card) => c.kind === 'STRICT' ? 'Соответствует указанным данным источника' : 'Нужно уточнить условия';
const short = (s: string, n = 220) => s.replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const datePlus = (now: number, days: number) => localDate(new Date(now + days * 86400000).toISOString());
export function getState(store: Storage, actor: string) { return store.db.prepare('SELECT * FROM flow_states WHERE actor=?').get(actor) as StateRow | undefined; }
export function makeQuery(d: Draft): Query {
  return { city: 'kzn', start: new Date(`${d.date}T${d.from}:00+03:00`).toISOString(), end: new Date(`${d.date}T${d.until}:00+03:00`).toISOString(),
    budgetRub: d.budget, category: d.category, zone: null, kind: 'ANY', preferences: { categories: [] } };
}
function initial(now: number): State {
  return { stage: 'home', draft: { date: datePlus(now, 1), from: '12:00', until: '18:00', budget: 500, category: null }, editing: false, optIn: false, cards: [], page: 0 };
}
export function enterProbeRoute(store: Storage, event: AcceptedEvent, now: number) {
  const previous = getState(store,event.actor);
  const state = { ...initial(now), route: 'probe' };
  store.db.prepare('INSERT INTO flow_states(actor,revision,event_ts,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET revision=excluded.revision,event_ts=excluded.event_ts,updated_at=excluded.updated_at,data=excluded.data')
    .run(event.actor,(previous?.revision ?? 0)+1,event.timestamp,now,JSON.stringify(state));
}
function summary(s: State) {
  return `Казань · ${s.draft.date} · ${s.draft.from}–${s.draft.until} (Москва)\nВход для одного взрослого: ${s.draft.budget === null ? 'без лимита цены' : `до ${s.draft.budget} ₽`}. Интерес: ${s.draft.category === 'exhibition' ? 'выставки' : s.draft.category === 'theater' ? 'театр' : 'любой'}.`;
}
export function fingerprint(catalog: Catalog, eventId: string) {
  const e = catalog.snapshot?.events.find(e => e.id === eventId);
  return e ? digest({ e, venues: catalog.snapshot!.venues.filter(v => e.occurrences.some(o => o.venueId === v.id)) }) : null;
}
function card(catalog: Catalog, q: Query, r: Recommendation | Candidate): Card {
  const e = catalog.snapshot!.events.find(e => e.id === r.eventId)!;
  const o = e.occurrences.find(o => o.id === r.occurrenceId);
  const strict = 'from' in r;
  const at = (v: string) => new Date(Date.parse(v) + 3 * 3600000).toISOString().slice(0,16).replace('T',' ');
  const details = strict ? [`${o?.kind === 'TIMED_SESSION' ? 'Сеанс' : 'Пересечение часов посещения с запросом'}: ${at(r.from)} — ${at(r.until)} (Москва).`,
    ...(e.price.evidence ? [`Цена в источнике: ${e.price.evidence}.`] : []), ...r.reasons] : [...r.usefulFacts, ...r.factsMatched];
  return { identity: digest([r.eventId, r.occurrenceId]), eventId: r.eventId, occurrenceId: r.occurrenceId, title: short(r.title, 160), source: r.source,
    kind: strict ? 'STRICT' : 'UNCERTAIN', facts: details.map(v => short(v)),
    unknown: (strict ? [] : r.checkAtSource).map(v => short(v)), snapshotVersion: catalog.version, fingerprint: fingerprint(catalog, e.id)!,
    retrievedAt: r.eventRetrievedAt, synthetic: catalog.snapshot!.mode === 'SYNTHETIC_FIXTURE', query: q,
    occurrence: o ? { kind: o.kind, start: o.start, end: o.end } : null };
}
export function bookmarkLimitation(c: Card, catalog: Catalog, now: number): string | null {
  if (sourceReviews.some(r => r.eventId === c.eventId)) return 'Запись изолирована: противоречие идентичности события. Не используйте её как рекомендацию.';
  if (!catalog.snapshot) return 'Текущий снимок недоступен. Показана сохранённая ссылка.';
  if (!catalog.snapshot.events.some(e => e.id === c.eventId && (!c.occurrenceId || e.occurrences.some(o => o.id === c.occurrenceId))))
    return 'Событие или выбранное посещение отсутствует в текущем снимке. Это не подтверждение отмены.';
  if (fingerprint(catalog, c.eventId) !== c.fingerprint) return 'Данные изменились. Сохранённое посещение не перенесено; уточните условия по источнику или выполните новый подбор.';
  if (now - Date.parse(c.retrievedAt) > 86400000 || now >= Date.parse(c.query.end)) return 'Сохранённые условия или выбранная дата устарели. Повторите подбор и проверьте источник.';
  return null;
}
const statuses: Record<string, string> = {
  SOURCE_UNAVAILABLE: 'Снимок данных недоступен. Попробуйте позже; сохранённые ссылки доступны в «Мои события».',
  OUTSIDE_SNAPSHOT_SCOPE: 'Этот запрос вне дат или категорий снимка. Измените дату или интерес.',
  SOURCE_STALE: 'Данные старше допустимого срока. Строгих совпадений нет; условия требуют новой проверки.',
  INCOMPLETE_CATALOG: 'Снимок неполный. Строгих совпадений не найдено; это не значит, что в городе нет событий.',
  INSUFFICIENT_FACTS: 'Недостаточно сведений для строгого совпадения.',
  NO_MATCHES_IN_SNAPSHOT: 'По этим условиям совпадений в снимке нет. Можно изменить один фильтр.',
};

// Вызывается в существующей короткой SQLite-транзакции. Selector синхронен и не обращается к сети/файлам.
export function processCulture(store: Storage, config: Config, event: AcceptedEvent, now: number, catalog: Catalog): string {
  observeContact(store, event, now);
  if (!canSend(store.contact(event.actor))) return 'CONTACT_UNAVAILABLE';
  if (!['bot_started', 'message_created', 'message_callback'].includes(event.kind)) return 'LIFECYCLE_RECORDED';
  if (event.kind === 'bot_started' && !event.homeEntry) return 'UNKNOWN_ENTRY';
  const old = getState(store, event.actor);
  let s: State = old ? JSON.parse(old.data) : initial(now);
  const revision = (old?.revision ?? 0) + 1;
  let purpose = 'home', arg = '';
  let valid = true;
  if (event.kind === 'message_callback') {
    const action = event.flowAction ? store.db.prepare('SELECT * FROM flow_actions WHERE id=?').get(event.flowAction) as Action | undefined : undefined;
    valid = Boolean(action && old && action.actor === event.actor && action.revision === old.revision && action.expires_at > now
      && event.timestamp >= old.event_ts && event.timestamp <= now + 60000 && now - event.timestamp < TTL && now - old.updated_at < TTL);
    if (valid) { purpose = action!.purpose; arg = JSON.parse(action!.data) as string; }
    store.enqueue(`${event.key}:answer`, event.actor, null, 'culture_answer', { method: 'answers', callbackId: event.callbackId!, body: {
      notification: valid ? 'Принято.' : 'Кнопка устарела или принадлежит другому диалогу. Откройте /start.',
    } }, now, now + 60000);
    if (!valid) return 'FLOW_ACTION_EXPIRED_OR_FOREIGN';
  } else if (old && event.timestamp < old.event_ts) return 'FLOW_OLDER_EVENT';
  else if (event.timestamp > now + 60000 || now - event.timestamp >= TTL) return 'FLOW_EVENT_EXPIRED';
  else if (event.homeEntry) purpose = 'home';
  else if (event.input === '/saved') purpose = 'saved';
  else if (event.input === '/delete_data') purpose = 'erase';
  else if (s.stage === 'input' && old && now - old.updated_at < TTL) purpose = 'typed';
  else { purpose = 'recover'; }

  delete s.notice;
  const changed = (next: Stage) => { s.optIn = false; s.cards = []; delete s.selected; delete s.input; s.stage = s.editing ? 'summary' : next; };
  const findBookmark = () => s.bookmark ? store.db.prepare('SELECT * FROM bookmarks WHERE actor=? AND identity=? AND generation=?').get(event.actor, s.bookmark.identity, s.bookmark.generation) as Bookmark | undefined : undefined;
  switch (purpose) {
    case 'home': s = initial(now); break;
    case 'pick': s = initial(now); s.stage = 'date'; break;
    case 'edit': s.stage = arg as Stage; s.editing = true; s.optIn = false; s.cards = []; delete s.selected; break;
    case 'date': s.draft.date = arg; changed('time'); break;
    case 'time': [s.draft.from, s.draft.until] = arg.split('-') as [string, string]; changed('budget'); break;
    case 'budget': s.draft.budget = arg === 'none' ? null : Number(arg); changed('interest'); break;
    case 'interest': s.draft.category = arg || null; changed('summary'); break;
    case 'custom': s.input = { field: arg as 'date' | 'time' | 'budget', token: randomBytes(3).toString('hex').toUpperCase() }; s.stage = 'input'; break;
    case 'typed': {
      const [token, value] = (event.input ?? '').split(' ');
      const input = s.input;
      valid = Boolean(input && token === input.token && value);
      if (valid && input?.field === 'date') {
        const parsed = Date.parse(`${value}T00:00:00+03:00`);
        valid = Number.isFinite(parsed) && localDate(new Date(parsed).toISOString()) === value && value! >= datePlus(now, 0) && value! <= datePlus(now, 30);
        if (valid) { s.draft.date = value!; changed('time'); }
      } else if (valid && input?.field === 'time') {
        valid = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(value!) && value!.slice(0, 5) < value!.slice(6);
        if (valid) { [s.draft.from, s.draft.until] = value!.split('-') as [string, string]; changed('budget'); }
      } else if (valid && input?.field === 'budget') {
        valid = /^\d{1,5}$/.test(value!) && Number(value) <= 100000;
        if (valid) { s.draft.budget = Number(value); changed('interest'); }
      }
      if (!valid) s.notice = 'Ввод не принят. Скопируйте актуальный код и соблюдайте формат ниже; старый код не изменяет фильтры.';
      break;
    }
    case 'results': s.stage = 'results'; break;
    case 'uncertain': s.optIn = true; s.stage = 'results'; break;
    case 'detail': s.selected = arg; s.stage = 'detail'; break;
    case 'save': {
      const c = s.cards.find(c => c.identity === s.selected);
      if (!c || c.snapshotVersion !== catalog.version || (c.kind === 'UNCERTAIN' && !s.optIn)) { s.stage = 'summary'; s.notice = 'Карточка устарела. Выполните подбор заново.'; break; }
      const n = (store.db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(event.actor) as { n: number }).n;
      if (n >= 50 && !store.db.prepare('SELECT 1 FROM bookmarks WHERE actor=? AND identity=?').get(event.actor,c.identity)) { s.notice = 'Лимит 50 закладок. Удалите ненужную в «Мои события».'; break; }
      store.db.prepare('INSERT OR IGNORE INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(event.actor, c.identity, randomUUID(), now, JSON.stringify(c));
      s.notice = 'Сохранено в «Мои события». Это личная закладка, не покупка и не регистрация.'; break;
    }
    case 'saved': s.stage = 'saved'; s.page = Number(arg || 0); break;
    case 'bookmark': s.bookmark = JSON.parse(arg); s.stage = 'bookmark'; break;
    case 'remove': s.stage = 'delete'; break;
    case 'confirmRemove':
      if (s.bookmark) store.db.prepare('DELETE FROM bookmarks WHERE actor=? AND identity=? AND generation=?').run(event.actor, s.bookmark.identity, s.bookmark.generation);
      s.stage = 'saved'; s.page = 0; s.notice = 'Закладка удалена, если она ещё существовала в этой версии.'; break;
    case 'erase': s.stage = 'erase'; break;
    case 'confirmErase':
      store.db.prepare('DELETE FROM bookmarks WHERE actor=?').run(event.actor);
      store.db.prepare('DELETE FROM flow_actions WHERE actor=?').run(event.actor);
      store.db.prepare("UPDATE outbox SET payload=NULL,status='STALE',result='PERSONAL_DATA_ERASED' WHERE actor=? AND purpose LIKE 'culture%'").run(event.actor);
      store.db.prepare("UPDATE inbox SET payload=NULL WHERE status<>'PENDING' AND json_extract(payload,'$.actor')=?").run(event.actor);
      s = initial(now); s.notice = 'Все закладки и прежние параметры удалены.'; break;
    case 'about': s.stage = 'about'; break;
    default: s.stage = 'home'; s.notice = 'Выберите действие кнопкой. Для нового входа: /start.';
  }
  // Любой принятый переход закрывает старые действия/отложенные экраны.
  store.db.prepare('DELETE FROM flow_actions WHERE actor=?').run(event.actor);
  store.db.prepare("UPDATE outbox SET status='STALE',result='FLOW_REVISION_CHANGED',finished_at=? WHERE actor=? AND status='PENDING' AND flow_revision IS NOT NULL").run(now, event.actor);
  const button = (text: string, purpose: string, data = ''): Button => {
    const id = randomBytes(18).toString('base64url');
    store.db.prepare('INSERT INTO flow_actions(id,actor,revision,purpose,data,expires_at) VALUES(?,?,?,?,?,?)').run(id, event.actor, revision, purpose, JSON.stringify(data), now + TTL);
    return { type: 'callback', text, payload: `cp:${id}` };
  };
  const home = () => [button('Главная', 'home'), button('Мои события', 'saved')];
  const editors = () => [[button('Дата', 'edit', 'date'), button('Время', 'edit', 'time')], [button('Бюджет', 'edit', 'budget'), button('Интерес', 'edit', 'interest')]];
  let text = '', rows: Button[][] = [], audience: MaxOperation['audience'], catalogVersion: string | undefined;
  if (s.stage === 'home') {
    text = 'Культурный план · Казань\nПомогу сузить выбор по опубликованным данным. Неизвестные условия показываются только по вашему запросу.';
    rows = [[button('Подобрать', 'pick'), button('Мои события', 'saved')], [button('О данных', 'about')]];
  } else if (s.stage === 'date') {
    text = 'Выберите дату в Казани (московское время).';
    rows = [[button('Сегодня', 'date', datePlus(now, 0)), button('Завтра', 'date', datePlus(now, 1))], [button('Другая дата', 'custom', 'date')], home()];
  } else if (s.stage === 'time') {
    text = 'В какое время удобно? Сеанс должен помещаться целиком; для свободного посещения учитываются часы входа.';
    rows = [[button('12:00–18:00', 'time', '12:00-18:00'), button('18:00–22:00', 'time', '18:00-22:00')], [button('Другое время', 'custom', 'time')], home()];
  } else if (s.stage === 'budget') {
    text = 'Бюджет на вход для одного взрослого? Дорога и дополнительные услуги не включены.';
    rows = [[button('Бесплатно', 'budget', '0'), button('До 500 ₽', 'budget', '500'), button('До 1000 ₽', 'budget', '1000')], [button('Без лимита', 'budget', 'none'), button('Другая сумма', 'custom', 'budget')], home()];
  } else if (s.stage === 'interest') {
    text = 'Культурный интерес (необязательно):'; rows = [[button('Любой', 'interest'), button('Выставки', 'interest', 'exhibition'), button('Театр', 'interest', 'theater')], home()];
  } else if (s.stage === 'input') {
    const i = s.input!;
    const formats = { date: `${i.token} ГГГГ-ММ-ДД\nДата: сегодня или ближайшие 30 дней.`, time: `${i.token} ЧЧ:ММ-ЧЧ:ММ\nОдин день, 00:00–23:59; окончание позже начала.`, budget: `${i.token} СУММА\nЦелое число от 0 до 99999 рублей.` };
    text = `Введите одной строкой, заменив обозначения:\n${formats[i.field]}\nКод связывает ввод с этим экраном.`; rows = [[button('Назад', 'edit', i.field)], home()];
  } else if (s.stage === 'summary') {
    text = `Ваши условия:\n${summary(s)}\nПоказать строгие совпадения?`; rows = [[button('Показать результаты', 'results')], ...editors(), home()];
  } else if (s.stage === 'results') {
    const q = makeQuery(s.draft), result = select(catalog.snapshot, q, new Date(now), config.flowDataMode === 'synthetic-test', s.optIn);
    s.cards = [...result.recommendations, ...result.uncertain].map(r => card(catalog, q, r));
    text = `${summary(s)}\n\n${result.recommendations.length ? 'Строгие совпадения по данным источника:' : statuses[result.status] ?? 'Строгих совпадений нет.'}`;
    if (result.catalogIncomplete) text += '\nПокрытие неполное: это не вся афиша города.';
    if (catalog.snapshot) text += `\nСписок получен: ${catalog.snapshot.retrievedAt}.`;
    for (const [i,c] of s.cards.entries()) {
      text += `\n\n${i + 1}. ${c.title}\n${label(c)}${c.kind === 'UNCERTAIN' ? `\n${c.unknown[0] ?? 'Уточните условия по источнику.'}` : ''}`;
      rows.push([button(`Подробнее ${i + 1}`, 'detail', c.identity)]);
    }
    if (s.optIn && !result.uncertain.length) text += '\nВариантов для проверки по этим условиям нет.';
    if (!s.optIn) rows.push([button('Показать варианты для проверки', 'uncertain')]);
    rows.push(...editors(), home()); catalogVersion = catalog.version;
    if (s.cards.length) audience = catalog.snapshot?.mode === 'SYNTHETIC_FIXTURE' ? 'SYNTHETIC' : 'PROVIDER';
  } else if (['detail', 'bookmark', 'delete'].includes(s.stage)) {
    const saved = s.stage !== 'detail' ? findBookmark() : undefined;
    const c: Card | undefined = saved ? JSON.parse(saved.data) : s.stage === 'detail' ? s.cards.find(c => c.identity === s.selected) : undefined;
    const limitation = c ? bookmarkLimitation(c, catalog, now) : 'Эта закладка или карточка уже недоступна.';
    if (!c || (s.stage === 'detail' && (c.snapshotVersion !== catalog.version || (c.kind === 'UNCERTAIN' && !s.optIn)))) {
      text = 'Карточка устарела. Выполните подбор заново; событие не подменялось.'; rows = [[button('Подобрать', 'pick')], home()];
    } else {
      text = `${c.title}\n${s.stage === 'detail' ? label(c) : `При сохранении: ${label(c)}`}\n${limitation ? `${limitation}\n` : ''}`;
      text += `${c.unknown.length ? `Уточните у источника:\n${c.unknown.join('\n')}\n` : ''}${c.facts.slice(0, 5).join('\n')}\n`;
      text += `Получено: ${c.retrievedAt}.\n${c.source.label}\n${c.occurrence?.kind === 'FLEXIBLE_VISIT' ? 'Дата запроса — намерение посетить, не официальное начало события.\n' : ''}Наличие билета и регистрация не подтверждены. Сохранение — только закладка.`;
      audience = c.synthetic ? 'SYNTHETIC' : 'PROVIDER'; catalogVersion = catalog.version;
      if (safeLink(c.source.url) && c.source.url.length <= 2048) rows.push([{ type: 'link', text: c.source.label, url: c.source.url }]);
      rows.push(s.stage === 'detail' ? [button('Сохранить', 'save'), button('К результатам', 'results')]
        : s.stage === 'delete' ? [button('Да, удалить', 'confirmRemove'), button('Отмена', 'saved')] : [button('Удалить закладку', 'remove')]);
      rows.push(home());
    }
  } else if (s.stage === 'saved') {
    const saved = store.db.prepare('SELECT * FROM bookmarks WHERE actor=? ORDER BY saved_at DESC, identity LIMIT 6 OFFSET ?').all(event.actor, s.page * 5) as Bookmark[];
    text = 'Мои события — личные закладки. Сохранение не бронирует места.';
    if (!saved.length) text += '\nЗакладок пока нет.';
    for (const [i,b] of saved.slice(0,5).entries()) {
      const c: Card = JSON.parse(b.data); text += `\n${s.page * 5 + i + 1}. ${c.title} · ${c.kind === 'UNCERTAIN' ? 'нужно уточнить' : 'совпадение при сохранении'}`;
      rows.push([button(`Открыть ${i + 1}`, 'bookmark', JSON.stringify({ identity: b.identity, generation: b.generation }))]);
      if (!c.synthetic) audience = 'PROVIDER'; else audience ??= 'SYNTHETIC';
    }
    if (s.page > 0) rows.push([button('Предыдущие', 'saved', String(s.page - 1))]);
    if (saved.length > 5) rows.push([button('Следующие', 'saved', String(s.page + 1))]);
    rows.push([button('Удалить мои данные', 'erase')], [button('Главная', 'home')]); catalogVersion = catalog.version;
  } else if (s.stage === 'erase') {
    text = 'Удалить все ваши закладки и параметры подбора?'; rows = [[button('Да, удалить мои данные', 'confirmErase')], [button('Отмена', 'home')]];
  } else {
    text = 'О данных\nЛокальный исследовательский прототип. Казань; неполный снимок, условия могут устареть. Неизвестная цена не означает бесплатный вход.\nПубличный показ KudaGo пока не согласован. MAX mobile/web ещё не проверены.\nДо 50 закладок хранятся до вашего удаления; параметры подбора — 30 дней без активности, кнопки — 15 минут. /delete_data удаляет закладки и параметры. Произвольные тексты, имена и телефоны не сохраняются. /probe — отдельный тест связи.';
    rows = [home()];
  }
  if (config.mode === 'live' && audience === 'PROVIDER') {
    text = 'Показ материалов источника в MAX пока не разрешён для этого прототипа. Данные доступны только в частной локальной проверке.';
    rows = [home()]; audience = undefined; catalogVersion = undefined;
  }
  if (config.flowDataMode === 'synthetic-test') text = `ТЕХНИЧЕСКИЙ ТЕСТ · ВЫМЫШЛЕННЫЕ ДАННЫЕ\n${text}`;
  if (s.notice) text = `${s.notice}\n\n${text}`;
  store.db.prepare('INSERT INTO flow_states(actor,revision,event_ts,updated_at,data) VALUES(?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET revision=excluded.revision,event_ts=excluded.event_ts,updated_at=excluded.updated_at,data=excluded.data')
    .run(event.actor, revision, event.timestamp, now, JSON.stringify(s));
  store.enqueue(`${event.key}:screen`, event.actor, null, 'culture_screen', { method: 'messages', recipient: event.actor, audience,
    body: { text: text.slice(0, 3950), notify: false, attachments: [{ type: 'inline_keyboard', payload: { buttons: rows } }] } }, now, now + 60000, { revision, catalogVersion });
  return valid ? 'FLOW_ACCEPTED' : 'FLOW_INVALID_INPUT';
}
