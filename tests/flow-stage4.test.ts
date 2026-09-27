import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { flowDriver, chooseDefaults } from '../scripts/flow-driver.js';
import { flowFixture } from '../src/culture/fixture.js';
import { getState } from '../src/culture/flow.js';
import { ACTOR, OTHER } from './fixtures.js';
import { LiveMax, validateOperation } from '../src/max.js';
import { Worker } from '../src/worker.js';

async function setup(t: TestContext, input = visit()) {
  const root = resolve('.tmp/stage4-flow'); mkdirSync(root,{recursive:true});
  const dir = mkdtempSync(resolve(root,'case-'));
  const d = await flowDriver(resolve(dir,'flow.sqlite'),input);
  t.after(async()=>{await d.close(); assert(dir.startsWith(root+sep)); rmSync(dir,{recursive:true});});
  return d;
}
function visit() {
  const s=flowFixture(), e=s.events[0]!;
  e.price={kind:'EXACT',amount:200,lowerBound:null,currency:'RUB',applicability:'SINGLE_ADULT',evidence:'200 рублей — взрослый билет',conditions:['Билет на одну выставку']};
  e.admission.registration='REQUIRED'; e.admission.conditions=['Запись на сайте до посещения'];
  const o=e.occurrences[0]!;
  o.opening=Array.from({length:7},(_,weekday)=>({weekday,open:600,close:1080,lastEntry:1050}));
  const v=s.venues.find(v=>v.id===o.venueId)!; v.title='Вымышленный зал';v.address='Казань, Тестовая улица, 17';
  return s;
}
type Driver=Awaited<ReturnType<typeof setup>>;
const screen=(d:Driver)=>d.screen()!.body.text;
const state=(d:Driver)=>JSON.parse(getState(d.runtime.store,ACTOR)!.data);
const count=(d:Driver,actor=ACTOR)=>(d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(actor) as {n:number}).n;

test('R08-01: projection → render → save → restart сохраняет существенные условия посещения',async t=>{
  const d=await setup(t);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');
  const check=()=>{
    for(const pattern of [/Вымышленный зал/,/Тестовая улица, 17/,/10:00.*18:00/,/12:00.*18:00/,/Последний вход.*17:30/,/200.*₽/,/Регистрация.*обязательна/,/Запись на сайте/,/Вымышленный набор/]) assert.match(screen(d),pattern);
  };
  check(); const identity=state(d).cards[0].identity;await d.click('Сохранить');await d.restart();await d.say('/saved');await d.click('Открыть 1');check();
  const saved=d.runtime.store.db.prepare('SELECT identity,data FROM bookmarks').get() as {identity:string;data:string};
  assert.notEqual(saved.identity,identity);assert.equal(JSON.parse(saved.data).identity,identity);
  assert.equal(state(d).cards[0].occurrence.start,null);
});

test('R08-02: Назад из custom при первичном вводе не превращает его в редактирование',async t=>{
  const d=await setup(t);await d.enter();await d.click('Подобрать'); await d.click('Казань');
  for(const [custom,choice,next] of [['Другая дата','Завтра','time'],['Другое время','12:00–18:00','party'],['Другая сумма','До 500 ₽','interest']]) {
    await d.click(custom!); const old=d.payload('Назад');await d.click('Назад');await d.click(choice==='Завтра'?d.dateLabel('Завтра'):choice!);
    assert.equal(state(d).stage,next); assert.equal(state(d).editing,false);await d.press(old);assert.equal(state(d).stage,next);if(next==='party')await d.click('Продолжить');
  }
});

test('R08-02: Назад при редактировании даты/времени/бюджета сохраняет возврат к сводке и binding ввода',async t=>{
  const d=await setup(t);await d.enter();await chooseDefaults(d);await d.click('Показать варианты для проверки');
  for(const [field,custom,choice] of [['Дата','Другая дата','Завтра'],['Время','Другое время','12:00–18:00'],['Бюджет','Другая сумма','До 500 ₽']]) {
    await d.click(field!);await d.click(custom!);const token=state(d).input.token;await d.click('Назад');await d.click(custom!);
    await d.say(`${token} 500`);assert.equal(state(d).stage,'input');assert.match(screen(d),/код.*ниже|Код ввода устарел|Исправьте ответ/i);
    await d.click('Назад');await d.click(choice==='Завтра'?d.dateLabel('Завтра'):choice!);assert.equal(state(d).stage,'summary');assert.equal(state(d).optIn,true);
  }
});

test('R08-03: интерес ранжирует несколько категорий при одинаковых обязательных условиях',async t=>{
  const s=visit(), first=s.events[0]!, other=structuredClone(first);
  first.categories=['exhibition'];other.id='synthetic:flow:theater';other.title='СИНТЕТИКА: театр';other.categories=['theater'];
  other.occurrences.forEach((o,i)=>{o.id=`${other.id}:${i}`;});s.events=[first,other];s.stats.normalizedEvents=2;s.stats.occurrences=2;
  const d=await setup(t,s);await d.enter();await chooseDefaults(d);await d.click('Тема');await d.click('Театр');await d.click('Показать результаты');
  assert.deepEqual(state(d).cards.map((c:any)=>c.eventId),[other.id,first.id]);
  assert.equal(state(d).cards[0].query.category,null);assert.deepEqual(state(d).cards[0].query.preferences.categories,['theater']);
  const before=structuredClone(state(d).cards[0].query);
  await d.click('Показать варианты для проверки');await d.click('Тема');await d.click('Любая тема');
  assert.equal(state(d).draft.category,null);assert.equal(state(d).optIn,false);
  await d.click('Показать результаты');const after=state(d).cards[0].query;
  assert.equal(after.category,null);assert.deepEqual(after.preferences.categories,[]);
  for(const key of ['start','end','budgetRub','party','city'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(new Set(state(d).cards.map((c:any)=>c.eventId)),new Set([first.id,other.id]));
});

test('R08-04: текущее подтверждение стирания доходит через worker один раз, прежние payload очищены',async t=>{
  const d=await setup(t);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');const oldSave=d.payload('Сохранить');await d.click('Сохранить');
  await d.enter(OTHER);for(const label of ['Подобрать','Казань','Завтра','12:00–18:00','Продолжить','До 500 ₽','Любая тема','Показать результаты','Подробнее 1','Сохранить','Мои события']) await d.click(label==='Завтра'?d.dateLabel('Завтра',OTHER):label,OTHER);
  const otherState=getState(d.runtime.store,OTHER)!.data;
  await d.say('/delete_data');const confirm=d.payload('Да, удалить');
  const previous=(d.runtime.store.db.prepare('SELECT max(id) n FROM outbox').get() as any).n;
  await d.press(confirm,ACTOR,'erase-current');await d.press(confirm,ACTOR,'erase-current');
  assert.equal(d.operations.filter(o=>o.method==='answers'&&o.callbackId==='erase-current').length,1);
  assert.equal(count(d),0);assert.equal(count(d,OTHER),1);assert(!getState(d.runtime.store,ACTOR));assert.equal(getState(d.runtime.store,OTHER)!.data,otherState);
  assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM outbox WHERE actor=? AND id<=? AND (payload IS NOT NULL OR finished_at IS NULL)').get(ACTOR,previous) as any).n,0);
  await d.press(oldSave);assert.equal(count(d),0);
  await d.say('/start');await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Сохранить');await d.press(confirm);assert.equal(count(d),1);
});

test('R08-04: semantic false у текущего erasure ACK не становится успешной отправкой',async t=>{
  const d=await setup(t);await d.enter();await d.say('/delete_data');
  await d.press(d.payload('Да, удалить'),ACTOR,'erase-semantic',d.now+1,false);
  const calls:string[]=[];
  const config={...d.config,mode:'live' as const,token:'synthetic-only-token-123'};
  const max=new LiveMax(config,(async(u:unknown)=>{calls.push(String(u));return new Response('{"success":false}');}) as typeof fetch);
  const worker=new Worker(d.runtime.store,config,max,()=>d.now,undefined,d.catalog);await worker.tick();
  assert.equal(calls.length,1);assert.match(calls[0]!,/answers\?callback_id=erase-semantic/);
  assert.equal((d.runtime.store.db.prepare("SELECT status FROM outbox WHERE purpose='culture_erasure' AND result='SEMANTIC' ORDER BY id DESC LIMIT 1").get() as any).status,'FAILED_SEMANTIC');
});

test('R08-01: отсутствующий адрес явно неизвестен и остаётся таким после сохранения',async t=>{
  const s=visit();s.venues[0]!.address=null;const d=await setup(t,s);await d.enter();await chooseDefaults(d);await d.click('Показать варианты для проверки');await d.click('Подробнее 1');
  assert.match(screen(d),/Адрес неизвестен/);await d.click('Сохранить');await d.restart();await d.say('/saved');await d.click('Открыть 1');assert.match(screen(d),/Адрес неизвестен/);
});

test('R08-01: длинные допустимые поля полностью доступны постранично и сохраняются без обрезки',async t=>{
  const s=visit(), e=s.events[0]!;e.sourceLabel='Источник синтетики '+ 'Я'.repeat(100);
  e.price.conditions=['Начало '+ 'Ц'.repeat(3900)+' КОНЕЦ_ТАРИФА'];e.admission.conditions=['А'.repeat(3900)+' КОНЕЦ_ДОПУСКА'];
  s.venues[0]!.address='Б'.repeat(3900)+' КОНЕЦ_АДРЕСА';
  const d=await setup(t,s);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');
  assert.match(screen(d),/Последний вход.*17:30/);assert.match(screen(d),/Регистрация.*обязательна/);
  await d.click('Сохранить');await d.restart();await d.say('/saved');await d.click('Открыть 1');await d.click('Условия посещения');
  let all=screen(d), pages=1;
  while(d.buttons().some(b=>b.text==='Далее условия')) {assert(pages++<40);await d.click('Далее условия');all+='\n'+screen(d);}
  for(const marker of ['КОНЕЦ_ТАРИФА','КОНЕЦ_ДОПУСКА','КОНЕЦ_АДРЕСА']) assert(all.includes(marker));
  d.operations.forEach(validateOperation);
});

test('R08-01: прежняя закладка не получает выдуманных полей из текущего каталога',async t=>{
  const d=await setup(t);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Сохранить');
  const row=d.runtime.store.db.prepare('SELECT data FROM bookmarks').get() as {data:string};const old=JSON.parse(row.data);delete old.visit;
  d.runtime.store.db.prepare('UPDATE bookmarks SET data=?').run(JSON.stringify(old));await d.restart();await d.say('/saved');await d.click('Открыть 1');
  assert.match(screen(d),/Старая закладка/);assert.doesNotMatch(screen(d),/Регистрация: обязательна|Последний вход:.*17:30|Вымышленный зал/);
});

test('R08-01: сеанс отображается как сеанс с точным окончанием, не как часы открытия',async t=>{
  const s=visit(),o=s.events[0]!.occurrences[0]!;
  o.kind='TIMED_SESSION';o.start='2030-04-06T10:00:00Z';o.end='2030-04-06T11:30:00Z';o.endBasis='PUBLISHED';o.opening=null;
  const d=await setup(t,s);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');assert.match(screen(d),/📅.*13:00.*14:30/);assert.doesNotMatch(screen(d),/Пересечение с запросом/);
});
