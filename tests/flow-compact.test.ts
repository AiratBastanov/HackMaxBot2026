import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {flowDriver,chooseDefaults} from '../scripts/flow-driver.js';
import {compactFixture} from '../src/culture/compact-fixture.js';
import {getState,makeQuery} from '../src/culture/flow.js';
import {ACTOR,OTHER,reply,callback} from './fixtures.js';
import {activeScreen} from '../src/screens.js';
import {cities,resolveCity,cityDate} from '../src/data/cities.js';
import {select} from '../src/data/select.js';
import {syntheticClock} from '../src/culture/fixture.js';
import {assessParty} from '../src/data/party.js';
import {querySchema} from '../src/data/contract.js';
import {cardOverview,cardPages,projectCard} from '../src/culture/card.js';
import {Catalog} from '../src/culture/catalog.js';
import {writeSnapshot} from '../src/data/cache.js';
import Database from 'better-sqlite3';

async function setup(t:TestContext) {
  const root=resolve('.tmp/compact-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'case-'));
  const d=await flowDriver(resolve(dir,'flow.sqlite'),compactFixture());
  t.after(async()=>{await d.close();assert(dir.startsWith(root+sep));rmSync(dir,{recursive:true});});return d;
}
const state=(d:Awaited<ReturnType<typeof setup>>)=>JSON.parse(getState(d.runtime.store,ACTOR)!.data);
const text=(d:Awaited<ReturnType<typeof setup>>)=>d.screen()!.body.text;
const q=(ages:(number|null)[]=[],adults=1,budget=500)=>makeQuery({city:'kzn',party:{adults,childAges:ages},date:'2030-04-06',from:'12:00',until:'18:00',budget,category:null});

test('C16 city: aliases, ambiguity, absent catalog, state-bound text, reply and duplicate fencing',async t=>{
  assert.deepEqual(resolveCity('  ЕКБ  '),['ekb']);assert.deepEqual(resolveCity('Санкт - Петербург'),['spb']);assert.deepEqual(resolveCity('нов'),['nnv','nsk']);assert.deepEqual(resolveCity('Луна'),[]);
  const d=await setup(t);await d.enter();await d.click('Подобрать');await d.say('Москва');assert.match(text(d),/данные сейчас недоступны/);assert.equal(state(d).stage,'city');
  await d.say('нов');assert.deepEqual(d.buttons().filter(b=>b.type==='callback').map(b=>b.text).slice(0,2),['Нижний Новгород','Новосибирск']);
  const wrong=reply('old-ui',d.now+1,'Екб',ACTOR,'wrong-city-reply');await d.post(wrong);await d.drain();assert.equal(state(d).draft.city,'kzn');
  await d.say('екб');assert.equal(state(d).draft.city,'ekb');assert.match(text(d),/UTC\+5/);
  const accepted=state(d).draft.city;await d.say('Казань');assert.equal(state(d).draft.city,accepted);
  await d.click('Подобрать');const ev=reply(undefined,d.now+1,'екб',ACTOR,'duplicate-city');await d.post(ev);await d.drain();const revision=getState(d.runtime.store,ACTOR)!.revision;
  await d.post(ev);await d.drain();assert.equal(getState(d.runtime.store,ACTOR)!.revision,revision);
});
test('C16 cities: canonical timezone, per-city catalogs and cache cannot leak',async t=>{
  const bundle=compactFixture(),catalog=new Catalog('synthetic-test',bundle),query={...q(),city:'ekb' as const,timezone:cities.ekb.timezone,start:'2030-04-06T07:00:00Z',end:'2030-04-06T13:00:00Z'};
  assert.equal(cityDate('2030-04-05T20:00:00Z',cities.ekb.timezone),'2030-04-06');assert.equal(cityDate('2030-04-05T20:00:00Z',cities.kzn.timezone),'2030-04-05');
  const result=select(catalog.forCity('ekb'),query,syntheticClock,true);assert(result.recommendations.every(r=>r.eventId.includes(':ekb:')));assert(result.recommendations.length);
  assert.equal(select(catalog.forCity('kzn'),query,syntheticClock,true).status,'CITY_UNAVAILABLE');
  assert.match(cardOverview(projectCard(catalog,query,result.recommendations[0]!)),/UTC\+5/);
  const d=await setup(t),path=resolve(d.config.databasePath,'..','snapshot.json');
  assert.equal((await writeSnapshot(path,bundle.snapshots[0])).replaced,true);assert.equal((await writeSnapshot(path,bundle.snapshots[1])).reason,'CITY_MISMATCH');
});
test('C16 prices: adult+child exact, unknown child and ages, lower bounds, conditional/package preserved',()=>{
  const s=compactFixture().snapshots[0]!,e=s.events[0]!,unknown=s.events[1]!;
  assert.equal(assessParty(e,q([7],2)).total,500);
  let r=assessParty(unknown,q([7],2));assert.equal(r.total,null);assert.equal(r.knownSubtotal,400);assert.match(r.unresolved.join(' '),/ребёнка/);
  assert.equal(select(s,q([7],3,500),syntheticClock,true,true).uncertain.some(c=>c.eventId===unknown.id),false);
  assert.equal(select(s,q([7],2,500),syntheticClock,true,true).uncertain.some(c=>c.eventId===unknown.id),true);
  const band=structuredClone(e);band.tariffs![1]!.minAge=6;
  assert.equal(assessParty(band,q([null],1)).total,null);
  for(const kind of ['FROM','CONDITIONAL','PACKAGE','UNKNOWN'] as const){const v=structuredClone(e);v.tariffs![1]!.kind=kind;v.tariffs![1]!.amount=null;v.tariffs![1]!.lowerBound=100;assert.equal(assessParty(v,q([7])).total,null);}
  const from=structuredClone(e);from.tariffs![1]!.kind='FROM';from.tariffs![1]!.amount=null;from.tariffs![1]!.lowerBound=400;
  assert.equal(assessParty(from,q([7])).lowerBound,600);
  assert.throws(()=>querySchema.parse({...q([7]),budgetBasis:'SINGLE_ADULT'}));
  for(const party of [{adults:0,childAges:[]},{adults:1.5,childAges:[]},{adults:8,childAges:[1]},{adults:1,childAges:[18]}])assert.throws(()=>querySchema.parse({...q(),party}));
});
test('C16 admission: labeling is separate; known incompatibility excluded; missing age uncertain',()=>{
  const s=compactFixture().snapshots[0]!,e=s.events[0]!;e.providerAgeLabel='12+';
  assert.equal(assessParty(e,q([7])).admission,'MATCH');e.admission.requirements!.minimumAge=12;
  assert.equal(assessParty(e,q([7])).admission,'MISMATCH');assert.equal(select(s,q([7]),syntheticClock,true,true).recommendations.some(r=>r.eventId===e.id),false);
  assert.equal(assessParty(e,q([null])).admission,'UNKNOWN');e.admission.requirements!.children='PROHIBITED';assert.equal(assessParty(e,q([17])).admission,'MISMATCH');
});
test('C16 renderer: concise overview, meaningful conditions, original evidence unchanged, bounded pages',()=>{
  const s=compactFixture().snapshots[0]!,e=s.events[0]!;
  e.observations.push({retrievedAt:s.retrievedAt,requestUrl:'https://example.org/debug',fields:['price','dates'],conflicts:['price']});
  e.admission.conditions.push('Служебный вход со двора.');
  const c=projectCard(new Catalog('synthetic-test',s),q(),select(s,q(),syntheticClock,true).recommendations[0]!);
  const before=JSON.stringify(c),overview=cardOverview(c),pages=cardPages(c).join('\n');
  assert(overview.length<1000);for(const re of [/17:30/,/200 ₽/,/Регистрация: обязательна/,/UTC\+3/,/Вымышленный набор/])assert.match(overview,re);
  for(const re of [/Поля:/,/URL получения:/,/Конфликты: не/,/\.000Z/,/example.org\/debug/,/получены нами/])assert.doesNotMatch(overview+pages,re);
  assert.match(pages,/расходятся сведения: цена/);assert.match(pages,/Служебный вход/);assert.equal(JSON.stringify(c),before);
  const long=structuredClone(c);long.visit!.admission.conditions.push('Длинное условие '+ 'А'.repeat(3900)+' ОКОНЧАНИЕ');assert(cardPages(long).every(p=>p.length<=2401));assert.match(cardPages(long).join(''),/ОКОНЧАНИЕ/);
});
test('C16 HTTP/SQLite: same active mid, party summary/reset, city reset, bookmarks survive and two-button cancel restores conditions',async t=>{
  const d=await setup(t);await d.enter();const mid=activeScreen(d.runtime.store,ACTOR)!.mid;await chooseDefaults(d);
  assert.equal(activeScreen(d.runtime.store,ACTOR)!.mid,mid);assert(d.operations.some(o=>o.method==='edit'));assert.equal(d.operations.filter(o=>o.method==='messages').length,1);
  await d.click('Подробнее 1');await d.click('Сохранить');await d.say('/saved');await d.click('Открыть 1');await d.click('Условия посещения');
  await d.click('Удалить закладку');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);assert.match(text(d),/Удалить «выставка света \(Выставка\)» из сохранённого/);
  const stale=d.payload('Да, удалить');await d.click('Отмена');assert.match(text(d),/Условия посещения ·/);await d.press(stale);assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as any).n,1);
  await d.say('/delete_data');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);await d.click('Отмена');assert.match(text(d),/Условия посещения ·/);
  await d.click('Главная');await chooseDefaults(d);await d.click('Показать варианты для проверки');await d.click('Посетители');await d.click('Взрослые +');await d.click('Дети +');await d.click('Продолжить');await d.click('Указать возраст');await d.say(state(d).input.token+' 7');await d.click('До 500 ₽');
  assert.equal(state(d).optIn,false);assert.equal(state(d).draft.budgetBasis,'PARTY_TOTAL');assert.match(text(d),/2 взр., 1 дет/);assert.match(text(d),/Бюджет на вход для всех: до 500/);
  await d.click('Показать результаты');await d.click('Подробнее 1');assert.match(text(d),/500 ₽ за всех/);
  await d.click('К результатам');await d.click('Показать варианты для проверки');await d.click('Подробнее 3');assert.match(text(d),/Итого неизвестно.*400 ₽/);
  await d.click('К результатам');await d.click('Город');await d.say('екб');assert.equal(state(d).optIn,false);assert.deepEqual(state(d).cards,[]);assert.match(text(d),/Екатеринбург/);
  await d.restart();await d.say('/saved');await d.click('Открыть 1');assert.match(text(d),/Казань · 1 взр., 0 дет/);assert.match(text(d),/200 ₽/);
  await d.say('/delete_data');await d.click('Да, удалить');assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as any).n,0);
  const values=d.runtime.store.db.prepare("SELECT payload FROM outbox WHERE actor=? AND purpose LIKE 'culture%' AND payload IS NOT NULL").all(ACTOR) as {payload:string}[];
  assert(values.every(v=>!v.payload.includes('возраст: 7')));assert(!JSON.stringify(state(d)).includes('childAges\":[7]'));
});
test('C16 actual wrong message ownership and bot-origin input never mutate the flow',async t=>{
  const d=await setup(t);await d.enter();const revision=getState(d.runtime.store,ACTOR)!.revision;
  const v=callback('', 'wrong-mid',ACTOR,d.now+1);v.callback.payload=d.payload('Подобрать');v.message.body.mid='untracked';await d.post(v);await d.drain();assert.equal(getState(d.runtime.store,ACTOR)!.revision,revision);
  const bot=reply(undefined,d.now+1,'Казань',ACTOR,'bot-loop');bot.message.sender!.is_bot=true;assert.equal((await (await d.post(bot)).json()).status,'ignored');
  await d.press(d.payload('Подобрать'),OTHER);assert.equal(getState(d.runtime.store,ACTOR)!.revision,revision);
});
test('C16 legacy SQLite v2 and single-adult bookmark keep exact historical query, generation, provenance after migration',async t=>{
  const d=await setup(t);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Сохранить');
  const row=d.runtime.store.db.prepare('SELECT * FROM bookmarks').get() as {data:string;identity:string;generation:string};
  const c=JSON.parse(row.data);delete c.query.version;delete c.query.party;delete c.query.timezone;delete c.query.budgetBasis;delete c.visit.partyPrice;delete c.visit.tariffs;
  const original=JSON.stringify(c);d.runtime.store.db.prepare('UPDATE bookmarks SET data=?').run(original);
  const path=d.config.databasePath;await d.close();const legacy=new Database(path);legacy.exec('DROP TABLE flow_screens; DROP TABLE ui_messages; DROP INDEX bookmarks_save_action; DROP INDEX bookmarks_order; ALTER TABLE bookmarks DROP COLUMN save_action; PRAGMA user_version=2');legacy.close();
  await d.restart();assert.equal(d.runtime.store.db.pragma('user_version',{simple:true}),4);await d.say('/start');await d.click('Подобрать');await d.say('екб');await d.say('/saved');await d.click('Открыть 1');
  assert.match(text(d),/Казань · 1 взр., 0 дет/);assert.match(text(d),/на одного взрослого/);
  const after=d.runtime.store.db.prepare('SELECT * FROM bookmarks').get() as typeof row;assert.equal(after.data,original);assert.equal(after.identity,row.identity);assert.equal(after.generation,row.generation);
});
