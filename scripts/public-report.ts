import {writeFileSync,mkdirSync} from 'node:fs';
import {Catalog} from '../src/culture/catalog.js';
import {select} from '../src/data/select.js';
import {cityDate,cityInstant,cities,type CityKey} from '../src/data/cities.js';
import type {Query} from '../src/data/contract.js';
const c=Catalog.load({flowDataMode:'real',snapshotPath:'catalog/real/active.json',admissionMode:'PUBLIC'} as any);
const at=new Date(Date.parse(c.review!.reviewedAt)+1000),snapshots=c.availableCities.map(city=>c.forCity(city)!),events=snapshots.flatMap(s=>s.events),occurrences=events.flatMap(e=>e.occurrences);
const queries=[];
for(const city of ['kzn','ekb'] as CityKey[])for(const [days,from,until,budget,party] of [
 [1,'12:00','18:00',500,{adults:1,childAges:[]}],[1,'12:00','18:00',1500,{adults:2,childAges:[7]}],
 [7,'18:00','23:00',null,{adults:1,childAges:[]}],[27,'10:00','18:00',null,{adults:1,childAges:[]}],
 [1,'02:00','03:00',0,{adults:1,childAges:[]}]] as const) {
 const timezone=cities[city].timezone,date=cityDate(new Date(at.getTime()+days*86400000).toISOString(),timezone);
 const q:Query={version:2,city,timezone,start:cityInstant(date,from,timezone),end:cityInstant(date,until,timezone),budgetRub:budget,party:{adults:party.adults,childAges:[...party.childAges]},budgetBasis:'PARTY_TOTAL',category:null,zone:null,kind:'ANY',preferences:{categories:[]}};
 const result=select(c.forCity(city),q,at,false,true);
 queries.push({query:q,strict:result.strictTotal,candidates:result.uncertainTotal,titles:[...result.recommendations,...result.uncertain].map(e=>({title:e.title,source:e.source.url})),excluded:result.excluded});
}
const counts={events:events.length,occurrences:occurrences.length,timedSessions:occurrences.filter(o=>o.kind==='TIMED_SESSION').length,exhibitionPeriods:occurrences.filter(o=>o.kind==='FLEXIBLE_VISIT').length,cities:snapshots.length,sources:new Set(events.map(e=>e.provider)).size};
const coverage={verdict:'AUTOMATED_APPLICATION_REPLAY',at:at.toISOString(),counts,byCity:Object.fromEntries(c.availableCities.map(city=>[city,c.forCity(city)!.events.length])),bySource:Object.fromEntries([...new Set(events.map(e=>e.provider))].map(id=>[id,{events:events.filter(e=>e.provider===id).length,occurrences:events.filter(e=>e.provider===id).reduce((n,e)=>n+e.occurrences.length,0)}])),queries,human:{mobile:'DEFERRED_BY_USER / NOT_RUN',web:'DEFERRED_BY_USER / NOT_RUN'}};
mkdirSync('docs/evidence/public-handoff',{recursive:true});writeFileSync('docs/evidence/public-handoff/coverage.json',JSON.stringify(coverage,null,2)+'\n');console.log(JSON.stringify({counts,byCity:coverage.byCity,bySource:coverage.bySource,queries:queries.map(q=>({city:q.query.city,date:q.query.start,strict:q.strict,candidates:q.candidates}))}));
