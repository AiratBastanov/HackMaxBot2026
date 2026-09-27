import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {Worker as Thread} from 'node:worker_threads';
import {flowDriver} from '../scripts/flow-driver.js';
import {variantsFixture,search,savedRows,state,type Driver} from '../scripts/bookmark-scenario.js';
import {compactFixture} from '../src/culture/compact-fixture.js';
import {getState,makeQuery} from '../src/culture/flow.js';
import {themeLabels} from '../src/culture/preferences.js';
import {equivalentChoice,saveBookmark} from '../src/culture/bookmark.js';
import {cardPrice,type Card} from '../src/culture/card.js';
import {ACTOR,OTHER} from './fixtures.js';
import {validateOperation} from '../src/max.js';

const path=()=>{mkdirSync('.tmp/flow-corrections',{recursive:true});return resolve(mkdtempSync(resolve('.tmp/flow-corrections/case-')),'disposable.sqlite');};
async function setup(t:TestContext,input:unknown=variantsFixture(),clock?:number) {
  const d=await flowDriver(path(),input,clock);t.after(()=>d.close());return d;
}
const text=(d:Driver)=>d.screen()!.body.text;
const rows=(d:Driver)=>savedRows(d);
function themeFixture() {
  const f=variantsFixture();
  for(const category of ['workshop','tour']){const e=structuredClone(f.events[2]!);e.id='synthetic:'+category;e.title='СИНТЕТИКА: '+category;e.categories=[category];e.sourceUrl='https://example.org/'+category;e.occurrences[0]!.id=e.id+':session';f.events.push(e);}
  f.stats.normalizedEvents=f.events.length;f.stats.occurrences=f.events.flatMap(e=>e.occurrences).length;return f;
}

test('R27 темы: каждая кнопка → canonical preference → сводка → ранжирование → edit → restart, Любая явно очищает',async t=>{
  const d=await setup(t,themeFixture());
  for(const [key,label] of [...Object.entries(themeLabels),['','Любая тема']]) {
    await search(d,{category:label});assert.equal(state(d).draft.category,key||null);
    assert.match(text(d),new RegExp('Тема: '+label));assert.deepEqual(makeQuery(state(d).draft).preferences?.categories,key?[key]:[]);
    assert.equal(makeQuery(state(d).draft).category,null);
    if(key)assert(state(d).cards[0].categories.includes(key));
    await d.click('Тема');assert.match(text(d),new RegExp('Выбрано: '+label));await d.click('Назад');
    assert.equal(state(d).stage,'summary');assert.equal(state(d).draft.category,key||null);
    await d.click('Тема');await d.click(label!);await d.restart();assert.equal(state(d).draft.category,key||null);
    await d.click('Главная');await d.click('Продолжить подбор');assert.match(text(d),new RegExp('Тема: '+label));
  }
  await d.click('Тема');await d.click('Экскурсии');await d.click('Тема');await d.click('Любая тема');assert.equal(state(d).draft.category,null);
});

test('R27 точные копии запрещены; бюджет/тема/окно сеанса не создают запись, иной сеанс/дата/состав сохраняются',async t=>{
  const d=await setup(t);
  await search(d,{category:'Концерты'});await d.click('Подробнее 1');const firstSave=d.payload('Сохранить');
  await Promise.all([d.press(firstSave,ACTOR,'same-delivery',d.now+1,false),d.press(firstSave,ACTOR,'same-delivery',d.now+1,false)]);await d.drain();assert.equal(rows(d).length,1);
  const first=rows(d)[0]!;await d.press(firstSave);assert.equal(rows(d).length,1);
  await d.click('✅ Сохранено');assert.equal(state(d).bookmark.identity,first.identity);
  await search(d,{category:'Концерты',time:'11:00-14:30'});await d.click('Бюджет');await d.click('До 1000 ₽');await d.click('Показать результаты');await d.click('Подробнее 1');
  assert(d.buttons().some(b=>b.text==='✅ Сохранено'));assert.equal(rows(d).length,1);
  const card=state(d).cards.find((c:Card)=>c.identity===state(d).selected) as Card;
  assert(equivalentChoice(JSON.parse(first.data),{...card,fingerprint:'changed',snapshotVersion:'changed',retrievedAt:'2040-01-01T00:00:00Z'}));
  // Старая кнопка прежнего renderer всё ещё purpose=save: операция обязана быть честной.
  const id=d.payload('✅ Сохранено').slice(3);d.runtime.store.db.prepare("UPDATE flow_actions SET purpose='save',data='\"\"' WHERE id=?").run(id);
  await d.press('cp:'+id);assert.match(text(d),/Уже сохранено/);assert.deepEqual(rows(d),[first]);await d.press('cp:'+id);
  const answer=d.operations.filter(o=>o.method==='answers').at(-1)!;assert.equal(answer.method,'answers');assert.match(answer.body.notification,/уже обработано/);
  for(const options of [{category:'Концерты',time:'15:00-18:00'},{category:'Театр'},{category:'Выставки',date:'2030-04-07'},{category:'Выставки',adults:2,childAge:7}]) {
    await search(d,options);await d.click('Подробнее 1');await d.click('Сохранить');
  }
  assert.equal(rows(d).length,5);assert.equal(new Set(rows(d).map(b=>b.identity)).size,5);assert.deepEqual(rows(d).find(b=>b.identity===first.identity),first);
});

test('R27 flexible choice не зависит от текущего clock, семейные возраста нормализованы, legacy copies не сливаются',async t=>{
  const clock=Date.parse('2030-04-05T10:01:00Z'),d=await setup(t,variantsFixture(),clock);
  await search(d,{date:'2030-04-05'});await d.click('Подробнее 1');await d.click('Сохранить');const first=rows(d)[0]!;
  d.advance(120000);await search(d,{date:'2030-04-05'});await d.click('Подробнее 1');assert(d.buttons().some(b=>b.text==='✅ Сохранено'));
  const c=JSON.parse(first.data) as Card,p=structuredClone(c);p.query.party={adults:2,childAges:[7,null,4]};const q=structuredClone(p);q.query.party!.childAges.reverse();assert(equivalentChoice(p,q));
  // Ранее намеренно созданная идентичная копия сохраняет каждый байт и собственную generation.
  d.runtime.store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(ACTOR,'legacy-copy','legacy-generation',d.now,first.data);
  const before=rows(d);await d.restart();assert.deepEqual(rows(d),before);await d.say('/saved');await d.click('Удалить 1');await d.click('Да, удалить');
  assert.deepEqual(rows(d),[first]);assert.equal(d.runtime.store.db.pragma('user_version',{simple:true}),4);
});

test('R27 BEGIN IMMEDIATE: конкурирующие SQLite writers возвращают одну новую запись без unique-индекса по варианту',async t=>{
  const d=await setup(t);await search(d);const card=state(d).cards[0] as Card,shared=new SharedArrayBuffer(4),flag=new Int32Array(shared);
  const source=`const {workerData,parentPort}=require('node:worker_threads');(async()=>{const {Storage}=await import(workerData.storage);const {saveBookmark}=await import(workerData.bookmark);const s=new Storage(workerData.path,workerData.config,false);parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);try{const r=saveBookmark(s,workerData.actor,workerData.card,workerData.action,workerData.now);parentPort.postMessage(r.kind);}finally{s.close();}})().catch(e=>{throw e});`;
  const ready:Promise<void>[]=[],completed:Promise<string>[]=[];
  for(let i=0;i<4;i++){
    const w=new Thread(source,{eval:true,workerData:{storage:new URL('../src/storage.js',import.meta.url).href,bookmark:new URL('../src/culture/bookmark.js',import.meta.url).href,path:d.config.databasePath,
      config:{mode:'local',botId:d.config.botId},shared,actor:ACTOR,card,action:'parallel-'+i,now:d.now}});
    ready.push(new Promise((res,rej)=>{w.on('message',m=>{if(m==='ready')res();});w.on('error',rej);}));
    completed.push(new Promise((res,rej)=>{w.on('message',m=>{if(m!=='ready')res(m as string);});w.on('error',rej);}));
    t.after(()=>w.terminate());
  }
  await Promise.all(ready);Atomics.store(flag,0,1);Atomics.notify(flag,0);const outcomes=await Promise.all(completed);
  assert.equal(outcomes.filter(s=>s==='CREATED').length,1);assert.equal(outcomes.filter(s=>s==='EXISTING').length,3);assert.equal(rows(d).length,1);
});

test('R27 дата/время через decoder: календарь без 30-дневного лимита, ошибки, минуты, overnight и отсутствие покрытия',async t=>{
  const d=await setup(t,compactFixture());await d.enter();await d.click('Подобрать');await d.click('Екатеринбург');await d.click('Другая дата');
  const token=state(d).input.token;
  for(const [value,expected] of [['2030-02-30',/календарной даты нет/],['2030-04-04',/дата прошла/],['2030-13-01',/календарной даты нет/]]) {
    await d.say(token+' '+value);assert.equal(state(d).stage,'input');assert.match(text(d),expected as RegExp);
  }
  await d.say(token+' 2040-02-29');assert.equal(state(d).draft.date,'2040-02-29');await d.click('Другое время');
  await d.say(state(d).input.token+' 25:61-26:00');assert.equal(state(d).stage,'input');assert.match(text(d),/Минуты: 00–59/);
  await d.say(state(d).input.token+' 23:17-01:42');await d.click('Продолжить');await d.click('До 1000 ₽');await d.click('Экскурсии');
  assert.match(text(d),/1 марта 2040 г\. · 01:42/);const q=makeQuery(state(d).draft);assert.equal(q.start,'2040-02-29T18:17:00.000Z');assert.equal(q.end,'2040-02-29T20:42:00.000Z');
  await d.click('Показать результаты');assert.match(text(d),/данных нет/);assert.equal(state(d).cards.length,0);await d.click('Назад');assert.equal(state(d).stage,'summary');
  for(const op of d.operations)validateOperation(op);
});

test('R27 контекстный Back: предыдущий шаг, отмена edit/ввода, незавершённая анкета в меню и прежний opt-in',async t=>{
  const d=await setup(t);await d.enter();await d.click('Подобрать');await d.click('Казань');await d.click('Назад');assert.equal(state(d).stage,'city');
  await d.click('Введите свой город');await d.click('Назад');assert.equal(state(d).stage,'city');await d.click('Казань');await d.click(d.dateLabel('Завтра'));
  await d.click('Другое время');const oldToken=state(d).input.token;await d.click('Назад');assert.equal(state(d).stage,'time');
  await d.click('В меню');assert.equal(state(d).stage,'home');
  await d.click('Мои события');await d.click('Главная');await d.click('О данных');await d.click('Главная');
  await d.click('Продолжить подбор');assert.equal(state(d).stage,'time');
  await d.click('Другое время');await d.say(oldToken+' 13:00-16:00');assert.match(text(d),/Код ввода устарел/);await d.click('Назад');
  await d.click('12:00–18:00');await d.click('Продолжить');await d.click('До 500 ₽');await d.click('Любая тема');await d.click('Показать результаты');await d.click('Показать варианты для проверки');
  const before=structuredClone(state(d));
  for(const label of ['Город','Дата','Время','Бюджет','Тема','Посетители']) {
    await d.click(label);if(label==='Посетители')await d.click('Взрослые +');
    assert.equal(state(d).optIn,true);await d.click('Назад');assert.deepEqual(state(d).draft,before.draft);assert.deepEqual(state(d).cards,before.cards);assert.equal(state(d).optIn,true);
  }
  await d.click('Тема');await d.click('Любая тема');assert.equal(state(d).optIn,true);
  await d.click('Бюджет');await d.click('До 1000 ₽');assert.equal(state(d).optIn,false);assert.equal(state(d).cards.length,0);
});

test('R27 сеанс через полночь: фактические начало/конец в сводке, карточке и сохранённом визите',async t=>{
  const fixture=variantsFixture(),o=fixture.events[2]!.occurrences[0]!;o.start='2030-04-06T20:17:00Z';o.end='2030-04-06T22:42:00Z';
  const d=await setup(t,fixture);await search(d,{category:'Театр',time:'22:55-02:05'});assert.match(text(d),/7 апреля 2030 г\. · 02:05/);
  await d.click('Подробнее 1');assert.match(text(d),/Сеанс: 23:17–7 апреля 2030 г\. · 01:42/);await d.click('Сохранить');
  const saved=JSON.parse(rows(d)[0]!.data) as Card;assert.equal(saved.visit!.from,o.start);assert.equal(Date.parse(saved.visit!.until!),Date.parse(o.end));
  await d.click('Мои события');assert.match(text(d),/23:17–7 апреля 2030 г\. · 01:42/);
});

test('R27 сохранённые цены: exact/free/unknown/семья/legacy/expired; бюджет не является тарифом',async t=>{
  const d=await setup(t);await search(d);await d.click('Подробнее 1');await d.click('Сохранить');const original=rows(d)[0]!;
  const cards:Array<[string,Card]>=[['exact',JSON.parse(original.data) as Card]];
  const free=structuredClone(cards[0]![1]);free.visit!.partyPrice!.total=0;cards.push(['free',free]);
  const unknown=structuredClone(free);unknown.visit!.partyPrice={total:null,knownSubtotal:0,lowerBound:0,unresolved:['Взрослый тариф не установлен или условен.'],admission:'MATCH',admissionNotes:[]};unknown.visit!.price={kind:'UNKNOWN',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:[]};cards.push(['unknown',unknown]);
  const legacy=structuredClone(unknown);delete legacy.visit;cards.push(['legacy',legacy]);
  const family=structuredClone(unknown);family.query.party={adults:2,childAges:[null]};family.visit!.partyPrice={total:null,knownSubtotal:400,lowerBound:400,unresolved:['Цена ребёнка: возраст или применимый тариф неизвестны.'],admission:'UNKNOWN',admissionNotes:[]};cards.push(['family',family]);
  const partial=structuredClone(family);partial.query.party!.childAges=[5,null];partial.visit!.partyPrice!.knownSubtotal=450;
  assert.match(cardPrice(partial),/известная часть 450 ₽/);assert.doesNotMatch(cardPrice(partial),/За взрослых 450/);
  d.runtime.store.db.prepare('DELETE FROM bookmarks WHERE actor=?').run(ACTOR);
  for(const [i,[key,c]] of cards.entries()){c.title='СИНТЕТИКА: '+key;c.query.budgetRub=98765;d.runtime.store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(ACTOR,key,key,d.now+i,JSON.stringify(c));}
  await d.say('/saved');assert.match(text(d),/💰 200 ₽ за всех/);assert.match(text(d),/💰 Бесплатно/);assert.match(text(d),/💰 Общая стоимость не указана/);assert.match(text(d),/За взрослых 400 ₽; детский тариф неизвестен/);assert.doesNotMatch(text(d),/98765/);
  for(const [kind,expected] of [['FROM',/От 250 ₽/],['RANGE',/250–800 ₽ по тарифам/],['CONDITIONAL',/зависит от условий/]] as const){const c=structuredClone(unknown);c.visit!.price={...c.visit!.price,kind,lowerBound:250,upperBound:800};assert.match(cardPrice(c),expected);}
  d.advance(3*86400000);await d.say('/saved');assert.match(text(d),/дата прошла/);await d.click('Открыть 1');assert.equal(state(d).stage,'bookmark');assert.equal(rows(d).length,5);
});

test('R27 delete one: list ID/page survives reorder, cancel, stale and foreign actions; all erasure separate',async t=>{
  const d=await setup(t);await search(d);await d.click('Подробнее 1');await d.click('Сохранить');const original=rows(d)[0]!;
  for(let i=1;i<7;i++)d.runtime.store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(ACTOR,'copy-'+i,'gen-'+i,d.now+i,original.data);
  d.runtime.store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(OTHER,'other','other',d.now,original.data);
  await d.say('/saved');assert(!d.buttons().some(b=>b.text==='Удалить мои данные'));await d.click('Следующие');assert.equal(state(d).page,1);
  const action=d.payload('Удалить 6'),args=d.runtime.store.db.prepare('SELECT data FROM flow_actions WHERE id=?').get(action.slice(3)) as {data:string},ref=JSON.parse(JSON.parse(args.data));
  const before=rows(d),query=structuredClone(state(d).draft);await d.press(action,OTHER);assert.deepEqual(rows(d),before);
  d.runtime.store.db.prepare('UPDATE bookmarks SET saved_at=? WHERE actor=? AND identity=?').run(d.now+999,ACTOR,ref.identity);
  await d.press(action);assert.equal(state(d).bookmark.identity,ref.identity);assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);assert.match(text(d),/на .* из сохранённого\?/);
  await d.click('Отмена');assert.equal(state(d).stage,'saved');assert.equal(state(d).page,1);
  // Новая кнопка по точному ID после перестановки; номер не используется как ключ.
  await d.click('Предыдущие');await d.click('Удалить 1');const confirm=d.payload('Да, удалить');await d.click('Да, удалить');assert.equal(rows(d).length,6);assert(!rows(d).some(b=>b.identity===ref.identity));
  await d.press(confirm);assert.equal(rows(d).length,6);assert.deepEqual(state(d).draft,query);
  await d.click('Следующие');await d.click('Удалить 6');await d.click('Да, удалить');assert.equal(state(d).page,0);assert.equal(rows(d).length,5);
  await d.say('/delete_data');await d.click('Да, удалить');assert.equal(rows(d).length,0);assert.equal(savedRows(d,OTHER).length,1);assert(!getState(d.runtime.store,ACTOR));
});

test('R27 save-before-leaving: все destinations один раз; условия свободны, failed/capacity дают выход, erase не перехватывается',async t=>{
  for(const destination of ['К результатам','Мои события','Главная']) {
    const d=await setup(t);await search(d);await d.click('Подробнее 1');await d.click('Условия посещения');await d.click('К карточке');assert.equal(rows(d).length,0);
    const choice=state(d).selected;await d.click(destination);assert.equal(state(d).stage,'leave');assert.match(text(d),/Сохранить перед переходом/);
    await d.click('Остаться');assert.equal(state(d).selected,choice);assert.equal(rows(d).length,0);await d.click(destination);
    const action=d.payload('Сохранить и перейти');await d.click('Сохранить и перейти');await d.press(action);assert.equal(rows(d).length,1);
    assert.equal(state(d).stage,destination==='К результатам'?'results':destination==='Мои события'?'saved':'home');
  }
  const d=await setup(t);await search(d);await d.click('Подробнее 1');await d.click('Мои события');
  d.runtime.store.db.exec("CREATE TRIGGER reject_save BEFORE INSERT ON bookmarks BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
  await d.click('Сохранить и перейти');assert.equal(rows(d).length,0);assert.match(text(d),/Не удалось сохранить/);assert(d.buttons().some(b=>b.text==='Отменить выбор и перейти'));
  d.runtime.store.db.exec('DROP TRIGGER reject_save');await d.click('Сохранить и перейти');assert.equal(rows(d).length,1);assert.equal(state(d).stage,'saved');
  await search(d);await d.click('Подробнее 1');assert(d.buttons().some(b=>b.text==='✅ Сохранено'));await d.click('Мои события');assert.equal(state(d).stage,'saved');assert.equal(rows(d).length,1);
  await d.click('Удалить 1');await d.click('Да, удалить');await d.click('Назад');assert.equal(rows(d).length,0);assert.notEqual(state(d).stage,'leave');
  await search(d);await d.click('Подробнее 1');await d.say('/delete_data');assert.equal(state(d).stage,'erase');await d.click('Да, удалить');assert.equal(rows(d).length,0);
});

test('R27 город: явный ввод и direct text используют aliases/registry; неизвестный или без каталога не подменяется',async t=>{
  const d=await setup(t,compactFixture());await d.enter();await d.click('Подобрать');const draft=structuredClone(state(d).draft);
  await d.say('Введите свой город');assert.equal(state(d).stage,'city');assert.deepEqual(state(d).draft,draft);
  await d.click('Введите свой город');for(const city of ['Неизвестный город','Москва']){await d.say(city);assert.match(text(d),/Не удалось распознать|данные сейчас недоступны/);assert.equal(state(d).draft.city,draft.city);}
  await d.click('Введите свой город');await d.say('екб');assert.equal(state(d).draft.city,'ekb');assert.equal(state(d).stage,'date');
  await d.click('Назад');await d.say('Казань');assert.equal(state(d).draft.city,'kzn');assert.equal(state(d).stage,'date');
  const screen=d.screen()!;assert.equal(screen.method,'messages');await d.click(d.dateLabel('Завтра'));assert.equal(d.screen()!.method,'edit');
  const before=rows(d);await d.say('/saved');await d.say('/saved');assert.deepEqual(rows(d),before);assert(d.attempts.some(o=>o.method==='delete'));
});

test('R27 все типы проходят один save gate; параллельное сохранение и утрата доступности не создают ловушку',async t=>{
  const d=await setup(t,themeFixture());
  for(const label of Object.values(themeLabels)) {
    await search(d,{category:label});await d.click('Подробнее 1');const c=state(d).cards.find((c:Card)=>c.identity===state(d).selected) as Card;
    const before=rows(d).length;await d.click('Главная');assert.equal(state(d).stage,'leave');
    // Другой клиент уже записал тот же точный выбор между показом вопроса и нажатием.
    saveBookmark(d.runtime.store,ACTOR,c,'concurrent-fixture-'+label,d.now);
    await d.click('Сохранить и перейти');assert.equal(state(d).stage,'home');assert.match(text(d),/Уже сохранено/);assert.equal(rows(d).length,before+1);
    await d.click('Продолжить подбор');assert.equal(state(d).stage,'detail');assert(d.buttons().some(b=>b.text==='✅ Сохранено'));
  }
  await search(d,{category:'Выставки',date:'2030-04-07'});await d.click('Подробнее 1');const before=rows(d);
  const next=themeFixture();next.events[0]!.title+=' (новая фикстура)';d.catalog.replace(next);
  await d.click('К результатам');await d.click('Сохранить и перейти');assert.match(text(d),/недоступно для сохранения/);assert.deepEqual(rows(d),before);
  await d.click('Отменить выбор и перейти');assert.equal(state(d).stage,'results');assert.deepEqual(rows(d),before);
});
