import { Catalog, digest } from './catalog.js';
import { projectCard, type Card } from './card.js';
import { assess, reasonText } from '../data/select.js';
import { snapshotDigest } from '../data/source-policy.js';
import { sourceReviews } from '../data/reviews.js';

export type BookmarkView={card:Card|null;notice:string;assessment:'STRICT'|'UNCERTAIN'|'MISMATCH'|'EXPIRED'|'UNAVAILABLE';changed:string[]};
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
  if(!s||s.mode!=='REAL_CATALOG'||!e||!o)return unavailable('Событие или выбранное посещение отсутствует в текущем снимке. Это не подтверждение отмены.');
  const ref={snapshotHash:snapshotDigest(s),eventId:e.id};
  if(!catalog.permits([ref],now))return unavailable('Текущие сведения недоступны: снимок не проверен или срок проверки истёк.');
  const venue=s.venues.find(v=>v.id===o.venueId),old=saved.visit;
  const sameVenue=old?.venue.id?old.venue.id===o.venueId&&old.venue.title===venue?.title&&old.venue.address===venue?.address:
    Boolean(old?.venue.title&&old.venue.address&&venue?.title===old.venue.title&&venue.address===old.venue.address);
  if(sourceReviews.some(r=>r.eventId===e.id)||e.city!==saved.query.city||e.sourceUrl!==saved.source.url||e.title!==saved.title
    ||!sameVenue||!saved.occurrence||o.kind!==saved.occurrence.kind||o.start!==saved.occurrence.start)
    return unavailable('Не подтверждена прежняя идентичность события, сеанса или площадки. Закладка не переносилась.');
  const q={...saved.query,start:old?.from??saved.query.start,end:old?.until??saved.query.end};
  const checked=assess(e,o,venue,q,now,s.freshnessHours);
  const current=projectCard(catalog,saved.query,checked.match??checked.view!);
  const before=conditions(saved),after=conditions(current);
  const changed=(Object.keys(before) as (keyof typeof before)[]).filter(k=>digest(before[k])!==digest(after[k]));
  const expired=now>=Date.parse(q.end);
  const assessment=expired?'EXPIRED':checked.hard.length?'MISMATCH':checked.match?'STRICT':'UNCERTAIN';
  const outcome=expired?'Сохранённая дата или интервал уже прошли.':checked.hard.length?
    'Текущие условия не соответствуют сохранённому запросу: '+checked.hard.map(c=>reasonText[c]).join(' '):checked.match?
    'Текущие условия соответствуют сохранённому запросу по известным данным.':'Текущие условия требуют уточнения: '+checked.unknown.map(c=>reasonText[c]).join(' ');
  return {card:current,assessment,changed,notice:[
    'Ниже текущие опубликованные условия; исходный выбор в закладке сохранён.',
    changed.length?'Изменились условия: '+changed.join(', ')+'.':'Изменений тарифа, времени и допуска не выявлено.',outcome].join('\n')};
}
