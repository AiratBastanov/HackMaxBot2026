import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { InstitutionClient,atomicJson } from './institution-http.js';
import { type Page,makeSnapshots,attr,tag } from './institutions.js';
import { sources,type Institution } from './source-registry.js';
import { reparse,preparedSchema,type CandidateFile } from './real-refresh.js';
import { cityDate,cities,type CityKey } from './cities.js';
import { sourceReviews } from './reviews.js';
import { type Snapshot,type Venue,normalizedEventSchema,venueSchema } from './contract.js';
import * as p from './multi-parsers.js';

export function campaignPages(client:InstitutionClient):Map<string,Page>{
 const result=new Map<string,Page>();
 for(const url of new Set(client.ledger.requests.filter(r=>r.outcome==='OK'&&!r.url.endsWith('/robots.txt')&&!/\.js(?:\?|$)/.test(r.url)).map(r=>r.url))){const page=client.cached(url);if(!page)continue;const actual=new URL(page.url);actual.searchParams.delete('_catalog_request');result.set(url,{...page,url:actual.href});}
 return result;
}
export function parseMultiPages(pages:Map<string,Page>,now:string){const rows:p.Row[]=[],queue:{url:string;reason:string}[]=[],library=new Map<string,string[]>(),cancelled=new Set<string>();
 for(const page of pages.values())if(page.url.startsWith('https://pl.spb.ru/events/showEventsList.php')){const date=new URL(page.url).searchParams.get('date');if(!date)continue;for(const n of p.dom(page).filter(n=>tag(n)==='a'&&p.has(n,'events__item'))){const url=p.absolute(attr(n,'href'),page);library.set(url,[...library.get(url)??[],date]);if(p.has(n,'events__item_cancel'))cancelled.add(url);}}
 for(const page of pages.values())try{const u=new URL(page.url),url=page.url,path=u.pathname;let result:p.Row[]=[];const one=(r:p.Row|null)=>r?[r]:[];
  if(u.origin===sources.novat.origin&&/^\/afisha\/(performances|excursions)\/detail\/\d+\/$/.test(path))result=one(p.parseNovat(page));
  if(u.origin===sources['spb-philharmonia'].origin&&/^\/afisha\/\d+\/$/.test(path))result=one(p.parseSpbPhil(page,pages));
  if(u.origin===sources.krasfil.origin&&/^\/events\/\d+$/.test(path))result=one(p.parseKrasfil(page,pages));
  if(url===sources.bashopera.origin+'/affiche/')result=p.parseBashopera(page,pages);
  if(url===sources['samara-opera'].origin+'/afisha/')result=p.parseSamaraOpera(page,pages);
  if(u.origin===sources.operann.origin&&path==='/afisha')result=p.parseOperaNNFull(page,pages);
  if(u.origin===sources.meloman.origin&&(path==='/concert/'||path==='/project/phpfiles/web/ajax.php'))result=p.parseMelomanList(page,pages);
  if(u.origin===sources.permopera.origin&&path.startsWith('/playbills/playbill/')&&(u.searchParams.has('json')||path==='/playbills/playbill/'))result=p.parsePermOpera(page,pages);
  if(u.origin===sources['spb-opera'].origin&&path==='/afisha/')result=p.parseSpbOpera(page,pages);
  if(u.origin===sources.filarm.origin&&['/','/afisha/','/ajax.php'].includes(path))result=p.parseFilarm(page,pages);
  if(u.origin===sources['nn-art'].origin&&/^\/(vystavki\/\d+|postoyannye-expozitzii\/[^/]+)\/$/.test(path))result=one(p.parseNNArt(page,pages));
  if(u.origin===sources['spb-museum'].origin&&/^\/exhibits_and_exhibitions\/[^/]+\/\d+\/$/.test(path))result=one(p.parseSpbMuseum(page,pages));
  if(u.origin===sources['chel-philharmonia'].origin&&/^\/afisha\/\d+[^/]*\/$/.test(path))result=one(p.parseChelPhil(page,pages));
  if(u.origin===sources['chel-museum'].origin&&/^\/exhibitions\/[^/]+\/$/.test(path))result=one(p.parseChelMuseum(page,pages));
  if(u.origin===sources['perm-museum'].origin&&/^\/event\/\d+$/.test(path))result=one(p.parsePermMuseum(page));
  if(u.origin===sources['spb-library'].origin&&path==='/events/detail.php'){result=one(p.parseSpbLibrary(page,library.get(url)??[]));if(cancelled.has(url))result.forEach(r=>r.event.occurrences.forEach(o=>o.cancelled=true));}
  if(u.origin===sources['nsk-library'].origin&&/^\/afisha\/events\/\d+\/$/.test(path))result=one(p.parseNskLibrary(page,pages));
  if(url===sources['samara-library'].origin+'/afisha')result=p.parseSamaraLibrary(page,pages);
  if(u.origin===sources['perm-library'].origin&&/^\/events\/[^/]+\/?$/.test(path))result=one(p.parsePermLibrary(page,pages));
  if(u.origin===sources['nn-library'].origin)result=p.parseNNLibraryPlan(page,pages);
  if(u.origin===sources['chel-library'].origin&&/^\/ru\/events\/\d+\/$/.test(path))result=one(p.parseChelLibrary(page,pages));
  rows.push(...p.validateRows(result,now));
 }catch(e){queue.push({url:page.url,reason:e instanceof Error?e.message:'PARSER_REVIEW'});}
 return {rows,queue};
}
// Стабильный source ID объединяет сеансы; цена разных сеансов не становится общей.
export function groupRows(rows:p.Row[]){const grouped=new Map<string,p.Row>(),venues=new Map<string,Venue>();
 for(const input of rows){const row=structuredClone(input),e=row.event;if(sourceReviews.some(r=>r.eventId===e.id&&r.status==='QUARANTINED'))continue;
  if(e.cancelled===true)e.occurrences.forEach(o=>o.cancelled=true);e.cancelled=null;venues.set(row.venue.id,row.venue);
  const old=grouped.get(e.id);if(!old){grouped.set(e.id,row);continue;}
  if(old.event.city!==e.city||old.event.provider!==e.provider||old.event.title!==e.title)throw Error('GROUP_IDENTITY_CONFLICT:'+e.id);
  old.event.occurrences=[...new Map([...old.event.occurrences,...e.occurrences].map(o=>[o.id,o])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  if(JSON.stringify(old.event.price)!==JSON.stringify(e.price))old.event.price={...p.unknownPrice(),kind:'CONFLICT',conditions:['Тариф зависит от сеанса; общий итог не установлен.']};
  old.event.retrievedAt=[old.event.retrievedAt,e.retrievedAt].filter((v):v is string=>!!v).sort()[0]!;
  old.event.observations=[...new Map([...old.event.observations,...e.observations].map(o=>[JSON.stringify(o),o])).values()];
  old.event.admission.conditions=[...new Set([...old.event.admission.conditions,...e.admission.conditions])];
  old.event.issues=[...new Set([...old.event.issues,...e.issues])];
 }
 return {rows:[...grouped.values()],venues:[...venues.values()]};
}
const current=(e:Snapshot['events'][number],now:string)=>e.occurrences.some(o=>o.kind==='TIMED_SESSION'?!!o.start&&Date.parse(o.start)>=Date.parse(now):!o.activeThrough||o.activeThrough>=cityDate(now,cities[e.city as CityKey].timezone));
export function reparseMulti(client:InstitutionClient,now:string,previous:Snapshot[]=[]):CandidateFile {
 const pages=campaignPages(client),parsed=parseMultiPages(pages,now),prepared=preparedSchema.parse(JSON.parse(readFileSync('catalog/real/prepared-facts.json','utf8')));
 atomicJson(resolve(client.root,'multi-parsed-rows.json'),parsed);
 const legacy=reparse(client,prepared,now,72,previous,60),legacyRows=legacy.snapshots.flatMap(s=>s.events.map(event=>({event,venue:s.venues.find(v=>v.id===event.occurrences[0]?.venueId)!})));
 const grouped=groupRows([...legacyRows,...parsed.rows]),rows=grouped.rows,queue=[...legacy.reviewQueue,...parsed.queue];
 const retained:string[]=[];
 // Частичный сбор не является свидетельством массового удаления. Старые факты
 // сохраняют исходные наблюдения и fetchedAt; 72-часовой допуск не продлевается.
 for(const s of previous)for(const event of s.events)if(!rows.some(r=>r.event.id===event.id)&&current(event,now)&&!sourceReviews.some(r=>r.eventId===event.id&&r.status==='QUARANTINED')){
  const venue=s.venues.find(v=>v.id===event.occurrences[0]?.venueId);if(!venue)continue;rows.push({event:structuredClone(event),venue:structuredClone(venue)});grouped.venues.push(...s.venues.filter(v=>event.occurrences.some(o=>o.venueId===v.id)));retained.push(event.id);
 }
 const snapshots=Object.keys(sources).flatMap(source=>{const selected=rows.filter(r=>r.event.provider===source);return makeSnapshots(selected,now,72,60,grouped.venues.filter(v=>selected.some(r=>r.event.occurrences.some(o=>o.venueId===v.id))));});
 const sourceStatus=Object.fromEntries(Object.keys(sources).map(id=>[id,snapshots.some(s=>s.events.some(e=>e.provider===id))?'PARSED_CACHED_SCOPE':id==='kamal'?'EXCLUDED_TERMS_11_2':'NO_ELIGIBLE_RECORDS']));
 const old=previous.flatMap(s=>s.events),next=snapshots.flatMap(s=>s.events);
 const changes:NonNullable<CandidateFile['changes']>={added:next.filter(e=>!old.some(o=>o.id===e.id)).map(e=>e.id),removed:old.filter(e=>!next.some(n=>n.id===e.id)).map(e=>({id:e.id,reason:current(e,now)?'QUARANTINED':'ELAPSED_OR_OUTSIDE_SCOPE'})),changed:next.filter(e=>old.some(o=>o.id===e.id&&JSON.stringify(o)!==JSON.stringify(e))).map(e=>({id:e.id,fields:['source-facts']})),removedOccurrences:[]};
 for(const s of snapshots)for(const e of s.events)normalizedEventSchema.parse(e);for(const v of grouped.venues)venueSchema.parse(v);
 atomicJson(resolve(client.root,'parse-outcomes.json'),{builtAt:now,sourceRecords:parsed.rows.length+legacyRows.length,retainedWithoutRevalidation:retained,queue,perSource:Object.fromEntries(Object.keys(sources).map(id=>[id,{sourceRecords:[...legacyRows,...parsed.rows].filter(r=>r.event.provider===id).length,uniqueEvents:next.filter(e=>e.provider===id).length}]))});
 return {version:1,builtAt:now,snapshots,sourceStatus,reviewQueue:queue,changes};
}
