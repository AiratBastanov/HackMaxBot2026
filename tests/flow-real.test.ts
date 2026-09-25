import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Catalog } from '../src/culture/catalog.js';
import { projectCard } from '../src/culture/card.js';
import { select } from '../src/data/select.js';
import { snapshotDigest, type DisplayRef } from '../src/data/source-policy.js';
import { deliveryAllowed, LiveMax, type MaxOperation } from '../src/max.js';
import { type Config } from '../src/config.js';
import { loadCurrentCatalog } from '../src/polling-config.js';
import { flowDriver, chooseDefaults } from '../scripts/flow-driver.js';
import { ACTOR } from './fixtures.js';
import { getState } from '../src/culture/flow.js';
import { Worker } from '../src/worker.js';

const snapshotPath=resolve('catalog/real/active.json');
const config:Config={mode:'live',ingress:'test-polling',host:'127.0.0.1',port:3000,databasePath:':memory:',apiBaseUrl:'https://platform-api2.max.ru',token:'fixture-token-never-sent',botId:'777',testers:new Set([ACTOR]),probeTtlMs:600000,requestTimeoutMs:1000,flowDataMode:'real',snapshotPath};
const catalog=Catalog.load(config),snapshots=catalog.availableCities.map(c=>catalog.forCity(c)!);
const time=Date.parse(catalog.review!.reviewedAt)+1000;
const ref:DisplayRef={snapshotHash:snapshotDigest(catalog.forCity('kzn')),eventId:catalog.forCity('kzn')!.events[0]!.id};
const op:MaxOperation={method:'messages',recipient:ACTOR,audience:'PROVIDER',displayRefs:[ref],body:{text:'Проверяем только политику, MAX симулирован.',attachments:[]}};

test('R17 policy binds source, snapshot, expiry, admission; basic navigation remains available',()=>{
  assert(deliveryAllowed(op,config,catalog,time));
  for(const refs of [undefined,[],[{...ref,snapshotHash:'0'.repeat(64)}],[{...ref,eventId:'kudago:58328'}]])assert.equal(deliveryAllowed({...op,displayRefs:refs},config,catalog,time),false);
  assert.equal(deliveryAllowed(op,config,new Catalog('real',{snapshots}),time),false);
  assert.equal(deliveryAllowed(op,config,catalog,time+8*86400000),false);
  assert.equal(deliveryAllowed({...op,recipient:'1234'},config,catalog,time),false);
  assert(deliveryAllowed({method:'messages',recipient:ACTOR,body:{text:'Главная'}},config,catalog,time+8*86400000));
});
test('R17 MAX messages, edit and callback payload reject unreviewed/expired refs before HTTP',async t=>{
  t.mock.method(Date,'now',()=>time);let calls=0;
  const max=new LiveMax(config,(async()=>{calls++;return new Response('{"success":true}',{headers:{'content-type':'application/json'}});}) as typeof fetch);
  const edit:MaxOperation={...op,method:'edit',mid:'tracked',chat:'123',body:{text:'Проверка политики',attachments:[]}};
  await max.execute(edit);assert.equal(calls,1);
  for(const operation of [op,edit,{method:'answers',callbackId:'fixture',audience:'PROVIDER',displayRefs:[ref],body:{notification:'provider'}} as MaxOperation]) {
    await assert.rejects(max.execute({...operation,displayRefs:undefined}),/PERMISSION/);
    await assert.rejects(max.execute({...operation,displayRefs:[{...ref,snapshotHash:'bad'}]}),/PERMISSION/);
  }
  t.mock.method(Date,'now',()=>time+8*86400000);await assert.rejects(max.execute(edit),/PERMISSION/);assert.equal(calls,1);
});
test('R17 real preflight uses observed validity, not one-hour synthetic generation; no reading-based renewal',()=>{
  assert.equal(loadCurrentCatalog(config,time+2*3600000).availableCities.length,2);
  const first=Catalog.load(config).forCity('kzn')!.retrievedAt;assert.equal(Catalog.load(config).forCity('kzn')!.retrievedAt,first);
  assert.throws(()=>loadCurrentCatalog(config,time+8*86400000),/REVIEWED_CURRENT_REAL/);
});
test('R17 worker denies pending provider edits and callback updates with mismatched policy',async()=>{
  mkdirSync('.tmp/real-policy',{recursive:true});const dir=mkdtempSync(resolve('.tmp/real-policy/case-'));
  const d=await flowDriver(resolve(dir,'test.sqlite'),{snapshots},time,true,catalog.review);
  try {
    await d.enter();let calls=0;
    const worker=new Worker(d.runtime.store,config,{async execute(){calls++;throw Error('MUST_NOT_SEND');}},()=>d.now,()=>{},catalog);
    for(const method of ['messages','edit','answers'] as const) {
      const data=method==='answers'?{method,callbackId:'fixture',body:{notification:'blocked'}}:method==='edit'?{...op,method,mid:'tracked',chat:'123'}:op;
      d.runtime.store.enqueue('policy-'+method,ACTOR,null,'culture_policy',{...data,audience:'PROVIDER',displayRefs:[{...ref,snapshotHash:'bad'}]},d.now,d.now+60000);
      await worker.tick();
    }
    assert.equal(calls,0);assert.equal((d.runtime.store.db.prepare("SELECT count(*) n FROM outbox WHERE status='SUPPRESSED_DISPLAY'").get() as {n:number}).n,3);
  }finally{await d.close();}
});
test('R17 real journey: source, save/restart, expired saved card hidden; neutral remove/cancel remains',async()=>{
  mkdirSync('.tmp/real-policy',{recursive:true});const dir=mkdtempSync(resolve('.tmp/real-policy/journey-'));
  const d=await flowDriver(resolve(dir,'test.sqlite'),{snapshots},time,true,catalog.review);
  try {
    await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');assert(d.buttons().some(b=>b.type==='link'&&b.url.startsWith('https://kazan-kremlin.ru/')));
    await d.click('Условия посещения');await d.click('К карточке');await d.click('Сохранить');
    const saved=d.runtime.store.db.prepare('SELECT data FROM bookmarks').get();await d.restart();await d.say('/saved');await d.click('Открыть 1');assert.deepEqual(d.runtime.store.db.prepare('SELECT data FROM bookmarks').get(),saved);
    const title=JSON.parse((saved as {data:string}).data).title;d.advance(8*86400000);await d.say('/saved');assert(!d.screen()!.body.text.includes(title));await d.click('Открыть 1');assert(!d.screen()!.body.text.includes(title));await d.click('Удалить закладку');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);await d.click('Отмена');
    assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).stage,'bookmark');assert.deepEqual(d.runtime.store.db.prepare('SELECT data FROM bookmarks').get(),saved);
  }finally{await d.close();}
});
