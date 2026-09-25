import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Catalog} from '../src/culture/catalog.js';
import {currentBookmark} from '../src/culture/bookmark.js';
import {projectCard} from '../src/culture/card.js';
import {select} from '../src/data/select.js';
import {snapshotDigest,factualScope} from '../src/data/source-policy.js';
import {cityDate,cityInstant} from '../src/data/cities.js';
import type {Snapshot,Query} from '../src/data/contract.js';
import {flowDriver,chooseDefaults} from '../scripts/flow-driver.js';
import {deliveryAllowed} from '../src/max.js';
import {ACTOR} from './fixtures.js';

const active=Catalog.load({flowDataMode:'real',snapshotPath:resolve('catalog/real/active.json')} as any);
const time=Date.parse(active.review!.reviewedAt)+1000;
const snapshots=active.availableCities.map(c=>active.forCity(c)!);
const day=cityDate(new Date(time+86400000).toISOString(),'Asia/Yekaterinburg');
const q:Query={version:2,city:'ekb',timezone:'Asia/Yekaterinburg',start:cityInstant(day,'12:00','Asia/Yekaterinburg'),end:cityInstant(day,'18:00','Asia/Yekaterinburg'),party:{adults:1,childAges:[]},budgetBasis:'PARTY_TOTAL',budgetRub:500,category:null,zone:null,kind:'ANY',preferences:{categories:[]}};
const recommendation=select(active.forCity('ekb'),q,new Date(time),false,true).recommendations.find(r=>r.eventId==='mie:azins_magic_of_name')!;
const saved=projectCard(active,q,recommendation);
// Изменения ниже — искусственные сценарии над disposable копией, не новая публикация фактов.
function fixture(mutate:(snapshots:Snapshot[])=>void=()=>{}) {
  const values=structuredClone(snapshots),at=new Date(time+1000).toISOString();
  for(const s of values){s.retrievedAt=at;for(const e of s.events){e.retrievedAt=at;e.observations.forEach(o=>o.retrievedAt=at);}for(const v of s.venues)v.observations.forEach(o=>o.retrievedAt=at);}
  mutate(values);
  const review={version:1,scope:'ADMITTED_TESTERS_FACTS',factualScope,reviewedAt:at,entries:values.map(s=>({snapshotHash:snapshotDigest(s),sources:[...new Set(s.events.map(e=>e.provider))],basis:'institution-facts/1',validUntil:new Date(Date.parse(at)+72*3600000).toISOString()}))};
  return {values,review,catalog:new Catalog('real',{snapshots:values},review)};
}
test('R18 bookmark: только новое получение не означает изменения условий; legacy venue сопоставляется явно',()=>{
  const next=fixture(),copy=structuredClone(saved);delete copy.visit!.venue.id;
  const before=JSON.stringify(copy),view=currentBookmark(copy,next.catalog,time+2000);
  assert(view.card);assert.equal(view.assessment,'STRICT');assert.deepEqual(view.changed,[]);
  assert.notEqual(view.card.displayRef!.snapshotHash,copy.displayRef!.snapshotHash);
  assert(next.catalog.permits([view.card.displayRef!],time+2000));assert.equal(next.catalog.permits([copy.displayRef!],time+2000),false);
  assert.equal(JSON.stringify(copy),before);assert.deepEqual(view.card.query,copy.query);assert.equal(view.card.identity,copy.identity);
});
test('R18 bookmark: тариф, часы и допуск переоцениваются, прежний STRICT не наследуется',()=>{
  const next=fixture(ss=>{const e=ss.find(s=>s.scope.city==='ekb')!.events.find(e=>e.id===saved.eventId)!;
    e.price={...e.price,kind:'EXACT',amount:900,lowerBound:900,evidence:'Искусственный изменённый тариф для проверки'};e.tariffs=[];
    e.admission.registration='REQUIRED';e.occurrences[0]!.opening![0]!.close-=30;});
  const view=currentBookmark(saved,next.catalog,time+2000);
  assert.equal(view.assessment,'MISMATCH');assert.equal(view.card!.kind,'UNCERTAIN');assert(view.notice.includes('выше бюджета'));
  assert.deepEqual(view.changed,['тариф','время','допуск']);assert.equal(saved.visit!.price.amount,0);
});
test('R18 bookmark: отсутствие, identity/venue/session конфликт и expired review дают нейтральный отказ',()=>{
  const cases=[
    (ss:Snapshot[])=>{const s=ss.find(s=>s.scope.city==='ekb')!;s.events=s.events.filter(e=>e.id!==saved.eventId);s.stats.normalizedEvents=s.events.length;s.stats.occurrences=s.events.reduce((n,e)=>n+e.occurrences.length,0);},
    (ss:Snapshot[])=>{ss.find(s=>s.scope.city==='ekb')!.events.find(e=>e.id===saved.eventId)!.title='Иная идентичность';},
    (ss:Snapshot[])=>{const s=ss.find(s=>s.scope.city==='ekb')!,e=s.events.find(e=>e.id===saved.eventId)!;s.venues.find(v=>v.id===e.occurrences[0]!.venueId)!.address='Иной адрес';},
    (ss:Snapshot[])=>{ss.find(s=>s.scope.city==='ekb')!.events.find(e=>e.id===saved.eventId)!.occurrences[0]!.id+=':another';},
  ];
  for(const change of cases)assert.equal(currentBookmark(saved,fixture(change).catalog,time+2000).card,null);
  assert.equal(currentBookmark(saved,fixture().catalog,time+73*3600000).assessment,'UNAVAILABLE');
  assert(currentBookmark(saved,fixture(cases[0]).catalog,time+2000).notice.includes('не подтверждение отмены'));
});
test('R18 bookmark: истёкший выбор остаётся истёкшим, новые текущие сведения не переносят дату',()=>{
  const view=currentBookmark(saved,fixture().catalog,time+48*3600000);
  assert.equal(view.assessment,'EXPIRED');assert.equal(view.card!.kind,'UNCERTAIN');assert.deepEqual(view.card!.query,saved.query);
});
test('R18 HTTP application: save -> replacement/reload -> current refs -> cancel/delete/re-save; generation не переписывается',async()=>{
  mkdirSync('.tmp/bookmark-refresh',{recursive:true});const dir=mkdtempSync(resolve('.tmp/bookmark-refresh/case-'));
  const d=await flowDriver(resolve(dir,'disposable.sqlite'),{snapshots},time,true,active.review);
  try {
    await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Условия посещения');await d.click('К карточке');await d.click('Сохранить');
    const before=d.runtime.store.db.prepare('SELECT * FROM bookmarks').get() as {data:string;generation:string};
    const replacement=fixture(),path=resolve(dir,'snapshot.json'),reviewPath=resolve(dir,'review.json');
    writeFileSync(path,JSON.stringify({snapshots:replacement.values}));writeFileSync(reviewPath,JSON.stringify(replacement.review));
    d.config.reviewPath=reviewPath;await d.reloadCatalog(path);await d.say('/saved');await d.click('Открыть 1');
    assert(d.screen()!.body.text.includes('Сохранённый выбор · текущие условия'));assert(d.screen()!.body.text.includes('Изменений тарифа, времени и допуска не выявлено'));
    assert(deliveryAllowed(d.screen()!,d.config,d.catalog,d.now));assert.notEqual(d.screen()!.displayRefs![0]!.snapshotHash,JSON.parse(before.data).displayRef.snapshotHash);
    assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').get(),before);
    await d.click('Условия посещения');await d.click('К карточке');await d.click('Удалить закладку');
    assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);await d.click('Отмена');assert(d.screen()!.body.text.includes('Сохранённый выбор'));
    await d.click('Удалить закладку');const stale=d.payload('Да, удалить');await d.click('Да, удалить');
    assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
    await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Сохранить');
    const resaved=d.runtime.store.db.prepare('SELECT * FROM bookmarks').get() as {generation:string};assert.notEqual(resaved.generation,before.generation);
    await d.press(stale,ACTOR);assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').get(),resaved);
  }finally{await d.close();}
});
