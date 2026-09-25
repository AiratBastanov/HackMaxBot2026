import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { InstitutionClient, atomicJson } from './institution-http.js';
import { extract, extractKremlinNews, discover, document, tag, attr, domText, makeSnapshots, type Page } from './institutions.js';
import { sourceReviews } from './reviews.js';
import { factualScope, snapshotDigest, sources, reviewSchema, reviewedSnapshot, type Institution } from './source-policy.js';
import { validateSnapshot, normalizedEventSchema, venueSchema, type Snapshot } from './contract.js';
import { cityDate } from './cities.js';

export const preparedSchema=z.object({version:z.literal(1),kind:z.literal('PREPARED_REAL'),venues:z.array(z.object({sourceUrl:z.string().url(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),observedAt:z.string().datetime(),title:z.string(),address:z.string(),note:z.string()}).strict())}).strict();
export type Prepared=z.infer<typeof preparedSchema>;
export type CandidateFile={version:1;builtAt:string;snapshots:Snapshot[];reviewQueue:{url:string;reason:string}[];sourceStatus:Record<string,string>};
const starts:Record<Institution,string[]>={
  'kazan-kremlin':['https://kazan-kremlin.ru/','https://kazan-kremlin.ru/exhibitions','https://kazan-kremlin.ru/events','https://kazan-kremlin.ru/museums/vystavochnye-zaly-prisutstvennyh-mest','https://kazan-kremlin.ru/museums/muzej-istorii-blagoveshhenskogo-sobora'],
  mie:['https://m-i-e.ru/','https://m-i-e.ru/exhibitions','https://m-i-e.ru/mie-filial'],
};
export async function collectInstitutions(client:InstitutionClient) {
  const sourceStatus:Record<string,string>={};
  for(const source of Object.keys(sources) as Institution[]) {
    try {
      await client.get(sources[source].origin+'/robots.txt');
      const listing:Page[]=[];for(const url of starts[source])listing.push(await client.get(url));
      const urls=[...new Set(listing.flatMap(p=>discover(p,source)))].slice(0,24);
      // Датированные новости из обычной навигации, не внутренние endpoints сайта.
      if(source==='kazan-kremlin')for(const n of document(listing[0]!).filter(n=>tag(n)==='a')) {
        const href=attr(n,'href');if(/^\/news\/meropriyatiya-kazanskogo-kremlya-/.test(href)){urls.push(new URL(href,sources[source].origin).href);break;}
      }
      let failures=0;for(const url of urls)try{await client.get(url);}catch(e){failures++;if(/BUDGET|STOPPED|HTTP_40[13]|HTTP_429/.test(String(e)))break;}
      sourceStatus[source]=failures?'PARTIAL':'FETCHED_SELECTED_SCOPE';
    }catch(e){sourceStatus[source]=e instanceof Error?e.message:'FAILED';}
  }
  return sourceStatus;
}
export function reparse(client:InstitutionClient,prepared:Prepared,now:string,freshnessHours=72,previous:Snapshot[]=[]):CandidateFile {
  if(!Number.isInteger(freshnessHours)||freshnessHours<1||freshnessHours>168)throw Error('FRESHNESS_RANGE');
  const pages=[...new Set(client.ledger.requests.map(r=>r.url))].flatMap(url=>{const p=client.cached(url);return p?[p]:[];});
  const discoveredBySource=Object.fromEntries((Object.keys(sources) as Institution[]).map(source=>[source,new Set(pages.filter(v=>new URL(v.url).origin===sources[source].origin).flatMap(v=>discover(v,source)))])) as Record<Institution,Set<string>>;
  const queue:CandidateFile['reviewQueue']=[],records:ReturnType<typeof extract>[]=[];
  for(const p of pages) {
    const source=Object.keys(sources).find(k=>sources[k as Institution].origin===new URL(p.url).origin) as Institution|undefined;if(!source)continue;
    const discovered=discoveredBySource[source];
    const news=source==='kazan-kremlin'&&new URL(p.url).pathname.startsWith('/news/meropriyatiya-kazanskogo-kremlya-');
    if(!discovered.has(p.url)&&!news)continue;
    try {
      const rows=news?extractKremlinNews(p,now).slice(0,12):[extract(p,source,cityDate(now,source==='mie'?'Asia/Yekaterinburg':'Europe/Moscow'),pages.find(v=>v.url==='https://m-i-e.ru/mie-filial'))];
      for(const row of rows) {
        if(sourceReviews.some(r=>r.eventId===row.event.id)){queue.push({url:p.url,reason:'QUARANTINED: '+sourceReviews.find(r=>r.eventId===row.event.id)!.reason});continue;}
        for(const supplement of prepared.venues) {
          const venuePage=pages.find(v=>v.url===supplement.sourceUrl);
          if(!venuePage||venuePage.hash!==supplement.contentHash)continue;
          const links=document(venuePage).filter(n=>tag(n)==='a').map(n=>{try{return new URL(attr(n,'href'),venuePage.url).href;}catch{return '';}});
          if(row.venue.sourceUrl!==supplement.sourceUrl&&row.venue.title!==supplement.title&&!links.includes(row.event.sourceUrl))continue;
          const h1=document(venuePage).find(n=>tag(n)==='h1');if(!h1||domText(h1).trim()!==supplement.title)throw Error('PREPARED_VENUE_IDENTITY');
          row.venue.title=supplement.title;row.venue.address=supplement.address;row.venue.sourceUrl=supplement.sourceUrl;row.venue.physical=true;
          row.venue.id='kazan-kremlin:venue:'+new URL(supplement.sourceUrl).pathname.split('/').at(-1);
          row.event.occurrences.forEach(o=>o.venueId=row.venue.id);
          row.venue.observations.push({retrievedAt:supplement.observedAt,requestUrl:supplement.sourceUrl,fields:['address','title','location'],conflicts:[],provenance:{extractor:'reviewed-campus-location/1',contentHash:supplement.contentHash,method:'PREPARED_REAL'}});
          row.event.issues.push(supplement.note);
        }
        const old=previous.flatMap(s=>s.events).find(e=>e.id===row.event.id);
        if(old&&(old.title!==row.event.title||old.sourceUrl!==row.event.sourceUrl||old.city!==row.event.city)){queue.push({url:p.url,reason:'IDENTITY_CHANGED_REQUIRES_REVIEW'});continue;}
        normalizedEventSchema.parse(row.event);venueSchema.parse(row.venue);records.push(row);
      }
    }catch(e){queue.push({url:p.url,reason:e instanceof Error?e.message:'PARSER_REVIEW'});}
  }
  // События не размножаются по дням. Новые ошибки не стирают активный файл.
  const unique=[...new Map(records.map(r=>[r.event.id,r])).values()];
  const snapshots=makeSnapshots(unique,now,freshnessHours);
  const sourceStatus=Object.fromEntries(Object.entries(sources).map(([id,s])=>[id,client.ledger.requests.some(r=>r.url.startsWith(s.origin)&&r.outcome!=='OK'&&!['REDIRECT','308'].includes(r.outcome))?'PARTIAL':'PARSED_CACHED_SCOPE']));
  return {version:1,builtAt:now,snapshots,reviewQueue:queue,sourceStatus};
}
export function activate(candidate:CandidateFile,expectedHash:string,destination:string,now=Date.now()) {
  if(snapshotDigest(candidate)!==expectedHash)throw Error('REVIEW_HASH_MISMATCH');
  const snapshots=candidate.snapshots.map(validateSnapshot);if(!snapshots.length||snapshots.some(s=>!s.events.length))throw Error('EMPTY_CATALOG');
  const review=reviewSchema.parse({version:1,scope:'ADMITTED_TESTERS_FACTS',factualScope,reviewedAt:new Date(now).toISOString(),entries:snapshots.map(s=>({snapshotHash:snapshotDigest(s),sources:[...new Set(s.events.map(e=>e.provider))],basis:'institution-facts/1',validUntil:new Date(Date.parse(s.retrievedAt)+s.freshnessHours*3600000).toISOString()}))});
  if(snapshots.some(s=>!reviewedSnapshot(s,review,now)))throw Error('SNAPSHOT_NOT_REVIEWABLE_OR_STALE');
  const root=resolve(destination);mkdirSync(root,{recursive:true});
  const pointer=resolve(root,'active.json');
  if(existsSync(pointer)) {
    const active=JSON.parse(readFileSync(pointer,'utf8'));
    if(!/^[a-f0-9]{20}\.json$/.test(active.snapshot))throw Error('ACTIVE_POINTER');
    const previous=JSON.parse(readFileSync(resolve(root,active.snapshot),'utf8')).snapshots.map(validateSnapshot) as Snapshot[];
    for(const s of previous) {
      const next=snapshots.find(n=>n.scope.city===s.scope.city);
      const failed=Object.entries(sources).some(([id,source])=>source.city===s.scope.city&&!['PARSED_CACHED_SCOPE','FETCHED_SELECTED_SCOPE'].includes(candidate.sourceStatus[id]??''));
      if(!next||failed&&next.events.length<s.events.length)throw Error('FAILED_REFRESH_CANNOT_REPLACE_USEFUL_CATALOG');
    }
  }
  const name=expectedHash.slice(0,20),snapshotPath=resolve(root,name+'.json'),reviewPath=resolve(root,name+'.review.json');
  if(!existsSync(snapshotPath))writeFileSync(snapshotPath,JSON.stringify({snapshots},null,2)+'\n',{flag:'wx'});
  if(!existsSync(reviewPath))writeFileSync(reviewPath,JSON.stringify(review,null,2)+'\n',{flag:'wx'});
  // Один атомарный указатель; оба файла уже готовы. Процесс перечитывает при следующем запуске.
  atomicJson(pointer,{version:1,snapshot:name+'.json',review:name+'.review.json'});
  return {snapshotPath,reviewPath};
}
export function privateCampaign(path:string) {
  const p=resolve(path);if(!['.cache/real-catalog','.review/real-catalog'].some(r=>p.startsWith(resolve(r)+sep)||p===resolve(r)))throw Error('PRIVATE_CAMPAIGN_PATH_REQUIRED');return p;
}
