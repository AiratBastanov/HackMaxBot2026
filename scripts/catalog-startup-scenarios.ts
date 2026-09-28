// Изолированные интеграционные сценарии. Снимок комплекта не переписывается.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareCatalog,readReviewedCatalog,installReviewed,hasUsableEvents,preparationError} from '../src/catalog-prepare.js';
import {activate,type CandidateFile} from '../src/data/real-refresh.js';
import {snapshotDigest} from '../src/data/source-policy.js';
import {atomicJson} from '../src/data/institution-http.js';
import {Catalog} from '../src/culture/catalog.js';
import {flowDriver} from './flow-driver.js';
import type {Snapshot} from '../src/data/contract.js';

export async function catalogStartupScenarios(base:string){
  mkdirSync(base,{recursive:true});const root=mkdtempSync(resolve(base,'startup-'));
  const bundle=readReviewedCatalog(resolve('catalog/real')),now=Date.parse(bundle.review.reviewedAt)+60000;
  const runtime=resolve(root,'catalog'),reports:object[]=[];let fetches=0;
  const failFetch=async()=>{fetches++;throw Error('SIMULATED_PROVIDER_FAILURE');};
  const options={bundled:resolve('catalog/real'),destination:runtime,cacheRoot:resolve(root,'cache'),now,refresh:failFetch};
  const version=()=>readReviewedCatalog(runtime).pointer.snapshot;
  const record=(id:string,detail:object={})=>reports.push({id,result:'PASS',...detail});
  const put=(snapshots:Snapshot[],path:string,at=now)=>{
    const candidate:CandidateFile={version:1,builtAt:new Date(at).toISOString(),snapshots,reviewQueue:[],sourceStatus:Object.fromEntries(snapshots.flatMap(s=>s.events.map(e=>[e.provider,'PARSED_CACHED_SCOPE'])))};
    activate(candidate,snapshotDigest(candidate),path,at,true);return readReviewedCatalog(path);
  };
  assert.equal((await prepareCatalog(options)).version,'83664734f5fbb931cb19');assert.equal(fetches,0);
  assert.equal(readReviewedCatalog(runtime).snapshots.flatMap(s=>s.events).length,858);record('FRESH-01');
  const pointerTime=statSync(resolve(runtime,'active.json')).mtimeMs;
  assert.equal((await prepareCatalog(options)).action,'retained');assert.equal(fetches,0);assert.equal(statSync(resolve(runtime,'active.json')).mtimeMs,pointerTime);record('RESTART-01');

  // Старый двухгородской reviewed комплект проверяется на его реальной дате.
  const historicalRoot=resolve(root,'older');mkdirSync(historicalRoot);
  for(const suffix of ['.json','.review.json'])writeFileSync(resolve(historicalRoot,'e9f43ed9d1fd3c408584'+suffix),readFileSync('catalog/real/e9f43ed9d1fd3c408584'+suffix));
  atomicJson(resolve(historicalRoot,'active.json'),{version:1,snapshot:'e9f43ed9d1fd3c408584.json',review:'e9f43ed9d1fd3c408584.review.json'});
  const old=readReviewedCatalog(historicalRoot);assert(hasUsableEvents(old,now));
  const upgraded=resolve(root,'upgrade');installReviewed(old,upgraded,now);
  const d=await flowDriver(resolve(root,'test.sqlite'),{snapshots:old.snapshots},now,true,old.review,true);
  let saved:unknown,dbHash:string;
  try{
    await d.enter();await d.click('Подобрать');await d.say('Екатеринбург');
    for(const text of ['Любая дата','Любое время','Продолжить','Без лимита','Любая тема','Показать результаты'])await d.click(text);
    let detail=d.buttons().find(b=>/^Подробнее \d/.test(b.text));
    if(!detail){await d.click(d.buttons().find(b=>/уточн|непровер|вариант/i.test(b.text))!.text);detail=d.buttons().find(b=>/^Подробнее \d/.test(b.text));}
    assert(detail);await d.click(detail.text);await d.click('Сохранить');
    saved=d.runtime.store.db.prepare('SELECT * FROM bookmarks').all();assert.equal((saved as unknown[]).length,1);
    await d.close();dbHash=createHash('sha256').update(readFileSync(resolve(root,'test.sqlite'))).digest('hex');
    assert.equal((await prepareCatalog({...options,destination:upgraded})).version,'83664734f5fbb931cb19');
    assert.equal(createHash('sha256').update(readFileSync(resolve(root,'test.sqlite'))).digest('hex'),dbHash);record('UPGRADE-01',{sqliteBytesUnchanged:true});
    await d.reloadCatalog(resolve(upgraded,'active.json'));await d.say('/saved');await d.click('Открыть 1');
    const refs=d.screen()!.displayRefs;assert(refs?.length&&d.catalog.permits(refs,d.now,true));
    assert.match(d.screen()!.body.text,/Сохранено/);
    assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').all(),saved);record('BOOKMARK-01',{eventId:refs[0]!.eventId});
  }finally{await d.close();}

  const changed=structuredClone(bundle.snapshots);
  // Только fault fixture: сдвиг на секунду, не новый замер источников.
  for(const s of changed){s.retrievedAt=new Date(Date.parse(s.retrievedAt)+1000).toISOString();for(const v of [...s.events,...s.venues])for(const o of v.observations)o.retrievedAt=new Date(Date.parse(o.retrievedAt!)+1000).toISOString();}
  const newer=put(changed,resolve(root,'newer'));installReviewed(newer,runtime,now);
  assert.equal((await prepareCatalog(options)).action,'retained');assert.equal(version(),newer.pointer.snapshot);record('NO-DOWNGRADE-01');
  const subset=structuredClone(changed.filter(s=>s.events[0]!.provider==='bashopera'));
  for(const s of subset){s.retrievedAt=new Date(now-1000).toISOString();for(const v of [...s.events,...s.venues])for(const o of v.observations)o.retrievedAt=s.retrievedAt;}
  const newerSubset=put(subset,resolve(root,'newer-subset'));
  const subsetRuntime=resolve(root,'subset-runtime');installReviewed(newerSubset,subsetRuntime,now);
  assert.equal((await prepareCatalog({...options,destination:subsetRuntime})).action,'retained');
  assert.equal(readReviewedCatalog(subsetRuntime).snapshots.length,1); // Старый образ не возвращает удалённые источники.
  const corrupt=resolve(root,'corrupt');mkdirSync(corrupt);for(const key of ['snapshot','review'] as const)writeFileSync(resolve(corrupt,bundle.pointer[key]),bundle.files[key]);
  atomicJson(resolve(corrupt,'active.json'),bundle.pointer);const bad=JSON.parse(bundle.files.review.toString());bad.entries[0].snapshotHash='0'.repeat(64);atomicJson(resolve(corrupt,bundle.pointer.review),bad);
  const pointerBefore=readFileSync(resolve(runtime,'active.json'));
  await prepareCatalog({...options,bundled:corrupt});assert.deepEqual(readFileSync(resolve(runtime,'active.json')),pointerBefore);record('FAIL-01');
  const collision=resolve(root,'collision');mkdirSync(collision);writeFileSync(resolve(collision,bundle.pointer.snapshot),'invalid');
  assert.throws(()=>installReviewed(bundle,collision,now),/COLLISION/);assert.throws(()=>readFileSync(resolve(collision,'active.json')));record('ATOMIC-01');

  const staleNow=now+4*86400000,empty=resolve(root,'expired');
  await assert.rejects(prepareCatalog({...options,destination:empty,now:staleNow}),e=>e instanceof Error&&e.message===preparationError);
  assert.equal(fetches,1);assert.throws(()=>readFileSync(resolve(empty,'active.json')));record('STALE-01',{refreshInvoked:true,consumerStarted:false});

  // Источник A устарел/не ответил; свежий независимый B не удаляет его архивные факты.
  const one=structuredClone(bundle.snapshots.find(s=>s.events[0]!.provider==='bashopera')!);
  for(const s of [one]){s.retrievedAt=new Date(staleNow-60000).toISOString();for(const v of [...s.events,...s.venues])for(const o of v.observations)o.retrievedAt=s.retrievedAt;}
  const partial=put([one],resolve(root,'partial'),staleNow),retainedDigest=bundle.snapshots.filter(s=>s.events[0]!.provider!=='bashopera').map(snapshotDigest);
  await prepareCatalog({...options,destination:empty,now:staleNow,refresh:async()=>partial});
  const merged=readReviewedCatalog(empty);for(const hash of retainedDigest)assert(merged.snapshots.some(s=>snapshotDigest(s)===hash));
  const current=new Catalog('real',{snapshots:merged.snapshots},merged.review,true);assert.deepEqual(current.usableCities(staleNow),['ufa']);record('PARTIAL-REFRESH-01',{expiredShardsHidden:true,independentShardsPreserved:retainedDigest.length});
  assert.equal((await prepareCatalog({...options,mode:'synthetic-test'})).action,'synthetic');assert.equal(fetches,1);record('OFFLINE-01');
  return {result:'PASS',transport:'SIMULATED_MAX',network:'none',fixtureClock:new Date(now).toISOString(),dataset:bundle.pointer.snapshot.slice(0,20),reports};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const report=await catalogStartupScenarios(process.argv[2]??'.tmp/catalog-startup');console.log(JSON.stringify(report));
}
