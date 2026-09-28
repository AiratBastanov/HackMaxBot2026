import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Catalog } from './culture/catalog.js';
import type { Config } from './config.js';
import { type Snapshot, validateSnapshot } from './data/contract.js';
import { reviewSchema, reviewedSnapshotIntegrity, snapshotDigest, type Review, type Institution } from './data/source-policy.js';
import { atomicJson } from './data/institution-http.js';
import { cities } from './data/cities.js';
import { select } from './data/select.js';
import { CampaignClient } from './data/campaign.js';
import { sourceEntries } from './data/multi-frontier.js';
import { reparseMulti } from './data/multi-refresh.js';
import { activate } from './data/real-refresh.js';

type Pointer={version:1;snapshot:string;review:string};
export type ReviewedCatalog={snapshots:Snapshot[];review:Review;pointer:Pointer;files:{snapshot:Buffer;review:Buffer}};
const json=(value:unknown)=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export const preparationError='Каталог не подготовлен. Проверьте доступ контейнера к сайтам источников и повторите команду запуска; диагностика: docs/CATALOG_OPERATIONS.md.';

// Строгое чтение: в отличие от безопасного пустого результата Catalog.load,
// подготовка различает испорченный комплект и просто истёкшие наблюдения.
export function readReviewedCatalog(root:string):ReviewedCatalog {
  const read=(name:string,limit:number)=>{const path=resolve(root,name);if(statSync(path).size>limit)throw Error('CATALOG_SIZE');return readFileSync(path);};
  const pointer=JSON.parse(read('active.json',4096).toString()) as Pointer;
  if(pointer.version!==1||!/^[a-f0-9]{20}\.json$/.test(pointer.snapshot)||pointer.review!==pointer.snapshot.replace('.json','.review.json'))throw Error('CATALOG_POINTER');
  const files={snapshot:read(pointer.snapshot,16*1024*1024),review:read(pointer.review,65536)};
  const review=reviewSchema.parse(JSON.parse(files.review.toString()));
  const catalog=new Catalog('real',JSON.parse(files.snapshot.toString()),review,true),snapshots=[...catalog.snapshots];
  if(!snapshots.length||snapshots.some(s=>!reviewedSnapshotIntegrity(s,review,true)))throw Error('CATALOG_REVIEW_INTEGRITY');
  return {pointer,files,snapshots,review};
}
export function hasUsableEvents(data:Pick<ReviewedCatalog,'snapshots'|'review'>,now:number) {
  const catalog=new Catalog('real',{snapshots:data.snapshots},data.review,true);
  return catalog.usableCities(now).some(city=>{
    const result=select(catalog.selectionForCity(city,now),{version:2,city,timezone:cities[city].timezone,date:{mode:'ANY'},time:{mode:'ANY'},party:{adults:1,childAges:[]},budgetBasis:'PARTY_TOTAL',budgetRub:null,category:null,zone:null,kind:'ANY',preferences:{categories:[]}},new Date(now),false,true);
    return result.strictTotal+result.uncertainTotal>0;
  });
}
type Part={snapshot:Snapshot;entry:Review['entries'][number];reviewedAt:string};
// Старые комплекты имели shard на город. Разделяем только границы источников,
// наследуя исходные сроки review и каждое наблюдение без изменения дат.
function parts(data:ReviewedCatalog):Map<string,Part> {
  const result=new Map<string,Part>();
  for(const s of data.snapshots){const original=data.review.entries.find(e=>e.snapshotHash===snapshotDigest(s))!;
    const ids=[...new Set(s.events.map(e=>e.provider))];
    for(const id of ids){const events=s.events.filter(e=>e.provider===id),venues=s.venues.filter(v=>events.some(e=>e.occurrences.some(o=>o.venueId===v.id)));
      const snapshot=ids.length===1?s:validateSnapshot({...s,events,venues,stats:{...s.stats,normalizedEvents:events.length,occurrences:events.reduce((n,e)=>n+e.occurrences.length,0),venues:venues.length}});
      result.set(id,{snapshot,entry:{...original,snapshotHash:snapshotDigest(snapshot),sources:[id as Institution],publicPolicyHashes:{[id]:original.publicPolicyHashes![id]!}},reviewedAt:data.review.reviewedAt});
    }
  }return result;
}
function observationTime(v:Snapshot['events'][number]|Snapshot['venues'][number]) {return Math.min(...v.observations.map(o=>Date.parse(o.retrievedAt!)));}
function newer(next:Snapshot,old:Snapshot) {
  // Ни одна сопоставленная запись/площадка не получает более старые факты.
  if([...next.events,...next.venues].some(v=>{const prior=[...old.events,...old.venues].find(p=>p.id===v.id);return prior&&observationTime(v)<observationTime(prior);}))return false;
  const times=(s:Snapshot)=>[Date.parse(s.retrievedAt),...[...s.events,...s.venues].flatMap(v=>v.observations.map(o=>Date.parse(o.retrievedAt!)))];
  const a=times(next),b=times(old);
  return Math.min(...a)>=Math.min(...b)&&(Math.max(...a)>Math.max(...b)||Math.min(...a)>Math.min(...b)||next.events.length>old.events.length&&Math.max(...a)>=Math.max(...b));
}
export function reconcileCatalogs(runtime:ReviewedCatalog|null,bundle:ReviewedCatalog|null):ReviewedCatalog|null {
  if(!runtime)return bundle;if(!bundle)return runtime;
  // Более поздний операторский каталог сохраняем целиком: отсутствие источника
  // в нём не даёт старому образу права вернуть ранее удалённые сведения.
  const latest=(data:ReviewedCatalog)=>Math.max(...data.snapshots.flatMap(s=>[Date.parse(s.retrievedAt),...[...s.events,...s.venues].flatMap(v=>v.observations.map(o=>Date.parse(o.retrievedAt!)))]));
  if(latest(runtime)>latest(bundle))return runtime;
  const chosen=parts(runtime),incoming=parts(bundle);let changed=false;
  for(const [source,part]of incoming){const old=chosen.get(source);if(!old||newer(part.snapshot,old.snapshot)){chosen.set(source,part);changed=true;}}
  if(!changed)return runtime;
  // Обычная установка/upgrade сохраняет точную опубликованную версию комплекта.
  if(chosen.size===incoming.size&&[...chosen].every(([id,p])=>snapshotDigest(p.snapshot)===snapshotDigest(incoming.get(id)!.snapshot)))return bundle;
  const snapshots=[...chosen.values()].map(p=>p.snapshot),review=reviewSchema.parse({...runtime.review,reviewedAt:[...chosen.values()].map(p=>p.reviewedAt).sort().at(-1),entries:[...chosen.values()].map(p=>p.entry)});
  const name=snapshotDigest({snapshots,review}).slice(0,20),pointer:Pointer={version:1,snapshot:name+'.json',review:name+'.review.json'};
  return {snapshots,review,pointer,files:{snapshot:json({snapshots}),review:json(review)}};
}
export function installReviewed(data:ReviewedCatalog,destination:string,now:number) {
  if(!hasUsableEvents(data,now))throw Error('CATALOG_NO_USABLE_EVENTS');
  mkdirSync(destination,{recursive:true});
  // Файлы версий неизменяемы; коллизия не может подменить действующий указатель.
  for(const key of ['snapshot','review'] as const){const path=resolve(destination,data.pointer[key]);if(existsSync(path)){if(!readFileSync(path).equals(data.files[key]))throw Error('CATALOG_VERSION_COLLISION');}else{writeFileSync(path+'.tmp',data.files[key]);renameSync(path+'.tmp',path);}}
  const staged=new Catalog('real',JSON.parse(readFileSync(resolve(destination,data.pointer.snapshot),'utf8')),JSON.parse(readFileSync(resolve(destination,data.pointer.review),'utf8')),true);
  if(staged.snapshots.some(s=>!reviewedSnapshotIntegrity(s,staged.review,true))||!hasUsableEvents({snapshots:[...staged.snapshots],review:staged.review!},now))throw Error('CATALOG_INSTALL_VALIDATION');
  atomicJson(resolve(destination,'active.json'),data.pointer);
}

export const bootstrapLimits={wallMs:120_000,requests:24,cacheAgeMs:72*3600000};
// Афиши с самостоятельными датированными списками + страницы условий/площадок.
// Только уже проверенные адаптеры; никаких новых сайтов или широкого обхода.
export async function refreshBootstrap(cacheRoot:string,now:number,report:(message:string)=>void):Promise<ReviewedCatalog|null> {
  const client=new CampaignClient(cacheRoot,bootstrapLimits);
  try{
    for(const source of ['bashopera','samara-opera','spb-opera'] as const){
      report('Обновление афиши: '+source);
      for(const url of sourceEntries(source))try{await client.get(url);}catch(e){if((e as Error).message==='ACQUISITION_BOUNDARY')break;}
      const checkedAt=Date.now(),candidate=reparseMulti(client,new Date(checkedAt).toISOString());
      // activate — существующая автоматическая проверка schema/hash/source policy.
      // Отдельный staging не меняет runtime, пока объединение не проверено целиком.
      if(candidate.snapshots.length)try{
        const hash=snapshotDigest(candidate),stage=resolve(cacheRoot,'reviewed',hash.slice(0,20));
        activate(candidate,hash,stage,checkedAt,true);const result=readReviewedCatalog(stage);
        if(hasUsableEvents(result,checkedAt))return result;
      }catch{/* Другой независимый источник может дать пригодные сведения. */}
    }return null;
  }finally{client.close();}
}
export type PrepareOptions={bundled:string;destination:string;cacheRoot:string;now?:number;mode?:'real'|'synthetic-test';report?:(message:string)=>void;
  refresh?:(root:string,now:number,report:(message:string)=>void)=>Promise<ReviewedCatalog|null>};
export async function prepareCatalog(options:PrepareOptions) {
  if(options.mode==='synthetic-test')return {action:'synthetic',version:null};
  let now=options.now??Date.now();const report=options.report??(()=>{});
  const read=(root:string)=>{try{return readReviewedCatalog(root);}catch{return null;}};
  const runtime=read(options.destination),bundle=read(options.bundled);
  let selected=reconcileCatalogs(runtime,bundle),refreshed=false;
  if(!selected||!hasUsableEvents(selected,now)){
    report('Подготовка свежей афиши (не более 2 минут сетевой работы).');
    let fresh:ReviewedCatalog|null=null;
    try{fresh=await (options.refresh??refreshBootstrap)(options.cacheRoot,now,report);}catch{/* Единая ошибка ниже, без сырых ответов источников. */}
    now=options.now??Date.now();
    selected=reconcileCatalogs(selected,fresh);refreshed=Boolean(fresh);
  }
  if((!selected||!hasUsableEvents(selected,now))&&runtime&&hasUsableEvents(runtime,now))selected=runtime;
  if(!selected||!hasUsableEvents(selected,now))throw Error(preparationError);
  const unchanged=runtime&&JSON.stringify(runtime.pointer)===JSON.stringify(selected.pointer);
  if(!unchanged)try{installReviewed(selected,options.destination,now);}catch(e){if(runtime&&hasUsableEvents(runtime,now)){selected=runtime;}else throw Error(preparationError);}
  const catalog=new Catalog('real',{snapshots:selected.snapshots},selected.review,true);
  return {action:selected===runtime?'retained':refreshed?'refreshed':'installed',version:selected.pointer.snapshot.slice(0,20),cities:catalog.usableCities(now),events:catalog.usableCities(now).reduce((n,c)=>n+catalog.selectionForCity(c,now)!.events.length,0)};
}
// Ни один MAX-потребитель не стартует с пустым/просроченным real-каталогом,
// в том числе при ручном запуске в обход Compose. Здесь никогда нет сети/записи.
export function requirePreparedCatalog(config:Config,now=Date.now()) {
  if(config.flowDataMode!=='real')return;
  const catalog=Catalog.load(config);
  if(!catalog.review||!hasUsableEvents({snapshots:[...catalog.snapshots],review:catalog.review},now))throw Error(preparationError);
}
