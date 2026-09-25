import type { NormalizedEvent, Observation, OpeningInterval, Price, Query } from '../data/contract.js';
import { localDate } from '../data/normalize.js';
import type { Candidate, Predicate, Recommendation } from '../data/select.js';
import { Catalog, digest } from './catalog.js';
import { cities, cityDate, localISO, zoneLabel, type CityKey, type Timezone } from '../data/cities.js';
import { partyPrice, type PartyAssessment } from '../data/party.js';
import { snapshotDigest, type DisplayRef } from '../data/source-policy.js';

export type Card = { identity: string; eventId: string; occurrenceId: string | null; title: string;
  source: { label: string; url: string }; kind: 'STRICT' | 'UNCERTAIN'; facts: string[]; unknown: string[];
  snapshotVersion: string; fingerprint: string; retrievedAt: string; synthetic: boolean; query: Query; displayRef?:DisplayRef;
  occurrence: { kind: string; start: string | null; end: string | null } | null;
  // Отсутствует в старых закладках. Не восстанавливаем исторические поля из нового каталога.
  visit?: { version: 1; venue: { id?:string|null; title: string | null; address: string | null };
    from: string | null; until: string | null; lastEntry: string | null; opening: OpeningInterval[] | null;
    timeAssessment?: Predicate;
    price: Price; admission: NormalizedEvent['admission']; warnings: string[]; partyPrice?: PartyAssessment;
    providerAgeLabel?: string | null; tariffs?: NormalizedEvent['tariffs'];
    providerUpdatedAt: string | null; eventObservations: Observation[]; venueObservations: Observation[];
    links: { label: string; url: string }[] } };

export function fingerprint(catalog: Catalog, eventId: string, city: CityKey = 'kzn') {
  const snapshot = catalog.forCity(city), e = snapshot?.events.find(e => e.id === eventId);
  return e ? digest({ e, venues: snapshot!.venues.filter(v => e.occurrences.some(o => o.venueId === v.id)) }) : null;
}
export function projectCard(catalog: Catalog, query: Query, r: Recommendation | Candidate): Card {
  const snapshot = catalog.forCity(query.city)!;
  const e = snapshot.events.find(e => e.id === r.eventId)!;
  const o = e.occurrences.find(o => o.id === r.occurrenceId);
  const venue = snapshot.venues.find(v => v.id === o?.venueId);
  const strict = 'from' in r;
  return { identity: digest([r.eventId,r.occurrenceId]), eventId:r.eventId,occurrenceId:r.occurrenceId,title:r.title,source:r.source,
    kind: strict ? 'STRICT':'UNCERTAIN', facts:strict ? r.reasons : [...r.usefulFacts,...r.factsMatched],
    unknown:strict ? []:r.checkAtSource, snapshotVersion:catalog.version,fingerprint:fingerprint(catalog,e.id,query.city)!,
    retrievedAt:r.eventRetrievedAt,synthetic:snapshot.mode==='SYNTHETIC_FIXTURE',query,
    ...(snapshot.mode==='REAL_CATALOG'?{displayRef:{snapshotHash:snapshotDigest(snapshot),eventId:e.id}}:{}),
    occurrence:o ? {kind:o.kind,start:o.start,end:o.end}:null,
    visit:{version:1,venue:{id:venue?.id??null,title:venue?.title?.trim()?venue.title:null,address:venue?.address?.trim()?venue.address:null},
      from:strict?r.from:r.time.from??o?.start??null,until:strict?r.until:r.time.until??o?.end??null,
      lastEntry:strict?r.lastEntry:r.time.lastEntry,opening:o?.opening??null,
      ...(!strict?{timeAssessment:r.time.assessment}:{}),
      price:r.price,partyPrice:r.partyPrice,tariffs:e.tariffs,providerAgeLabel:e.providerAgeLabel,admission:e.admission,warnings:[...r.warnings,...e.issues,...(o?.issues??[])],providerUpdatedAt:e.providerUpdatedAt,
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
export const presentationTitle=(c:Card)=>c.synthetic?c.title.replace(/^СИНТЕТИКА:\s*/u,''):c.title;

const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const displayDate=(s:string)=>Number(s.slice(8,10))+' '+months[Number(s.slice(5,7))-1]+' '+s.slice(0,4)+' г.';
export const displayInstant=(s:string,zone:Timezone='Europe/Moscow')=>displayDate(localISO(s,zone))+' '+localISO(s,zone).slice(11,16)+' ('+zoneLabel(zone)+')';
const zone=(c:Card)=>c.query.timezone??cities[c.query.city].timezone;
const at=(c:Card,s:string)=>localISO(s,zone(c)).slice(11,16);
const hh=(minutes:number)=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
const unique=(values:string[])=>[...new Map(values.map(s=>[s.replace(/\s+/g,' ').trim().replace(/[.!]+$/,''),s])).values()];
const legacyPrice=(p:Price)=>p.applicability==='SINGLE_ADULT'&&p.amount!==null&&['EXACT','FREE'].includes(p.kind)
  ? p.amount+' ₽ на одного взрослого' : p.kind==='FROM'&&p.lowerBound!==null ? 'от '+p.lowerBound+' ₽; применимый тариф неизвестен' : 'Применимый тариф неизвестен';
const cost=(c:Card)=>c.visit!.partyPrice?partyPrice(c.visit!.partyPrice!):legacyPrice(c.visit!.price);
function schedule(c:Card) {
  const v=c.visit!,day=cityDate(v.from??c.query.start,zone(c));
  if(c.occurrence?.kind==='TIMED_SESSION') return '📅 '+displayDate(day)+' · '+(v.from?at(c,v.from):'начало неизвестно')+'–'+(v.until?at(c,v.until):'окончание неизвестно')+' ('+zoneLabel(zone(c))+')';
  if(c.occurrence?.kind!=='FLEXIBLE_VISIT') return '📅 Время посещения неизвестно';
  const weekday=new Date(day+'T12:00:00Z').getUTCDay(),hours=v.opening?.filter(h=>h.weekday===weekday);
  return '📅 '+displayDate(day)+' · '+(v.from&&v.until?at(c,v.from)+'–'+at(c,v.until):'интервал не подтверждён')+' ('+zoneLabel(zone(c))+')\nЧасы работы: '+(hours?.length?unique(hours.map(h=>hh(h.open)+'–'+hh(h.close))).join('; '):'неизвестны');
}
const entry=(c:Card)=>{
  const day=cityDate(c.visit!.from??c.query.start,zone(c)),weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const cutoff=c.visit!.opening?.find(h=>h.weekday===weekday)?.salesCutoff;
  return 'Последний вход: '+(c.visit!.lastEntry?at(c,c.visit!.lastEntry):'не установлен')+(cutoff!=null?' · касса до '+hh(cutoff):'');
};
function freshness(c:Card,now=Date.now()) {
  if(c.synthetic) return 'Вымышленный набор для проверки интерфейса.';
  const hours=Math.floor((now-Date.parse(c.retrievedAt))/3600000);
  const age=hours<0?'с неизвестным временем получения':hours<1?'получены менее часа назад':hours<24?'получены '+hours+' ч назад':'получены '+Math.floor(hours/24)+' дн. назад';
  return compact(c.source.label,100)+' · сведения '+age+'.\nУсловия организатором не перепроверены.';
}
function conditions(c:Card) {
  const v=c.visit!;
  // Семантическая группировка известных эквивалентов. Исходные поля неизменны.
  const priceConditions=unique(v.price.conditions.map(s=>s==='Один взрослый, одна выставка'?'Билет на одну выставку.':s));
  const registration=v.admission.registration==='REQUIRED'?'Регистрация: обязательна.':v.admission.registration==='UNKNOWN'?'Регистрация: требование неизвестно.':'Регистрация не требуется по данным набора.';
  const admission=v.admission.conditions.filter(s=>!(v.admission.registration==='REQUIRED'&&/^(?:Регистрация обязательна|Требуется регистрация)[.!]?$/i.test(s)));
  const conflicts=unique([...v.eventObservations,...v.venueObservations].flatMap(o=>o.conflicts));
  const names:Record<string,string>={address:'адрес',location:'город',price:'цена',is_free:'бесплатность',dates:'даты',timetable:'расписание',title:'название'};
  const covered=['Условия организатором повторно не проверены; получение API сегодня не подтверждает их свежесть.',
    'Наличие билета и выполнение регистрации пользователем не подтверждены.','Непроверенный вариант; соответствие всем условиям запроса не установлено.',
    'Продолжительность осмотра и дорога не рассчитаны.','Последний вход не указан.'];
  return unique([registration,...admission,...priceConditions,
    ...(v.tariffs??[]).flatMap(t=>[
      `${t.audience==='ADULT'?'Взрослый':t.audience==='CHILD'?`Детский ${t.minAge??0}–${t.maxAge??17} лет`:'Группа / пакет'}: ${['EXACT','FREE'].includes(t.kind)&&t.amount!==null?`${t.amount} ₽`:t.kind==='FROM'&&t.lowerBound!==null?`от ${t.lowerBound} ₽`:t.kind==='PACKAGE'?'пакет, общий расчёт не выполнен':'применимость или цена требует уточнения'}${!t.applicable?' (условия не подтверждены)':''}.`,
      ...t.conditions,...(!['EXACT','FREE'].includes(t.kind)&&t.evidence?[t.evidence]:[])]),
    ...(v.providerAgeLabel?['Маркировка источника: '+v.providerAgeLabel+' (не тариф и не отдельное правило допуска).']:[]),
    ...(v.admission.requirements?.minimumAge!==null&&v.admission.requirements?.minimumAge!==undefined?['Условие допуска: с '+v.admission.requirements.minimumAge+' лет.']:[]),
    ...(v.partyPrice?.admissionNotes??[]),
    ...(v.price.kind==='CONFLICT'?['Противоречие цены и признака бесплатного входа.']:[]),
    ...(conflicts.length?['В источнике расходятся сведения: '+conflicts.map(s=>names[s]??'условия посещения').join(', ')+'.']:[]),
    ...c.unknown.filter(s=>!(v.partyPrice?.unresolved.length&&s.includes('итоговую цену'))),
    ...v.warnings.filter(s=>!covered.includes(s))]);
}
export function cardOverview(c:Card,now=Date.now()): string {
  const v=c.visit;
  if(!v) return 'Старая закладка: подробные условия не сохранялись. Выполните новый подбор.\n'+freshness(c,now);
  const important=conditions(c).filter(s=>!/Билет на одну выставку|Регистрация не требуется/.test(s));
  return ['📍 '+cities[c.query.city].name+' · '+(v.venue.title?compact(c.synthetic?v.venue.title.replace(/^СИНТЕТИКА:\s*/u,''):v.venue.title,150):'площадка неизвестна'),
    v.venue.address?compact(v.venue.address,200):'Адрес неизвестен',schedule(c),'💳 '+cost(c),entry(c),
    ...important.slice(0,2).map(s=>compact(s,240)),
    ...(v.partyPrice?.admission==='UNKNOWN'?['Допуск выбранного состава требует уточнения.']:[]),
    ...(important.some(s=>/расходятся|Противоречие/.test(s))?['⚠️ Есть противоречие: откройте условия посещения.']:[]),freshness(c,now)].join('\n');
}
// Условия посещения, не экспорт БД. Все отличающиеся ограничения доступны страницами.
// Raw observations, timestamps и URL запросов остаются в Card / локальном evidence.
export function cardPages(c:Card,now=Date.now()): string[] {
  const v=c.visit;
  const fields=v?[`Место: ${v.venue.title??'не указано'}`,`Адрес: ${v.venue.address??'не указан'}`,schedule(c),entry(c),'Вход: '+cost(c),...conditions(c),
    ...(!['FREE','EXACT'].includes(v.price.kind)&&v.price.evidence?['Опубликованный тариф: '+v.price.evidence]:[]),
    'Наличие билетов не проверено. Сохранение не означает регистрацию.',
    ...(c.occurrence?.kind==='FLEXIBLE_VISIT'?['Дорога и длительность осмотра не рассчитаны.']:[]),
    ...(c.title.length>160?['Полное название: '+c.title]:[]),freshness(c,now),
    ...(!c.synthetic?['Дата получения: '+displayInstant(c.retrievedAt,zone(c)),
      'Изменено источником: '+(v.providerUpdatedAt?displayInstant(v.providerUpdatedAt,zone(c)):'дата неизвестна')]:[])]
    :['Старая закладка: дополнительные условия не сохранялись.',...c.unknown,...c.facts,freshness(c,now)];
  const pages:string[]=[];let page='';
  for(const field of fields) {
    let rest=field.replace(/[\u0000-\u0008\u000b-\u001f]/g,' ');
    while(rest.length) {
      let n=Math.min(2400-page.length,rest.length);if(/[\uD800-\uDBFF]/.test(rest[n-1]??'')) n--;
      page+=rest.slice(0,n);rest=rest.slice(n);
      if(rest.length||page.length>2300){pages.push(page);page='';}else page+='\n';
    }
  }
  if(page.trim()) pages.push(page);return pages;
}
