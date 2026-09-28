import { Catalog, digest } from './catalog.js';
import { projectCard, displayInterval, type Card } from './card.js';
import { cities } from '../data/cities.js';
import { assess, reasonText } from '../data/select.js';
import { snapshotDigest } from '../data/source-policy.js';
import { sourceReviews } from '../data/reviews.js';
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage.js';
import { cityDate, cityInstant } from '../data/cities.js';

export type BookmarkView={card:Card|null;notice:string;assessment:'STRICT'|'UNCERTAIN'|'MISMATCH'|'EXPIRED'|'UNAVAILABLE';changed:string[]};

// Только известное выбранное посещение. Период выставки и часы работы не занятость.
export function selectedInterval(c:Card):[number,number]|null {
  const v=c.visit;
  if(!v?.from||!v.until||v.timeAssessment&&v.timeAssessment.state!=='MATCH')return null;
  let from=Date.parse(v.from),until=Date.parse(v.until);
  if(c.occurrence?.kind==='FLEXIBLE_VISIT') {
    from=Math.max(from,Date.parse(c.query.start));until=Math.min(until,Date.parse(c.query.end));
  } else if(c.occurrence?.kind!=='TIMED_SESSION')return null;
  return Number.isFinite(from)&&Number.isFinite(until)&&from<until?[from,until]:null;
}
function intendedInterval(c:Card) {
  // Уникальность гибкого визита не зависит от нового среза текущим clock.
  // Пересечения для предупреждений по-прежнему используют фактический selectedInterval.
  const zone=c.query.timezone??cities[c.query.city].timezone,day=cityDate(c.visit?.from??c.query.start,zone);
  const midnight=Date.parse(cityInstant(day,'00:00',zone)),weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const from=Date.parse(c.query.start),until=Date.parse(c.query.end),actual=selectedInterval(c);
  const hours=actual&&c.visit?.opening?.find(h=>h.weekday===weekday&&midnight+h.open*60000<=actual[0]&&midnight+h.close*60000>=actual[1]);
  return hours?[Math.max(from,midnight+hours.open*60000),Math.min(until,midnight+hours.close*60000)]:[from,until];
}
export function bookmarkContext(c:Card,sourceFactsAllowed=true) {
  const interval=sourceFactsAllowed?selectedInterval(c):null,p=c.query.party??{adults:1,childAges:[]};
  const from=interval?new Date(interval[0]).toISOString():c.query.start,until=interval?new Date(interval[1]).toISOString():c.query.end;
  return `${cities[c.query.city].name} · ${displayInterval(from,until,c.query.timezone??cities[c.query.city].timezone)}\n`+
    `${p.adults} взр., ${p.childAges.length} дет.${p.childAges.length?' · возраст: '+p.childAges.map(a=>a===null?'?':a).join(', '):''}`+
    (interval?'':' · окно поиска; время события не подтверждено');
}
export function equivalentChoice(a:Card,b:Card) {
  const choice=(c:Card)=>({event:c.eventId,occurrence:c.occurrenceId,city:c.query.city,
    visit:c.occurrence?.kind==='TIMED_SESSION'&&(c.occurrence.start??c.visit?.from)?[c.occurrence.start??c.visit?.from??null,c.occurrence.end??c.visit?.until??null].map(v=>v?Date.parse(v):null)
      :intendedInterval(c),
    party:{adults:c.query.party?.adults??1,ages:[...(c.query.party?.childAges??[])].sort((a,b)=>(a??-1)-(b??-1))},
  });
  return digest(choice(a))===digest(choice(b));
}
export type SavedBookmark={identity:string;generation:string;data:string;saved_at:number};
export function alreadySaved(store:Storage,actor:string,card:Card):SavedBookmark|undefined {
  return (store.db.prepare('SELECT identity,generation,data,saved_at FROM bookmarks WHERE actor=? ORDER BY saved_at,identity').all(actor) as SavedBookmark[])
    .find(b=>equivalentChoice(JSON.parse(b.data) as Card,card));
}
export function saveBookmark(store:Storage,actor:string,card:Card,action:string,now:number) {
  // BEGIN IMMEDIATE сериализует разных SQLite writers; внутри worker это savepoint.
  // Не нужен UNIQUE по варианту: прежние одинаковые записи сохраняются как есть.
  return store.db.transaction(()=>{
    const existing=alreadySaved(store,actor,card);
    if(existing)return {kind:'EXISTING' as const,bookmark:existing};
    const previous=store.db.prepare('SELECT data FROM bookmarks WHERE actor=?').all(actor) as {data:string}[];
    if(previous.length>=50)return {kind:'LIMIT' as const};
    const bookmark={identity:randomUUID(),generation:randomUUID(),saved_at:now,data:JSON.stringify(card)};
    const inserted=store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data,save_action) VALUES(?,?,?,?,?,?)')
      .run(actor,bookmark.identity,bookmark.generation,now,bookmark.data,action);
    if(inserted.changes!==1)throw Error('BOOKMARK_NOT_CREATED');
    return {kind:'CREATED' as const,bookmark,overlap:previous.some(b=>overlappingChoice(JSON.parse(b.data),card))};
  }).immediate();
}
export function overlappingChoice(a:Card,b:Card) {
  const x=selectedInterval(a),y=selectedInterval(b);
  return Boolean(x&&y&&x[0]<y[1]&&y[0]<x[1]);
}
// Сравнение условий не включает даты получения, hash, parser version или текущий clock.
function conditions(c:Card) {
  const v=c.visit;
  return {тариф:{price:v?.price,tariffs:v?.tariffs??[]},
    время:{occurrence:c.occurrence,opening:v?.opening},
    допуск:{admission:v?.admission,ageLabel:v?.providerAgeLabel??null}};
}
export function currentBookmark(saved:Card,catalog:Catalog,now:number):BookmarkView {
  const unavailable=(notice:string):BookmarkView=>({card:null,notice,assessment:'UNAVAILABLE',changed:[]});
  const s=catalog.forCity(saved.query.city),e=s?.events.find(e=>e.id===saved.eventId),o=e?.occurrences.find(o=>o.id===saved.occurrenceId);
  if(!s||s.mode!=='REAL_CATALOG'||!e||!o)return unavailable('События или выбранного посещения сейчас нет в каталоге. Это не подтверждение отмены. Попробуйте подбор позже.');
  const ref=catalog.displayRef(e.id)!;
  if(!catalog.permits([ref],now))return unavailable('Сведения сейчас недоступны: срок проверки истёк или показ не разрешён. Попробуйте подбор позже.');
  const venue=s.venues.find(v=>v.id===o.venueId),old=saved.visit;
  const sameVenue=old?.venue.id?old.venue.id===o.venueId&&old.venue.title===venue?.title&&old.venue.address===venue?.address:
    Boolean(old?.venue.title&&old.venue.address&&venue?.title===old.venue.title&&venue.address===old.venue.address);
  if(sourceReviews.some(r=>r.eventId===e.id)||e.city!==saved.query.city||e.sourceUrl!==saved.source.url||e.title!==saved.title
    ||!sameVenue||!saved.occurrence||o.kind!==saved.occurrence.kind||o.start!==saved.occurrence.start)
    return unavailable('Событие, сеанс или площадка изменились. Прежнюю закладку нельзя сопоставить с ними. Выполните новый подбор.');
  const q={...saved.query,start:old?.from??saved.query.start,end:old?.until??saved.query.end};
  const checked=assess(e,o,venue,q,now,s.freshnessHours);
  if(saved.proposedVisit&&checked.match&&old?.from&&old.until&&
    (Date.parse(checked.match.from)!==Math.max(now,Date.parse(old.from))||Date.parse(checked.match.until)!==Date.parse(old.until))) {
    checked.hard.push('OUTSIDE_WINDOW');delete checked.match;
    const predicate=checked.predicates.find(p=>p.name==='time')!;predicate.state='MISMATCH';predicate.detail=reasonText.OUTSIDE_WINDOW!;
    checked.view!.checkAtSource.push('Не соответствует: '+predicate.detail);
  }
  const current=projectCard(catalog,saved.query,checked.match??checked.view!);
  if(saved.proposedVisit) {
    current.proposedVisit=true;
    // Обновляются условия, а выбранная дата/интервал остаются историческим выбором.
    if(current.visit&&old) {current.visit.from=old.from;current.visit.until=old.until;}
  }
  const before=conditions(saved),after=conditions(current);
  const changed=(Object.keys(before) as (keyof typeof before)[]).filter(k=>digest(before[k])!==digest(after[k]));
  const expired=now>=Date.parse(q.end);
  const assessment=expired?'EXPIRED':checked.hard.length?'MISMATCH':checked.match?'STRICT':'UNCERTAIN';
  const outcome=expired?'Выбранное время уже прошло. Выполните новый подбор.':checked.hard.length?
    'Больше не подходит: '+checked.hard.map(c=>reasonText[c]).join(' '):'';
  return {card:current,assessment,changed,notice:[
    changed.length?'Изменились условия: '+changed.join(', ')+'.':'',outcome].filter(Boolean).join('\n')};
}
