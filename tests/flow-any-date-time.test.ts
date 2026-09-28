import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {flowDriver} from '../scripts/flow-driver.js';
import {anyFixture,combinedJourney} from '../scripts/any-date-time-scenario.js';
import {state,savedRows,search,type Driver} from '../scripts/bookmark-scenario.js';
import {getState} from '../src/culture/flow.js';
import {type DatePreference,type TimePreference,plannedQueries,type SearchQuery} from '../src/data/temporal.js';
import {cities,cityInstant,cityDate,type CityKey} from '../src/data/cities.js';
import {type Card} from '../src/culture/card.js';
import {Catalog} from '../src/culture/catalog.js';
import {select} from '../src/data/select.js';
import {validateSnapshot} from '../src/data/contract.js';
import {snapshotDigest,factualScope} from '../src/data/source-policy.js';
import {ACTOR} from './fixtures.js';

const any={mode:'ANY'} as const,day=(date='2030-04-06'):DatePreference=>({mode:'SPECIFIC',date});
const hours=(from='12:00',until='18:00'):TimePreference=>({mode:'SPECIFIC',from,until});
const text=(d:Driver)=>d.screen()!.body.text;
const path=()=>{mkdirSync('.tmp/any-date-time',{recursive:true});return resolve(mkdtempSync(resolve('.tmp/any-date-time/case-')),'disposable.sqlite');};
async function setup(t:TestContext,input:unknown=anyFixture(),clock?:number,real=false,review:unknown=null) {
  const d=await flowDriver(path(),input,clock,real,review);t.after(()=>d.close());return d;
}
// Только одноразовая БД: пропускаем неизменённые вопросы состава/бюджета.
async function summary(d:Driver,date:DatePreference,time:TimePreference,city:CityKey='kzn') {
  if(!getState(d.runtime.store,ACTOR))await d.enter();
  const s=state(d);s.stage='summary';s.editing=false;s.cards=[];delete s.selected;delete s.editBase;delete s.input;
  s.draft={...s.draft,city,date,time};
  d.runtime.store.db.prepare('UPDATE flow_states SET data=? WHERE actor=?').run(JSON.stringify(s),ACTOR);
  await d.enter();await d.click('Продолжить подбор');
}

test('ANY: сквозной PUBLIC HTTP → worker → renderer → SQLite → конкретная закладка → restart; отдельная дата + ANY_TIME',async t=>{
  const d=await flowDriver(path(),anyFixture(),undefined,false,null,true);t.after(()=>d.close());
  const frames=await combinedJourney(d);assert.equal(frames.length,9);
  assert(d.operations.some(o=>o.method==='messages'));assert(d.operations.some(o=>o.method==='edit'));
});

test('ANY: четыре независимых сочетания, будущая дата дальше завтра, одно событие в списке и неизменность прочих фильтров',async t=>{
  const s=anyFixture(),ids=s.events.map(e=>e.id),cases:[DatePreference,TimePreference,string[]][]=[
    [day(),hours(),[ids[0]!]], [day(),any,[ids[1]!,ids[0]!]],
    [any,hours(),[ids[0]!,ids[2]!]], [any,any,[ids[1]!,ids[0]!,ids[2]!]],
  ];
  const d=await setup(t,s);
  for(const [date,time,expected] of cases) {
    await summary(d,date,time);await d.click('Показать результаты');
    const cards=state(d).cards as Card[];assert.deepEqual(cards.map(c=>c.eventId),expected);
    assert.equal(new Set(cards.map(c=>c.eventId)).size,cards.length);
    for(const c of cards){assert.equal(c.query.budgetRub,500);assert.deepEqual(c.query.party,{adults:1,childAges:[]});assert.equal(c.kind,'STRICT');}
    if(date.mode==='ANY')assert.match(text(d),/Дата: любая/);
    if(time.mode==='ANY')assert.match(text(d),/Время: любое/);
    if(date.mode==='ANY')assert.equal(cityDate(cards.find(c=>c.eventId===ids[2])!.visit!.from!,cities.kzn.timezone),'2030-04-08');
  }
  // Валидная явная дата вне покрытия остаётся явной, с прежним честным ответом.
  await summary(d,day('2040-02-29'),any);await d.click('Показать результаты');assert.match(text(d),/данных нет/);assert.equal(state(d).cards.length,0);
  assert.deepEqual(state(d).draft.date,day('2040-02-29'));
});

test('ANY: финальная минута, граница дня и опубликованный overnight; отдельное ночное окно на каждой дате в обеих зонах',async t=>{
  for(const city of ['kzn','ekb'] as const) {
    const s=anyFixture(city),zone=cities[city].timezone,base=structuredClone(s.events[1]!);
    const specs=[['late','2030-04-06','23:59','2030-04-07','01:00'],['future','2030-04-08','23:30','2030-04-09','01:00'],
      ['gap','2030-04-07','13:00','2030-04-07','14:00'],['boundary','2030-04-07','00:00','2030-04-07','00:30']];
    s.events=specs.map(([id,startDate,start,endDate,end])=>{
      const e=structuredClone(base);e.id='synthetic:night:'+id;e.occurrences=[{...e.occurrences[0]!,id:e.id+':session',start:cityInstant(startDate!,start!,zone),end:cityInstant(endDate!,end!,zone)}];
      if(id==='late')e.occurrences[0]!.start=new Date(Date.parse(e.occurrences[0]!.start!)+30000).toISOString();return e;
    });s.stats.normalizedEvents=s.events.length;s.stats.occurrences=s.events.length;
    const d=await setup(t,s);await summary(d,day(),any,city);await d.click('Показать результаты');
    assert.deepEqual(state(d).cards.map((c:Card)=>c.eventId),['synthetic:night:late']);await d.click('Подробнее 1');
    assert.match(text(d),/Сеанс: 23:59–7 апреля 2030 г\. · 01:00/);await d.click('Сохранить');
    const saved=savedRows(d)[0]!;assert.equal(JSON.parse(saved.data).visit.from,s.events[0]!.occurrences[0]!.start);
    await summary(d,any,hours('23:00','01:10'),city);await d.click('Показать результаты');
    assert.deepEqual(state(d).cards.map((c:Card)=>c.eventId),['synthetic:night:late','synthetic:night:boundary','synthetic:night:future']);
    await summary(d,day(),hours('23:00','23:59'),city);await d.click('Показать результаты');assert.equal(state(d).cards.length,0);
    assert.deepEqual(savedRows(d),[saved]);
  }
});

test('ANY: общий UTC-clock даёт правильный местный день в Казани/Екатеринбурге; окон без ограничения с 12–18 нет',async t=>{
  const now=Date.parse('2030-04-05T20:00:00Z');
  for(const city of ['kzn','ekb'] as const) {
    const s=anyFixture(city),e=s.events[1]!;e.occurrences=[{...e.occurrences[0]!,start:'2030-04-05T20:30:00Z',end:'2030-04-05T21:30:00Z'}];
    s.events=[e];s.stats.normalizedEvents=1;s.stats.occurrences=1;
    const d=await setup(t,s,now);await summary(d,any,any,city);await d.click('Время');
    assert.match(text(d),new RegExp('Любая дата · '+cities[city].name));assert.match(text(d),city==='kzn'?/UTC\+3/:/UTC\+5/);
    await d.click('Назад');await d.click('Показать результаты');await d.click('Подробнее 1');
    assert.match(text(d),city==='kzn'?/5 апреля 2030 г\. · Сеанс: 23:30–6 апреля 2030 г\. · 00:30/:/6 апреля 2030 г\. · Сеанс: 01:30–02:30/);
  }
});

test('ANY: Back, custom Back, отмена edit, restart, opt-in и старое dateBack без сброса диалога',async t=>{
  const d=await setup(t);await d.enter();await d.click('Подобрать');await d.click('Казань');
  assert(d.buttons().some(b=>b.text==='Другая дата'));await d.click('Любая дата');
  assert.equal(state(d).draft.date.mode,'ANY');assert(!d.buttons().some(b=>b.text==='Другая дата'));
  await d.click('Другое время');await d.click('Назад');assert.equal(state(d).stage,'time');await d.click('Назад');assert.match(text(d),/Выбрано: любая/);
  await d.click('Другая дата');await d.click('Назад');assert.equal(state(d).stage,'date');await d.click('Любая дата');
  const obsolete=d.payload('Назад');d.runtime.store.db.prepare("UPDATE flow_actions SET purpose='dateBack' WHERE id=?").run(obsolete.slice(3));
  const before=getState(d.runtime.store,ACTOR)!;await d.press(obsolete);assert.deepEqual(getState(d.runtime.store,ACTOR),before);
  assert.match((d.operations.at(-1) as any).body.notification,/устарела/);
  await d.click('Любое время');await d.click('Продолжить');await d.click('До 500 ₽');await d.click('Любая тема');await d.click('Показать результаты');await d.click('Показать варианты для проверки');
  const committed=structuredClone(state(d));
  for(const field of ['Дата','Время']) {
    await d.click(field);assert.equal(state(d).optIn,true);await d.click(field==='Дата'?'Другая дата':'Другое время');await d.click('Назад');await d.click('Назад');
    assert.deepEqual(state(d).draft,committed.draft);assert.equal(state(d).optIn,true);assert.deepEqual(state(d).cards,committed.cards);
  }
  await d.restart();assert.deepEqual(state(d).draft,committed.draft);
  await d.click('Дата');await d.click(d.dateLabel('Завтра'));assert.deepEqual(state(d).draft.date,day());assert.equal(state(d).draft.time.mode,'ANY');assert.equal(state(d).optIn,false);assert.equal(state(d).cards.length,0);
  await d.click('Время');await d.click('Другое время');await d.say(state(d).input.token+' 07:15-09:45');
  assert.deepEqual(state(d).draft.time,hours('07:15','09:45'));assert.equal(d.screen()!.method,'messages');
  await d.click('Дата');await d.click('Любая дата');assert.deepEqual(state(d).draft.time,hours('07:15','09:45'));
  await d.click('Время');await d.click('Любое время');assert.deepEqual(state(d).draft,{...committed.draft});
});

test('ANY: отсутствие времени/цены, stale, возраст, бюджет и карантин не становятся строгими совпадениями',async t=>{
  for(const defect of ['opening','end','start','price','stale','age','budget']) {
    const s=anyFixture(),e=structuredClone(s.events[defect==='opening'?0:1]!);
    e.occurrences=[e.occurrences[0]!];
    if(defect==='opening'){e.occurrences[0]!.opening=null;e.occurrences[0]!.scheduleBasis='UNKNOWN';}
    if(defect==='end'||defect==='start'){e.occurrences[0]!.end=null;e.occurrences[0]!.endBasis='UNKNOWN';if(defect==='start')e.occurrences[0]!.start=null;}
    if(defect==='price'){e.tariffs=[];e.price={...e.price,kind:'UNKNOWN',amount:null,lowerBound:null};}
    if(defect==='stale'){e.retrievedAt='2030-04-01T00:00:00Z';e.observations.forEach(o=>o.retrievedAt=e.retrievedAt);}
    if(defect==='age')e.admission.requirements!.minimumAge=18;
    if(defect==='budget'){e.tariffs=[];e.price.kind='EXACT';e.price.amount=2000;}
    s.events=[e];s.stats.normalizedEvents=1;s.stats.occurrences=1;
    const d=await setup(t,s);await summary(d,any,any);
    if(defect==='age'){const value=state(d);value.draft.party.childAges=[7];d.runtime.store.db.prepare('UPDATE flow_states SET data=? WHERE actor=?').run(JSON.stringify(value),ACTOR);}
    await d.click('Показать результаты');assert.equal(state(d).cards.length,0,defect);await d.click('Показать варианты для проверки');
    const cards=state(d).cards as Card[];assert(cards.every(c=>c.kind==='UNCERTAIN'),defect);assert.equal(cards.length,['age','budget'].includes(defect)?0:1,defect);
    if(defect==='start'){await d.click('Подробнее 1');assert.match(text(d),/Дата и начало сеанса неизвестны/);assert.doesNotMatch(text(d),/📅 5 апреля/);}
  }
  const s=anyFixture(),q:SearchQuery={city:'kzn',date:any,time:any,budgetRub:500,category:null,zone:null,kind:'ANY',preferences:{categories:[]}};
  const r=select(s,q,new Date('2030-04-05T06:00:00Z'),true,true,s.events.map(e=>({eventId:e.id,status:'QUARANTINED'})) as any);
  assert.equal(r.strictTotal,0);assert.equal(r.uncertainTotal,0);assert.equal(r.excluded.SOURCE_IDENTITY_CONFLICT,3);
  // Даже очень большой scope не превращается в бесконечный перебор дней.
  s.scope.end='2099-01-01T00:00:00Z';const plans=[...plannedQueries(q,s,s.events[0]!.occurrences[0],Date.parse('2030-04-05T06:00:00Z'))];assert(plans.length<=16);
});

test('ANY: равный конкретный вариант не дублируется; новый день/интервал/состав независимы; legacy draft и записи сохраняются',async t=>{
  const d=await setup(t);await summary(d,any,any);await d.click('Тема');await d.click('Выставки');await d.click('Показать результаты');await d.click('Подробнее 1');await d.click('Сохранить');
  const saved=savedRows(d)[0]!;
  await search(d,{category:'Выставки',date:'2030-04-06',time:'10:00-20:00'});await d.click('Подробнее 1');assert(d.buttons().some(b=>b.text==='✅ Сохранено'));assert.deepEqual(savedRows(d),[saved]);
  for(const opts of [{date:'2030-04-07',time:'10:00-20:00'},{date:'2030-04-06',time:'11:00-18:00'},{date:'2030-04-06',time:'10:00-20:00',adults:2}]) {
    await search(d,{category:'Выставки',...opts});await d.click('Подробнее 1');await d.click('Сохранить');
  }
  assert.equal(savedRows(d).length,4);
  await summary(d,any,any);await d.click('Тема');await d.click('Концерты');await d.click('Показать результаты');await d.click('Подробнее 1');await d.click('Сохранить');
  await search(d,{category:'Концерты',date:'2030-04-06',time:'07:00-10:00',adults:2});await d.click('Подробнее 1');assert(d.buttons().some(b=>b.text==='✅ Сохранено'));assert.equal(savedRows(d).length,5);
  const original=structuredClone(JSON.parse(saved.data));delete original.proposedVisit;delete original.visit;delete original.categories;
  d.runtime.store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(ACTOR,'legacy-id','legacy-generation',d.now,JSON.stringify(original));
  const rows=savedRows(d),s=state(d);s.stage='summary';s.draft={city:'kzn',date:'2030-04-08',from:'13:00',until:'15:00',budget:500,category:'theater'};
  d.runtime.store.db.prepare('UPDATE flow_states SET data=? WHERE actor=?').run(JSON.stringify(s),ACTOR);await d.restart();await d.enter();await d.click('Продолжить подбор');
  assert.deepEqual(state(d).draft.date,day('2030-04-08'));assert.deepEqual(state(d).draft.time,hours('13:00','15:00'));assert.match(text(d),/Дата: 8 апреля 2030/);
  await d.say('/saved');await d.click('Открыть 1');assert.match(text(d),/Старая закладка/);assert.deepEqual(savedRows(d),rows);
});

test('ANY: reviewed refresh не переносит предложенный визит; без review факты не показываются',async t=>{
  const active=Catalog.load({flowDataMode:'real',snapshotPath:resolve('catalog/real/e9f43ed9d1fd3c408584.json'),reviewPath:resolve('catalog/real/e9f43ed9d1fd3c408584.review.json')} as any),now=Date.parse(active.review!.reviewedAt)+1000;
  const snapshots=structuredClone(active.availableCities.map(c=>active.forCity(c)!)),s=snapshots.find(s=>s.scope.city==='ekb')!;
  s.events=s.events.filter(e=>e.id==='mie:azins_magic_of_name');s.stats.normalizedEvents=1;s.stats.occurrences=s.events[0]!.occurrences.length;
  const review=()=>({version:1,scope:'ADMITTED_TESTERS_FACTS',factualScope,reviewedAt:new Date(now).toISOString(),entries:snapshots.map(s=>({snapshotHash:snapshotDigest(validateSnapshot(s)),sources:[...new Set(s.events.map(e=>e.provider))],basis:'institution-facts/1',validUntil:new Date(Date.parse(s.retrievedAt)+s.freshnessHours*3600000).toISOString()}))});
  const d=await setup(t,{snapshots},now,true,review());await summary(d,any,any,'ekb');await d.click('Показать результаты');await d.click('Подробнее 1');await d.click('Сохранить');const saved=savedRows(d)[0]!,card=JSON.parse(saved.data) as Card;
  assert(card.proposedVisit);const dayBefore=cityDate(card.visit!.from!,cities.ekb.timezone);
  // Новый срез закрывает именно сохранённый день; следующий открытый день не подставляется.
  s.events[0]!.occurrences.find(o=>o.id===card.occurrenceId)!.closedDates=[dayBefore];
  const folder=resolve(mkdtempSync(resolve('.tmp/any-date-time/refresh-'))),snapshotPath=resolve(folder,'snapshot.json'),reviewPath=resolve(folder,'review.json');
  writeFileSync(snapshotPath,JSON.stringify({snapshots}));writeFileSync(reviewPath,JSON.stringify(review()));d.config.reviewPath=reviewPath;
  await d.reloadCatalog(snapshotPath);await d.say('/saved');await d.click('Открыть 1');assert.match(text(d),/Больше не подходит/);assert.deepEqual(savedRows(d),[saved]);
  assert(text(d).includes('Выбрано:'));assert(text(d).includes(String(Number(dayBefore.slice(8,10)))));
  d.catalog.replace({snapshots:[{...s,events:s.events.map(e=>({...e,title:'Изменённый источник без допуска'}))}]});
  await summary(d,any,any,'ekb');await d.click('Показать результаты');assert.equal(state(d).cards.length,0);assert.match(text(d),/показ не разрешён/);assert.doesNotMatch(text(d),/Изменённый источник/);
});
