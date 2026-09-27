import { Catalog, digest } from './catalog.js';
import { projectCard, displayInterval, type Card } from './card.js';
import { cities } from '../data/cities.js';
import { assess, reasonText } from '../data/select.js';
import { snapshotDigest } from '../data/source-policy.js';
import { sourceReviews } from '../data/reviews.js';

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
export function bookmarkContext(c:Card,sourceFactsAllowed=true) {
  const interval=sourceFactsAllowed?selectedInterval(c):null,p=c.query.party??{adults:1,childAges:[]};
  const from=interval?new Date(interval[0]).toISOString():c.query.start,until=interval?new Date(interval[1]).toISOString():c.query.end;
  return `${cities[c.query.city].name} · ${displayInterval(from,until,c.query.timezone??cities[c.query.city].timezone)}\n`+
    `${p.adults} взр., ${p.childAges.length} дет.${p.childAges.length?' · возраст: '+p.childAges.map(a=>a===null?'?':a).join(', '):''}`+
    (interval?'':' · окно поиска; время события не подтверждено');
}
export function equivalentChoice(a:Card,b:Card) {
  const choice=(c:Card)=>({event:c.identity,source:c.source.url,city:c.query.city,
    start:Date.parse(c.query.start),end:Date.parse(c.query.end),visit:selectedInterval(c),
    party:{adults:c.query.party?.adults??1,ages:[...(c.query.party?.childAges??[])].sort((a,b)=>(a??-1)-(b??-1))},
    budget:c.query.budgetRub,basis:c.query.budgetBasis??'SINGLE_ADULT'});
  return digest(choice(a))===digest(choice(b));
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
  const ref={snapshotHash:snapshotDigest(s),eventId:e.id};
  if(!catalog.permits([ref],now))return unavailable('Сведения сейчас недоступны: срок проверки истёк или показ не разрешён. Попробуйте подбор позже.');
  const venue=s.venues.find(v=>v.id===o.venueId),old=saved.visit;
  const sameVenue=old?.venue.id?old.venue.id===o.venueId&&old.venue.title===venue?.title&&old.venue.address===venue?.address:
    Boolean(old?.venue.title&&old.venue.address&&venue?.title===old.venue.title&&venue.address===old.venue.address);
  if(sourceReviews.some(r=>r.eventId===e.id)||e.city!==saved.query.city||e.sourceUrl!==saved.source.url||e.title!==saved.title
    ||!sameVenue||!saved.occurrence||o.kind!==saved.occurrence.kind||o.start!==saved.occurrence.start)
    return unavailable('Событие, сеанс или площадка изменились. Прежнюю закладку нельзя сопоставить с ними. Выполните новый подбор.');
  const q={...saved.query,start:old?.from??saved.query.start,end:old?.until??saved.query.end};
  const checked=assess(e,o,venue,q,now,s.freshnessHours);
  const current=projectCard(catalog,saved.query,checked.match??checked.view!);
  const before=conditions(saved),after=conditions(current);
  const changed=(Object.keys(before) as (keyof typeof before)[]).filter(k=>digest(before[k])!==digest(after[k]));
  const expired=now>=Date.parse(q.end);
  const assessment=expired?'EXPIRED':checked.hard.length?'MISMATCH':checked.match?'STRICT':'UNCERTAIN';
  const outcome=expired?'Выбранное время уже прошло. Выполните новый подбор.':checked.hard.length?
    'Больше не подходит: '+checked.hard.map(c=>reasonText[c]).join(' '):'';
  return {card:current,assessment,changed,notice:[
    changed.length?'Изменились условия: '+changed.join(', ')+'.':'',outcome].filter(Boolean).join('\n')};
}
