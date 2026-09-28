import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {flowDriver} from '../scripts/flow-driver.js';
import {Catalog} from '../src/culture/catalog.js';
import {snapshotDigest} from '../src/data/source-policy.js';
import {ACTOR,OTHER,SECRET,reply,callback,lifecycle,encode} from './fixtures.js';
import {getState} from '../src/culture/flow.js';
import {outboundAuthorization,deliveryAllowed,LiveMax,type MaxOperation} from '../src/max.js';
import {loadConfig,type Config} from '../src/config.js';
import {Storage} from '../src/storage.js';
import {runPolling,commitBatch} from '../src/polling.js';
import {parseJson} from '../src/contracts.js';

const NEW1='9007199254741881',NEW2='9007199254741883';
const path=()=>{mkdirSync('.tmp/public',{recursive:true});return resolve(mkdtempSync(resolve('.tmp/public/case-')),'state.sqlite');};
const historical={snapshotPath:'catalog/real/e9f43ed9d1fd3c408584.json',reviewPath:'catalog/real/e9f43ed9d1fd3c408584.review.json'};
const catalog=Catalog.load({flowDataMode:'real',...historical,admissionMode:'PUBLIC'} as Config);
const input={snapshots:catalog.availableCities.map(c=>catalog.forCity(c)!)};
const start=Date.parse(catalog.review!.reviewedAt)+1000;
async function choices(d:Awaited<ReturnType<typeof flowDriver>>,actor:string,city='Казань') {
 for(const label of ['Подобрать',city,'Завтра','12:00–18:00','Продолжить','До 500 ₽','Любая тема','Показать результаты'])await d.click(label==='Завтра'?d.dateLabel('Завтра',actor):label,actor);
}

test('PUBLIC: unknown Start/private message → real cards → conditions → save/restart/open/delete/erase; independent newcomer and old A/B',async()=>{
 const d=await flowDriver(path(),input,start,true,catalog.review,true);
 try {
  assert.equal(d.config.testers.size,0);assert(!d.runtime.store.contact(NEW1));
  await d.enter(NEW1);await choices(d,NEW1);await d.click('Подробнее 1',NEW1);
  assert(d.buttons(NEW1).some(b=>b.type==='link'&&b.url.startsWith('https://kazan-kremlin.ru/')));
  await d.click('Условия посещения',NEW1);await d.click('К карточке',NEW1);await d.click('Сохранить',NEW1);
  const saved=d.runtime.store.db.prepare('SELECT data FROM bookmarks WHERE actor=?').all(NEW1);assert.equal(saved.length,1);
  await d.say('/start',NEW2);await choices(d,NEW2,'Екатеринбург');
  assert.equal(JSON.parse(getState(d.runtime.store,NEW2)!.data).draft.city,'ekb');
  assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(NEW2) as {n:number}).n,0);
  const stolen=d.payload('Мои события',NEW1); // callback belongs to NEW1, never to an actor in its payload
  await d.press(stolen,NEW2);assert.deepEqual(d.runtime.store.db.prepare('SELECT data FROM bookmarks WHERE actor=?').all(NEW1),saved);
  for(const command of ['/qa','/pair','/reset','/refresh','g1:start'])await d.say(command,NEW2);
  assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM probes').get() as {n:number}).n,0);
  assert(!d.screen(NEW2)?.body.text.includes('код сопряжения'));
  await d.restart();await d.say('/saved',NEW1);await d.click('Открыть 1',NEW1);
  assert.deepEqual(d.runtime.store.db.prepare('SELECT data FROM bookmarks WHERE actor=?').all(NEW1),saved);
  await d.click('Удалить закладку',NEW1);await d.click('Да, удалить',NEW1);
  assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(NEW1) as {n:number}).n,0);
  for(const actor of [ACTOR,OTHER]){await d.enter(actor);assert(d.runtime.store.contact(actor));}
  const before=getState(d.runtime.store,OTHER);await d.restart();assert.deepEqual(getState(d.runtime.store,OTHER),before);
  const bad=await d.post(reply(undefined,d.now,'/start',NEW1,'bad-secret'),'wrong');assert.equal(bad.status,401);
  await d.say('/delete_data',NEW1);await d.click('Да, удалить',NEW1);
  assert(!getState(d.runtime.store,NEW1));assert(!d.runtime.store.contact(NEW1));assert(getState(d.runtime.store,NEW2));
 }finally{await d.close();}
});

test('PUBLIC: bounded burst cannot block another actor; callbacks cannot create durable contact',async()=>{
 const d=await flowDriver(':memory:',input,start,true,catalog.review,true);
 try {
  await d.post(callback('home','unowned',NEW1,d.now));await d.drain();assert(!d.runtime.store.contact(NEW1));
  let limited=0;
  for(let i=0;i<50;i++){const r=await d.post(reply(undefined,d.now+i,'/start',NEW1,`burst-${i}`));if((await r.json() as {status:string}).status==='rate_limited')limited++;}
  assert(limited>=42);assert(d.runtime.store.pendingInbox(100).length<=8);
  await d.enter(NEW2);assert(d.screen(NEW2));assert(d.runtime.store.pendingInbox(100).length<9);
 }finally{await d.close();}
});

test('Existing restricted A/B preferences and bookmarks survive PUBLIC admission switch',async()=>{
 const db=path(),old=await flowDriver(db,input,start,true,catalog.review,false);
 await old.enter(ACTOR);await choices(old,ACTOR);await old.click('Подробнее 1',ACTOR);await old.click('Сохранить',ACTOR);
 await old.enter(OTHER);const state=getState(old.runtime.store,OTHER),saved=old.runtime.store.db.prepare('SELECT data FROM bookmarks WHERE actor=?').all(ACTOR);await old.close();
 const d=await flowDriver(db,input,start+120000,true,catalog.review,true);
 try{assert.deepEqual(getState(d.runtime.store,OTHER),state);assert.deepEqual(d.runtime.store.db.prepare('SELECT data FROM bookmarks WHERE actor=?').all(ACTOR),saved);await d.say('/saved',ACTOR);await d.click('Открыть 1',ACTOR);await d.enter(NEW1);assert(d.screen(NEW1));}finally{await d.close();}
});

test('PUBLIC: source hashes and durable actor ownership protect sends, edits, queued callbacks and saved projections',async t=>{
 t.mock.method(Date,'now',()=>start);
 const d=await flowDriver(':memory:',input,start,true,catalog.review,true);
 try {
  await d.enter(NEW1);await choices(d,NEW1);await d.click('Подробнее 1',NEW1);
  const operation=d.operations.filter(op=>op.method==='messages'||op.method==='edit').at(-1)!;
  const c={...d.config,mode:'live' as const,token:'synthetic-token-never-sent',...historical};
  const authorize=outboundAuthorization(c,d.runtime.store);let calls=0;
  const max=new LiveMax(c,(async()=>{calls++;return new Response('{"success":true}');}) as typeof fetch,undefined,authorize);
  const edit={...operation,method:'edit',mid:d.screen(NEW1)!.method==='edit'?(d.screen(NEW1) as any).mid:'missing',actor:NEW1} as MaxOperation;
  assert(deliveryAllowed(operation,c,catalog,start));
  assert(!deliveryAllowed({...operation,displayRefs:[]},c,catalog,start));
  assert(!deliveryAllowed(operation,c,catalog,start+8*86400000));
  assert(!authorize({...operation,actor:NEW2}));
  await assert.rejects(max.execute({...edit,recipient:NEW2} as MaxOperation),/PERMISSION/);
  await assert.rejects(max.execute({...operation,displayRefs:[]} as MaxOperation),/PERMISSION/);assert.equal(calls,0);
  const tampered=structuredClone(catalog.review!);tampered.entries[0]!.publicPolicyHashes={};
  assert.equal(new Catalog('real',input,tampered,true).usableCities(start).includes('kzn'),false);
 }finally{await d.close();}
});

test('PUBLIC polling runs beyond 120 polls and 30 minutes; durable cursor, pacing and stop/restart',async()=>{
 const c=loadConfig({APP_MODE:'local',ADMISSION_MODE:'PUBLIC',DATABASE_PATH:path(),MAX_WEBHOOK_SECRET:SECRET,FLOW_DATA_MODE:'synthetic-test'});
 let s=new Storage(c.databasePath,c),now=100000,polls=0;
 const controller=new AbortController();
 const max={subscriptions:async()=>[],updates:async(marker:string|null)=>{polls++;now+=16000;if(polls===125)controller.abort();return {updates:[],marker:String(polls)};}};
 await runPolling({max,store:s,config:c,signal:controller.signal,clock:()=>now,wait:async ms=>{now+=ms;}});
 assert.equal(polls,125);assert(now>1900000);assert.equal(s.pollingMarker(),'124');assert.equal(s.getMeta('poll_campaign'),undefined);
 s.close();s=new Storage(c.databasePath,c);assert.equal(s.pollingMarker(),'124');
 const update=parseJson(encode(reply(undefined,now,'/start',NEW1)));
 assert.equal(commitBatch(s,c,{updates:[update],marker:'126'},now).accepted,1);s.close();
});
