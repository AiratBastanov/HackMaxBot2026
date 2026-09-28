import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {Catalog} from '../src/culture/catalog.js';
import {cities,cityDate,type CityKey} from '../src/data/cities.js';
import {select} from '../src/data/select.js';
import {type SearchQuery} from '../src/data/temporal.js';
import {type Snapshot} from '../src/data/contract.js';
import {flowDriver} from './flow-driver.js';
import {getState} from '../src/culture/flow.js';
import {ACTOR} from '../tests/fixtures.js';
import {validateOperation} from '../src/max.js';
import {activate,type CandidateFile} from '../src/data/real-refresh.js';
import {snapshotDigest} from '../src/data/source-policy.js';

const [pointer='catalog/real/active.json',destination='.review/multi-city/verification',mode='full']=process.argv.slice(2),root=resolve(destination);mkdirSync(root,{recursive:true});
const began=performance.now(),catalog=Catalog.load({flowDataMode:'real',admissionMode:'PUBLIC',snapshotPath:resolve(pointer)} as any),startupMs=performance.now()-began;
const now=Date.now(),at=new Date(now),ready=catalog.usableCities(now);assert(ready.length>=8);
const query=(city:CityKey,budgetRub:number|null=null,party={adults:1,childAges:[] as number[]}):SearchQuery=>({version:2,city,timezone:cities[city].timezone,date:{mode:'ANY'},time:{mode:'ANY'},party,budgetBasis:'PARTY_TOTAL',budgetRub,category:null,zone:null,kind:'ANY',preferences:{categories:[]}});
const matrix=JSON.parse(readFileSync('docs/evidence/multi-city/query-matrix.json','utf8'));
const byCity:Record<string,unknown>={},queryResults:object[]=[],frames:{city:string;step:string;text:string;buttons:string[]}[]=[],journeys:object[]=[];
let worstMs=0,worstQuery='',eligible=0;const watchdogMs=10_000;
const oneEvent=(s:Snapshot,index:number)=>{const event=s.events[index]!,venues=s.venues.filter(v=>event.occurrences.some(o=>o.venueId===v.id));return {...s,events:[event],venues,stats:{...s.stats,normalizedEvents:1,occurrences:event.occurrences.length,venues:venues.length}};};
for(const city of ready){const s=catalog.selectionForCity(city,now)!;
 const timings:{query:string;ms:number}[]=[],cityQueries:any[]=[];
 for(const entry of matrix.queries){const base={...query(city,entry.budgetRub,{adults:entry.adults,childAges:entry.childAges}),time:entry.time==='ANY'?{mode:'ANY' as const}:{mode:'SPECIFIC' as const,from:entry.time[0],until:entry.time[1]}};
  const dates=Array.isArray(entry.date)?entry.date:[entry.date],variants=dates.map((date:string)=>({...base,date:date==='ANY'?{mode:'ANY' as const}:{mode:'SPECIFIC' as const,date}}));
  const start=performance.now(),results=variants.map((q:SearchQuery)=>select(s,q,at,false,true)),elapsedMs=performance.now()-start;assert(elapsedMs<watchdogMs,'QUERY_WATCHDOG');
  if(elapsedMs>worstMs){worstMs=elapsedMs;worstQuery=city+'/'+entry.id;}timings.push({query:entry.id,ms:elapsedMs});
  let strict=results[0]!.strictTotal,uncertain=results[0]!.uncertainTotal;
  if(variants.length>1){strict=0;uncertain=0;for(let i=0;i<s.events.length;i++){const individual=variants.map((q:SearchQuery)=>select(oneEvent(s,i),q,at,false,true));if(individual.some((r:any)=>r.strictTotal))strict++;else if(individual.some((r:any)=>r.uncertainTotal))uncertain++;}}
  const record={city,id:entry.id,strict,uncertain,elapsedMs,samples:results.flatMap((r:any)=>[...r.recommendations.map((v:any)=>({kind:'STRICT',id:v.eventId,title:v.title,from:v.from,source:v.source.url})),...r.uncertain.map((v:any)=>({kind:'UNCERTAIN',id:v.eventId,title:v.title,source:v.source.url,reasons:v.reasons}))]).slice(0,6)};queryResults.push(record);cityQueries.push(record);
 }
 const any=cityQueries.find(r=>r.id==='any');eligible+=any.strict+any.uncertain;
 const start=cityDate(s.scope.start,s.scope.timezone),middle=new Date(Date.parse(start+'T00:00Z')+30*86400000).toISOString().slice(0,10),end=cityDate(s.scope.end,s.scope.timezone);
 const overlaps=(e:Snapshot['events'][number],from:string,through:string)=>e.occurrences.some(o=>o.kind==='TIMED_SESSION'?!!o.start&&cityDate(o.start,o.timezone)>=from&&cityDate(o.start,o.timezone)<through:(!o.activeFrom||o.activeFrom<through)&&(!o.activeThrough||o.activeThrough>=from));
 byCity[city]={name:cities[city].name,events:s.events.length,occurrences:s.stats.occurrences,sources:new Set(s.events.map(e=>e.provider)).size,strictAny:any.strict,uncertainAny:any.uncertain,displayEligible:any.strict+any.uncertain,
 first30:s.events.filter(e=>overlaps(e,start,middle)).length,second30:s.events.filter(e=>overlaps(e,middle,end)).length,
 quality:{usableDate:s.events.filter(e=>e.occurrences.some(o=>o.start||o.activeFrom||o.startless)).length,durationOrHours:s.events.filter(e=>e.occurrences.some(o=>o.durationMinutes||o.end||o.opening?.length)).length,individualPrice:s.events.filter(e=>['FREE','EXACT','FROM','RANGE'].includes(e.price.kind)&&e.price.applicability==='SINGLE_ADULT').length,childPrice:s.events.filter(e=>e.tariffs?.some(t=>t.audience==='CHILD'&&t.applicable&&['FREE','EXACT'].includes(t.kind))).length,verifiedAddress:s.events.filter(e=>e.occurrences.some(o=>s.venues.some(v=>v.id===o.venueId&&v.address&&v.physical===true))).length},timings};
 if(mode==='matrix')continue;
 const run=mkdtempSync(resolve(root,city+'-')),d=await flowDriver(resolve(run,'disposable.sqlite'),{snapshots:catalog.snapshots},now,true,catalog.review,true),capture=(step:string)=>frames.push({city:cities[city].name,step,text:d.screen()!.body.text,buttons:d.buttons().map(b=>b.text)});
 try{
  await d.enter();await d.click('Подобрать');await d.say(cities[city].name);assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).draft.city,city);
  for(const label of ['Любая дата','Любое время','Продолжить','Без лимита','Любая тема','Показать результаты'])await d.click(label);
  let detail=d.buttons().find(b=>/^Подробнее \d/.test(b.text));if(!detail){const opt=d.buttons().find(b=>/уточн|непровер|вариант/i.test(b.text));assert(opt,'CANDIDATE_OPT_IN_MISSING');await d.click(opt.text);detail=d.buttons().find(b=>/^Подробнее \d/.test(b.text));}
  assert(detail,'NO_RENDERED_EVENT:'+city);await d.click(detail.text);capture('Карточка');
  const selected=JSON.parse(getState(d.runtime.store,ACTOR)!.data),card=selected.cards.find((c:any)=>c.identity===selected.selected);assert(card?.displayRef&&catalog.permits([card.displayRef],d.now,true));
  await d.click('Условия посещения');capture('Условия и источник');assert(d.buttons().some(b=>b.type==='link'||/источник/i.test(b.text))||d.screen()!.body.text.includes('Источник'));
  await d.click('К карточке');await d.click('Сохранить');const saved=d.runtime.store.db.prepare('SELECT identity,data FROM bookmarks').all();assert.equal(saved.length,1);
  await d.restart();await d.say('/saved');await d.click('Открыть 1');capture('Закладка после перезапуска');assert.deepEqual(d.runtime.store.db.prepare('SELECT identity,data FROM bookmarks').all(),saved);
  // Замена reviewed snapshot: меняется диагностическая issue, факты и закладка остаются.
  const replacement:CandidateFile={version:1,builtAt:new Date(d.now).toISOString(),snapshots:structuredClone([...catalog.snapshots]),reviewQueue:[],sourceStatus:Object.fromEntries(catalog.snapshots.flatMap(s=>s.events.map(e=>[e.provider,'PARSED_CACHED_SCOPE'])))};
  replacement.snapshots[0]!.issues.push('Локальная проверка атомарной замены; факты источника сохранены.');
  activate(replacement,snapshotDigest(replacement),resolve(run,'replacement'),d.now,true);await d.reloadCatalog(resolve(run,'replacement/active.json'));await d.say('/saved');await d.click('Открыть 1');capture('Закладка после reviewed замены');assert.deepEqual(d.runtime.store.db.prepare('SELECT identity,data FROM bookmarks').all(),saved);
  for(const operation of d.attempts)validateOperation(operation);journeys.push({city,result:'PASS',eventId:card.eventId,kind:card.kind,source:card.source.url,publicAdmission:true,simulatedMAX:true,sqliteRestart:true,reviewedReplacement:true});
 }finally{await d.close();}
}
const events=catalog.snapshots.flatMap(s=>s.events),occurrences=events.flatMap(e=>e.occurrences),counts={events:events.length,occurrences:occurrences.length,timedSessions:occurrences.filter(o=>o.kind==='TIMED_SESSION').length,exhibitionPeriods:occurrences.filter(o=>o.kind==='FLEXIBLE_VISIT').length,venues:new Set(catalog.snapshots.flatMap(s=>s.venues.map(v=>v.id))).size,sources:new Set(events.map(e=>e.provider)).size,domains:new Set(events.map(e=>new URL(e.sourceUrl).hostname)).size,cities:ready.length,displayEligible:eligible};
const report={version:1,result:'PASS',at:at.toISOString(),humanMAX:'NOT_RUN / DEFERRED_BY_USER',baseline:JSON.parse(readFileSync('docs/evidence/multi-city/baseline.json','utf8')),counts,byCity,queryResults,journeys,benchmark:{watchdogMs,startupMs,worstQuery,worstMs,rssBytes:process.memoryUsage().rss,maxRssBytes:process.resourceUsage().maxRSS*1024,events:events.length,occurrences:occurrences.length},snapshotHashes:catalog.snapshots.map(snapshotDigest),limitations:['Сеансы и программы считаются раздельно.','Первый и второй 30-дневные интервалы могут содержать одну и ту же выставку.','Статусы и цены — наблюдения страниц, не подтверждение свободных мест.','Локальный симулятор не является наблюдением MAX mobile/web.']};
writeFileSync(resolve(root,'coverage.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(resolve(root,'journeys.md'),'# Мультигородской каталог: локальные экраны\n\nSQLite и реальные application/worker/outbox; MAX симулирован, disposable identities.\n'+frames.map(f=>'\n## '+f.city+' · '+f.step+'\n\n```text\n'+f.text+'\n```\n\nКнопки: '+f.buttons.join(' · ')+'\n').join(''));
console.log(JSON.stringify({result:'PASS',counts,journeys:journeys.length,benchmark:report.benchmark}));
