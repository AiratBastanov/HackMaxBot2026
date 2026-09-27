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
import {getState} from '../src/culture/flow.js';
import {savedRows,openRow} from '../scripts/bookmark-scenario.js';
import {presentationTitle} from '../src/culture/card.js';

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
    assert(d.screen()!.body.text.includes('Сохранено · Подходит по известным условиям'));assert(!d.screen()!.body.text.includes('Изменились условия'));
    assert.equal(d.screen()!.body.text.match(/Москва, UTC\+3/g)?.length,1);
    assert.match(d.screen()!.body.text,/Выбрано:.*12:00–18:00/);
    assert(deliveryAllowed(d.screen()!,d.config,d.catalog,d.now));assert.notEqual(d.screen()!.displayRefs![0]!.snapshotHash,JSON.parse(before.data).displayRef.snapshotHash);
    assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').get(),before);
    // Предупреждение проверяется в полном сообщении приложения, не только в helper.
    const savedCard=JSON.parse(before.data),changed=fixture(values=>{
      const event=values.find(s=>s.scope.city===savedCard.query.city)!.events.find(e=>e.id===savedCard.eventId)!;
      event.price={...event.price,kind:'EXACT',amount:900,lowerBound:900};event.tariffs=[];event.admission.registration='REQUIRED';
    });
    writeFileSync(path,JSON.stringify({snapshots:changed.values}));writeFileSync(reviewPath,JSON.stringify(changed.review));
    await d.reloadCatalog(path);await d.say('/saved');assert.match(d.screen()!.body.text,/условия изменились/);assert.match(d.screen()!.body.text,/💰 900 ₽ за всех/);await d.click('Открыть 1');
    assert.match(d.screen()!.body.text,/Изменились условия: тариф, допуск/);assert.match(d.screen()!.body.text,/выше бюджета/);
    assert.match(d.screen()!.body.text,/900 ₽/);assert.match(d.screen()!.body.text,/Регистрация: обязательна/);
    assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').get(),before);
    writeFileSync(path,JSON.stringify({snapshots:replacement.values}));writeFileSync(reviewPath,JSON.stringify(replacement.review));
    await d.reloadCatalog(path);await d.say('/saved');await d.click('Открыть 1');
    await d.click('Условия посещения');await d.click('К карточке');await d.click('Удалить закладку');
    assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);await d.click('Отмена');assert(d.screen()!.body.text.includes('Сохранено ·'));
    await d.click('Удалить закладку');const stale=d.payload('Да, удалить');await d.click('Да, удалить');
    assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
    await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Сохранить');
    const resaved=d.runtime.store.db.prepare('SELECT * FROM bookmarks').get() as {generation:string};assert.notEqual(resaved.generation,before.generation);
    await d.press(stale,ACTOR);assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').get(),resaved);
  }finally{await d.close();}
});

test('Несколько дат одной закладки: reviewed refresh каждой записи, legacy-категория, отдельное истечение и запрет показа',async()=>{
  mkdirSync('.tmp/bookmark-refresh',{recursive:true});const dir=mkdtempSync(resolve('.tmp/bookmark-refresh/variants-'));
  const isolate=(ss:Snapshot[])=>{
    const s=ss.find(s=>s.scope.city==='ekb')!;s.events=s.events.filter(e=>e.id==='mie:azins_magic_of_name');
    s.stats.normalizedEvents=s.events.length;s.stats.occurrences=s.events.reduce((n,e)=>n+e.occurrences.length,0);ss.splice(0,ss.length,s);
  };
  const initial=fixture(isolate),d=await flowDriver(resolve(dir,'disposable.sqlite'),{snapshots:initial.values},time+2000,true,initial.review);
  try {
    await d.enter();
    for(const label of ['Подобрать','Екатеринбург','Завтра','12:00–18:00','Продолжить','До 500 ₽','Выставки','Показать результаты','Подробнее 1','Сохранить'])await d.click(label==='Завтра'?d.dateLabel('Завтра'):label);
    const first=savedRows(d)[0]!,c=JSON.parse(first.data);
    const nextDay=Array.from({length:7},(_,i)=>cityDate(new Date(Date.parse(c.query.start)+(i+1)*86400000).toISOString(),c.query.timezone)).find(day=>{
      const q={...c.query,start:cityInstant(day,'12:00',c.query.timezone),end:cityInstant(day,'18:00',c.query.timezone)};
      return select(d.catalog.forCity(q.city),q,new Date(d.now)).recommendations.some(r=>r.eventId===c.eventId&&r.occurrenceId===c.occurrenceId);
    });assert(nextDay,'В fixture требуется вторая дата того же периода');
    assert.equal(c.occurrence.kind,'FLEXIBLE_VISIT');
    await d.click('К результатам');await d.click('Дата');await d.click('Другая дата');
    await d.say(JSON.parse(getState(d.runtime.store,ACTOR)!.data).input.token+' '+nextDay);await d.click('Показать результаты');await d.click('Подробнее 1');await d.click('Сохранить');
    assert.equal(savedRows(d).length,2);assert.equal(JSON.parse(savedRows(d)[0]!.data).identity,c.identity);
    // Старые записи не обязаны иметь categories; enrichment разрешён только после безопасного match.
    delete c.categories;d.runtime.store.db.prepare('UPDATE bookmarks SET data=? WHERE actor=? AND identity=?').run(JSON.stringify(c),ACTOR,first.identity);
    const before=savedRows(d),replacement=fixture(ss=>{isolate(ss);ss[0]!.events[0]!.categories=['exhibition','culture'];}),path=resolve(dir,'catalog.json'),reviewPath=resolve(dir,'review.json');
    writeFileSync(path,JSON.stringify({snapshots:replacement.values}));writeFileSync(reviewPath,JSON.stringify(replacement.review));d.config.reviewPath=reviewPath;await d.reloadCatalog(path);
    for(const b of before){
      const original=JSON.parse(b.data),view=currentBookmark(original,d.catalog,d.now);assert(view.card);assert.deepEqual(view.card.query,original.query);
      await openRow(d,b);assert(d.screen()!.body.text.includes(presentationTitle(view.card)));assert(deliveryAllowed(d.screen()!,d.config,d.catalog,d.now));
      assert.notEqual(d.screen()!.displayRefs![0]!.snapshotHash,original.displayRef.snapshotHash);
      assert.deepEqual(savedRows(d),before);
    }
    d.advance(Date.parse(c.query.end)+1-d.now);
    assert.equal(currentBookmark(c,d.catalog,d.now).assessment,'EXPIRED');
    assert.equal(currentBookmark(JSON.parse(before[0]!.data),d.catalog,d.now).assessment,'STRICT');
    // Тот же разрешённый snapshot с изменёнными фактами без нового hash-review недоступен.
    const denied=structuredClone(replacement.values);denied[0]!.events[0]!.categories=['workshop'];d.catalog.replace({snapshots:denied});
    await openRow(d,before.find(b=>b.identity===first.identity)!);
    assert.match(d.screen()!.body.text,/недоступны/);assert(!d.screen()!.body.text.includes(c.title));assert.doesNotMatch(d.screen()!.body.text,/\(Мастер-класс\)/);
    await d.click('Удалить закладку');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);assert.match(d.screen()!.body.text,/2030|2026/);
    await d.click('Отмена');assert.deepEqual(savedRows(d),before);
  }finally{await d.close();}
});
