import type { NormalizedEvent, Observation, OpeningInterval, Price, Query } from '../data/contract.js';
import { localDate } from '../data/normalize.js';
import type { Candidate, Predicate, Recommendation } from '../data/select.js';
import { Catalog, digest } from './catalog.js';

export type Card = { identity: string; eventId: string; occurrenceId: string | null; title: string;
  source: { label: string; url: string }; kind: 'STRICT' | 'UNCERTAIN'; facts: string[]; unknown: string[];
  snapshotVersion: string; fingerprint: string; retrievedAt: string; synthetic: boolean; query: Query;
  occurrence: { kind: string; start: string | null; end: string | null } | null;
  // Отсутствует в старых закладках. Не восстанавливаем исторические поля из нового каталога.
  visit?: { version: 1; venue: { title: string | null; address: string | null };
    from: string | null; until: string | null; lastEntry: string | null; opening: OpeningInterval[] | null;
    timeAssessment?: Predicate;
    price: Price; admission: NormalizedEvent['admission']; warnings: string[];
    providerUpdatedAt: string | null; eventObservations: Observation[]; venueObservations: Observation[];
    links: { label: string; url: string }[] } };

export function fingerprint(catalog: Catalog, eventId: string) {
  const e = catalog.snapshot?.events.find(e => e.id === eventId);
  return e ? digest({ e, venues: catalog.snapshot!.venues.filter(v => e.occurrences.some(o => o.venueId === v.id)) }) : null;
}
export function projectCard(catalog: Catalog, query: Query, r: Recommendation | Candidate): Card {
  const e = catalog.snapshot!.events.find(e => e.id === r.eventId)!;
  const o = e.occurrences.find(o => o.id === r.occurrenceId);
  const venue = catalog.snapshot!.venues.find(v => v.id === o?.venueId);
  const strict = 'from' in r;
  return { identity: digest([r.eventId,r.occurrenceId]), eventId:r.eventId,occurrenceId:r.occurrenceId,title:r.title,source:r.source,
    kind: strict ? 'STRICT':'UNCERTAIN', facts:strict ? r.reasons : [...r.usefulFacts,...r.factsMatched],
    unknown:strict ? []:r.checkAtSource, snapshotVersion:catalog.version,fingerprint:fingerprint(catalog,e.id)!,
    retrievedAt:r.eventRetrievedAt,synthetic:catalog.snapshot!.mode==='SYNTHETIC_FIXTURE',query,
    occurrence:o ? {kind:o.kind,start:o.start,end:o.end}:null,
    visit:{version:1,venue:{title:venue?.title?.trim()?venue.title:null,address:venue?.address?.trim()?venue.address:null},
      from:strict?r.from:r.time.from??o?.start??null,until:strict?r.until:r.time.until??o?.end??null,
      lastEntry:strict?r.lastEntry:r.time.lastEntry,opening:o?.opening??null,
      ...(!strict?{timeAssessment:r.time.assessment}:{}),
      price:r.price,admission:e.admission,warnings:r.warnings,providerUpdatedAt:e.providerUpdatedAt,
      eventObservations:r.eventObservations,venueObservations:r.venueObservations,
      links:[...(e.organizerUrl?[{label:catalog.snapshot!.mode==='SYNTHETIC_FIXTURE'?'Пример ссылки организатора':'Организатор',url:e.organizerUrl}]:[]),
        ...(e.ticketUrl?[{label:catalog.snapshot!.mode==='SYNTHETIC_FIXTURE'?'Пример ссылки билетов':'Билеты',url:e.ticketUrl}]:[]),
        ...(venue?.sourceUrl?[{label:catalog.snapshot!.mode==='SYNTHETIC_FIXTURE'?'Пример ссылки площадки':'Площадка',url:venue.sourceUrl}]:[])]} };
}

// Ограничения относятся к отдельным полям обзора. Полные поля доступны страницами.
export const compact = (s: string, limit = 160) => {
  const clean=s.replace(/[\u0000-\u001f]/g,' ');
  return clean.length<=limit ? clean : `${clean.slice(0,limit-1).replace(/[\uD800-\uDBFF]$/,'')}…`;
};
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const displayDate=(s:string)=>`${Number(s.slice(8,10))} ${months[Number(s.slice(5,7))-1]} ${s.slice(0,4)} г.`;
const local=(s:string)=>new Date(Date.parse(s)+3*3600000).toISOString();
const at=(s:string)=>{const d=local(s);return `${displayDate(d)} ${d.slice(11,16)}${d.slice(17,23)==='00.000'?'':d.slice(16,23).replace(/\.000$/,'')}`;};
export const displayInstant=(s:string)=>{const d=local(s);return `${displayDate(d)} ${d.slice(11,23).replace(/\.000$/,'')} (Москва, UTC+3)`;};
const span=(from:string,until:string)=>`${at(from)} — ${localDate(from)===localDate(until)?at(until).split(' г. ')[1]:at(until)} (Москва, UTC+3)`;
const hh=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const price=(p:Price)=>p.applicability==='SINGLE_ADULT'&&p.amount!==null&&['EXACT','FREE'].includes(p.kind)
  ? `${p.amount} ₽ на одного взрослого` : p.kind==='FROM'&&p.lowerBound!==null ? `от ${p.lowerBound} ₽; взрослый тариф не установлен` : 'применимый взрослый тариф не установлен';
const registration=(v:NonNullable<Card['visit']>)=>v.admission.registration==='REQUIRED'?'обязательна':v.admission.registration==='NOT_REQUIRED'?'не требуется по источнику':'требование неизвестно';
function schedule(c:Card) {
  const v=c.visit!;
  if(c.occurrence?.kind==='TIMED_SESSION') return `Сеанс: ${v.from&&v.until?span(v.from,v.until):`${v.from?at(v.from):'начало неизвестно'} — ${v.until?at(v.until):'окончание неизвестно'} (Москва, UTC+3)`}.`;
  if(c.occurrence?.kind!=='FLEXIBLE_VISIT') return 'Режим и время посещения не установлены.';
  const weekday=new Date(`${localDate(v.from??c.query.start)}T12:00:00Z`).getUTCDay();
  const hours=v.opening?.filter(h=>h.weekday===weekday);
  return `Свободное посещение. Часы на выбранную дату: ${hours?.length?unique(hours.map(h=>`${hh(h.open)}–${hh(h.close)}`)).join('; '):'не указаны'}.\nПересечение с запросом: ${v.from&&v.until?span(v.from,v.until):'не подтверждено'}.`;
}
const lastEntry=(c:Card)=>`Последний вход: ${c.visit!.lastEntry?`${at(c.visit!.lastEntry)} (Москва, UTC+3)`:'для выбранного интервала не установлен'}.`;
const freshness=(c:Card)=>`Данные события получены нами: ${displayInstant(c.retrievedAt)}. Получение API не подтверждает свежесть условий у организатора.\nДата изменения у источника: ${c.visit?.providerUpdatedAt?displayInstant(c.visit.providerUpdatedAt):'не указана'}.`;
const caveat='Наличие билета и выполнение регистрации пользователем не проверены. Сохранение — только закладка.';
const key=(s:string)=>s.replace(/\s+/g,' ').trim().replace(/[.!]+$/,'');
const unique=(values:string[])=>[...new Map(values.map(s=>[key(s),s])).values()];
// Только известные эквивалентные формулировки evaluator заменяются именованными фактами.
// Произвольные предупреждения, противоречия и условия источника не сливаются эвристически.
function warnings(c:Card) {
  const covered=new Set([
    'Условия организатором повторно не проверены; получение API сегодня не подтверждает их свежесть.',
    'Наличие билета и выполнение регистрации пользователем не подтверждены.',
    'Непроверенный вариант; соответствие всем условиям запроса не установлено.',
    ...(c.occurrence?.kind==='FLEXIBLE_VISIT'?['Продолжительность осмотра и дорога не рассчитаны.']:[]),
    ...(!c.visit!.lastEntry?['Последний вход не указан.']:[]),
  ].map(key));
  return unique(c.visit!.warnings).filter(s=>!covered.has(key(s)));
}
const visitCaveat=(c:Card)=>c.occurrence?.kind==='FLEXIBLE_VISIT'?'Дата запроса — намерение посетить, не официальное начало события. Дорога и продолжительность осмотра не рассчитаны.':null;

function observations(entity:string, rows:Observation[]) {
  const names:Record<string,string>={id:'идентификатор',title:'название',address:'адрес',location:'город',timetable:'часы работы',
    site_url:'ссылка источника',foreign_url:'внешняя ссылка',is_stub:'признак заглушки',is_closed:'признак закрытия',
    categories:'категории',price:'цена',is_free:'признак бесплатного входа',dates:'даты посещения',place:'площадка'};
  const list=(values:string[])=>values.map(f=>names[f]??f).join(', ');
  const groups=new Map<string,Observation>();
  for(const o of rows) {
    const k=JSON.stringify([o.retrievedAt,o.requestUrl,[...new Set(o.conflicts)].sort()]);
    const prev=groups.get(k);
    if(prev) prev.fields=[...new Set([...prev.fields,...o.fields])];
    else groups.set(k,{...o,fields:[...new Set(o.fields)],conflicts:[...new Set(o.conflicts)]});
  }
  return [...groups.values()].map(o=>`Получено нами — ${entity}: ${o.retrievedAt?displayInstant(o.retrievedAt):'дата неизвестна'}.\nПоля: ${list(o.fields)||'не указаны'}.\nКонфликты: ${list(o.conflicts)||'не отмечены'}.\nURL получения: ${o.requestUrl??'не указан'}`);
}
function extraFacts(c:Card) {
  const v=c.visit!;
  const covered=[...c.unknown,...v.warnings,
    ...(v.price.evidence?[`Цена в источнике: «${v.price.evidence}».`]:[]),
    ...(v.from&&v.until&&v.timeAssessment?.state!=='UNKNOWN'?[
      c.occurrence?.kind==='TIMED_SESSION'?'Сеанс целиком в заданном окне по опубликованному времени.':'Есть пересечение окна с опубликованными часами посещения.']:[]),
    ...(c.query.budgetRub!==null&&v.price.amount!==null?[`Опубликованный вход на одного взрослого: ${v.price.amount} RUB, в пределах ${c.query.budgetRub} RUB.`]:[]),
    ...(c.occurrence?.kind==='TIMED_SESSION'&&c.occurrence.start?[`Начало: ${local(c.occurrence.start).slice(0,16).replace('T',' ')} (Москва); ${v.until?`окончание: ${local(v.until).slice(11,16)} (Москва)`:'окончание не указано'}.`]:[]),
  ];
  const keys=new Set(covered.map(key));return unique(c.facts).filter(s=>!keys.has(key(s))).map(s=>
    s==='Применимые факты получены не более 24 часов назад; источник не сообщает дату изменения условий.'
      ?'Проверка давности отбора: применимые факты получены не более 24 часов назад.':s);
}

export function cardOverview(c:Card): string {
  const v=c.visit;
  if(!v) return 'Старая закладка: место, адрес, последний вход, тариф и условия допуска отдельно не сохранялись.\nСохранённые сведения доступны в «Все условия»; проверьте источник.\n'+freshness(c)+'\n'+caveat;
  return [`Место: ${v.venue.title?compact(v.venue.title,100):'не указано'}.`,
    `Адрес: ${v.venue.address?compact(v.venue.address,200):'не указан'}.`,compact(schedule(c),330),lastEntry(c),
    `Цена: ${price(v.price)}.`, `Условия цены: ${compact(unique(v.price.conditions).join('; ')||v.price.evidence||'не указаны',180)}.`,
    `Регистрация: ${registration(v)}.`, `Условия допуска: ${compact(unique(v.admission.conditions).join('; ')||'дополнительные условия не указаны',180)}.`,
    ...(c.unknown.length?[`Нужно уточнить: ${compact(unique(c.unknown).join('; '),180)}`]:[]),
    ...(warnings(c).length?[`Ограничения: ${compact(warnings(c).join(' '),240)}`]:[]),
    compact(c.source.label,80),freshness(c),caveat,
    'Полные поля и ссылки: «Все условия».'].join('\n');
}

// Ни одно условие не теряется из-за длины соседнего поля. Каждая страница <= 2700 UTF-16 units.
export function cardPages(c:Card): string[] {
  const v=c.visit;
  const fields=v ? [`Место: ${v.venue.title??'не указано'}`,`Адрес: ${v.venue.address??'не указан'}`,schedule(c),lastEntry(c),
    `Цена: ${price(v.price)}`,`Цена в источнике: ${v.price.evidence??'текст не указан'}`,
    ...unique(v.price.conditions).map(s=>`Условие цены: ${s}`),`Регистрация: ${registration(v)}`,
    ...unique(v.admission.conditions).map(s=>`Условие допуска: ${s}`),...unique(c.unknown),...warnings(c),
    ...(v.timeAssessment?.state==='UNKNOWN'&&!c.unknown.some(s=>s.includes(v.timeAssessment!.detail))?[v.timeAssessment.detail]:[]),
    freshness(c),caveat,...observations('площадка',v.venueObservations),...observations('событие',v.eventObservations)]
    : ['Старая закладка: дополнительные поля не сохранялись; неизвестные сведения не восстановлены.',freshness(c),...c.unknown];
  fields.push(`${c.source.label}\n${c.source.url}`,...(v?.links??[]).map(l=>`${l.label}\n${l.url}`),`Полное название: ${c.title}`,...(v?extraFacts(c):unique(c.facts)));
  if(visitCaveat(c)) fields.push(visitCaveat(c)!);
  // Полное расписание хранит различающиеся дни/интервалы и их правила входа.
  if(v?.opening) {
    const groups=new Map<string,number[]>();
    for(const h of v.opening) {const k=`${hh(h.open)}–${hh(h.close)}, последний вход ${h.lastEntry===null?'не указан':hh(h.lastEntry)}`;groups.set(k,[...new Set([...(groups.get(k)??[]),h.weekday])]);}
    const days=['вс','пн','вт','ср','чт','пт','сб'];
    fields.push('Опубликованное расписание (Москва, UTC+3):\n'+[...groups].map(([hours,weekdays])=>`${weekdays.map(d=>days[d]).join(', ')}: ${hours}`).join('\n'));
  }
  const pages:string[]=[]; let page='';
  for(const field of fields) {
    let rest=field.replace(/[\u0000-\u0008\u000b-\u001f]/g,' ');
    while(rest.length) {
      const space=2600-page.length;
      let n=Math.min(space,rest.length);if(/[\uD800-\uDBFF]/.test(rest[n-1]??'')) n--;
      page+=rest.slice(0,n);rest=rest.slice(n);
      if(rest.length||page.length>2500) {pages.push(page);page=rest?'(продолжение поля)\n':'';} else page+='\n';
    }
  }
  if(page.trim()) pages.push(page);return pages;
}
