import type { NormalizedEvent, Observation, OpeningInterval, Price, Query } from '../data/contract.js';
import { localDate } from '../data/normalize.js';
import type { Candidate, Recommendation } from '../data/select.js';
import { Catalog, digest } from './catalog.js';

export type Card = { identity: string; eventId: string; occurrenceId: string | null; title: string;
  source: { label: string; url: string }; kind: 'STRICT' | 'UNCERTAIN'; facts: string[]; unknown: string[];
  snapshotVersion: string; fingerprint: string; retrievedAt: string; synthetic: boolean; query: Query;
  occurrence: { kind: string; start: string | null; end: string | null } | null;
  // Отсутствует в старых закладках. Не восстанавливаем исторические поля из нового каталога.
  visit?: { version: 1; venue: { title: string | null; address: string | null };
    from: string | null; until: string | null; lastEntry: string | null; opening: OpeningInterval[] | null;
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
      from:strict?r.from:o?.start??null,until:strict?r.until:o?.end??null,lastEntry:strict?r.lastEntry:null,opening:o?.opening??null,
      price:r.price,admission:e.admission,warnings:r.warnings,providerUpdatedAt:e.providerUpdatedAt,
      eventObservations:r.eventObservations,venueObservations:r.venueObservations,
      links:[...(e.organizerUrl?[{label:'Организатор',url:e.organizerUrl}]:[]),...(e.ticketUrl?[{label:'Билеты',url:e.ticketUrl}]:[]),
        ...(venue?.sourceUrl?[{label:'Площадка',url:venue.sourceUrl}]:[])]} };
}

// Ограничения относятся к отдельным полям обзора. Полные поля доступны страницами.
export const compact = (s: string, limit = 160) => {
  const clean=s.replace(/[\u0000-\u001f]/g,' ');
  return clean.length<=limit ? clean : `${clean.slice(0,limit-1).replace(/[\uD800-\uDBFF]$/,'')}…`;
};
const at=(s:string)=>new Date(Date.parse(s)+3*3600000).toISOString().slice(0,16).replace('T',' ');
const hh=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const price=(p:Price)=>p.applicability==='SINGLE_ADULT'&&p.amount!==null&&['EXACT','FREE'].includes(p.kind)
  ? `${p.amount} ₽ на одного взрослого` : p.kind==='FROM'&&p.lowerBound!==null ? `от ${p.lowerBound} ₽; взрослый тариф не установлен` : 'применимый взрослый тариф не установлен';
const registration=(v:NonNullable<Card['visit']>)=>v.admission.registration==='REQUIRED'?'обязательна':v.admission.registration==='NOT_REQUIRED'?'не требуется по источнику':'требование неизвестно';
function schedule(c:Card) {
  const v=c.visit!;
  if(c.occurrence?.kind==='TIMED_SESSION') return `Сеанс: ${v.from?at(v.from):'начало неизвестно'} — ${v.until?at(v.until):'окончание неизвестно'} (Москва).`;
  if(c.occurrence?.kind!=='FLEXIBLE_VISIT') return 'Режим и время посещения не установлены.';
  const weekday=new Date(`${localDate(v.from??c.query.start)}T12:00:00Z`).getUTCDay();
  const hours=v.opening?.filter(h=>h.weekday===weekday);
  return `Свободное посещение. Часы на выбранную дату: ${hours?.length?hours.map(h=>`${hh(h.open)}–${hh(h.close)}${h.lastEntry===null?'':` (последний вход ${hh(h.lastEntry)})`}`).join('; '):'не указаны'}.\nПересечение с запросом: ${v.from&&v.until?`${at(v.from)} — ${at(v.until)} (Москва)`:'не подтверждено'}.`;
}
const lastEntry=(c:Card)=>`Последний вход: ${c.visit!.lastEntry?`${at(c.visit!.lastEntry)} (Москва)`:'для выбранного интервала не установлен; см. опубликованные часы'}.`;
const freshness=(c:Card)=>`Данные получены: ${c.retrievedAt}. Получение API не подтверждает свежесть условий у организатора.\nДата изменения у источника: ${c.visit?.providerUpdatedAt??'не указана'}.`;
const caveat='Наличие билета и выполнение регистрации пользователем не проверены. Сохранение — только закладка.';

export function cardOverview(c:Card): string {
  const v=c.visit;
  if(!v) return 'Старая закладка: место, адрес, последний вход, тариф и условия допуска отдельно не сохранялись.\nСохранённые сведения доступны в «Все условия»; проверьте источник.\n'+freshness(c)+'\n'+caveat;
  return [`Место: ${v.venue.title?compact(v.venue.title,100):'не указано'}.`,
    `Адрес: ${v.venue.address?compact(v.venue.address,200):'не указан'}.`,compact(schedule(c),330),lastEntry(c),
    `Цена: ${price(v.price)}.`, `Условия цены: ${compact(v.price.conditions.join('; ')||v.price.evidence||'не указаны',180)}.`,
    `Регистрация: ${registration(v)}.`, `Условия допуска: ${compact(v.admission.conditions.join('; ')||'дополнительные условия не указаны',180)}.`,
    ...(c.unknown.length?[`Неизвестно: ${compact(c.unknown.join('; '),180)}`]:[]),
    `Ограничения: ${compact(v.warnings.join(' '),240)}`,freshness(c),compact(c.source.label,80),caveat,
    'Полные поля и ссылки: «Все условия».'].join('\n');
}

// Ни одно условие не теряется из-за длины соседнего поля. Каждая страница <= 2700 UTF-16 units.
export function cardPages(c:Card): string[] {
  const v=c.visit;
  const fields=v ? [`Место: ${v.venue.title??'не указано'}`,`Адрес: ${v.venue.address??'не указан'}`,schedule(c),lastEntry(c),
    `Цена: ${price(v.price)}`,`Цена в источнике: ${v.price.evidence??'текст не указан'}`,
    ...v.price.conditions.map(s=>`Условие цены: ${s}`),`Регистрация: ${registration(v)}`,
    ...v.admission.conditions.map(s=>`Условие допуска: ${s}`),...c.unknown,...v.warnings,
    freshness(c),caveat,...v.venueObservations.map(o=>`Сведения о площадке получены: ${o.retrievedAt??'дата неизвестна'}${o.requestUrl?`\n${o.requestUrl}`:''}`),
    ...v.eventObservations.map(o=>`Сведения о событии получены: ${o.retrievedAt??'дата неизвестна'}${o.requestUrl?`\n${o.requestUrl}`:''}`)]
    : ['Старая закладка: дополнительные поля не сохранялись; неизвестные сведения не восстановлены.',freshness(c),...c.unknown];
  fields.push(`${c.source.label}\n${c.source.url}`,...(v?.links??[]).map(l=>`${l.label}\n${l.url}`),`Полное название: ${c.title}`,...c.facts);
  if(c.occurrence?.kind==='FLEXIBLE_VISIT') fields.push('Дата запроса — намерение посетить, не официальное начало события. Дорога и продолжительность осмотра не рассчитаны.');
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
