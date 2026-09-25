import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { flowDriver, chooseDefaults } from '../scripts/flow-driver.js';
import { ACTOR, OTHER, callback, reply, lifecycle } from './fixtures.js';
import { flowFixture, syntheticClock } from '../src/culture/fixture.js';
import { getState } from '../src/culture/flow.js';
import { Catalog } from '../src/culture/catalog.js';
import { createApp } from '../src/app.js';
import { LiveMax, validateOperation } from '../src/max.js';
import { activeScreen } from '../src/screens.js';
import { Storage } from '../src/storage.js';
import { select } from '../src/data/select.js';
import { representativeQueries } from '../src/data/examples.js';
import { sourceReviews } from '../src/data/reviews.js';
import { Worker } from '../src/worker.js';
import { MaxError } from '../src/max.js';
import { loadConfig } from '../src/config.js';

async function setup(t: TestContext, input: unknown = flowFixture()) {
  const root = resolve('.tmp/flow-tests'); mkdirSync(root,{ recursive:true }); const dir = mkdtempSync(resolve(root,'case-'));
  const d = await flowDriver(resolve(dir,'flow.sqlite'),input);
  t.after(async () => { await d.close(); if (!dir.startsWith(root + sep)) throw Error('unsafe_cleanup'); rmSync(dir,{recursive:true}); });
  return d;
}
const count = (d: Awaited<ReturnType<typeof setup>>, actor = ACTOR) => (d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(actor) as {n:number}).n;
const text = (d: Awaited<ReturnType<typeof setup>>) => d.screen()!.body.text;

test('HTTP: секрет, lossless actor, весь путь strict → детали → save → restart → list → delete', async t => {
  const d = await setup(t); assert.equal((await d.post(lifecycle(),'wrong')).status,401);
  await d.enter(); assert.match(text(d),/Культурный план/); await chooseDefaults(d);
  assert.match(text(d),/Совпадает по известным условиям/); assert.doesNotMatch(text(d),/мастерская|дорогой/);
  await d.click('Подробнее 1'); assert.match(text(d),/Вымышленный набор/);
  assert(d.buttons().some(b => b.type === 'link' && b.url === 'https://example.org/synthetic-cultural-option-1'));
  await d.click('Сохранить');
  assert.match(text(d),/^✅ СОХРАНЕНО\n/);assert(d.buttons().some(b=>b.text==='✅ Сохранено'));
  assert(!d.buttons().some(b=>b.text==='Сохранить'));
  await d.click('✅ Сохранено'); assert.equal(count(d),1);
  const saved = d.runtime.store.db.prepare('SELECT data FROM bookmarks').get() as {data:string};
  assert.match(saved.data,/FLEXIBLE_VISIT/); assert.equal(JSON.parse(saved.data).occurrence.start,null);
  await d.restart(); await d.click('Мои события'); await d.click('Открыть 1'); await d.click('Удалить закладку'); await d.click('Да, удалить'); assert.equal(count(d),0);
  assert.equal(d.runtime.store.db.pragma('user_version',{simple:true}),3);
});
test('Опциональные варианты: отдельная кнопка, UNKNOWN не превращается в строгое совпадение, фильтр сбрасывает opt-in', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); await d.click('Показать варианты для проверки');
  assert.match(text(d),/Варианты, где нужно уточнение/); assert.doesNotMatch(text(d),/дорогой зал/);
  await d.click('Подробнее 2'); assert.match(text(d),/цен|тариф/); await d.click('Сохранить');
  await d.click('Мои события'); await d.click('Открыть 1'); assert.match(text(d),/Сохранённый контекст: Нужно уточнить условия/);
  await d.click('Главная'); await chooseDefaults(d); assert.doesNotMatch(text(d),/мастерская/);
  await d.click('Показать варианты для проверки'); const old = d.payload('Подробнее 2');
  await d.click('Бюджет'); await d.click('Бесплатно'); await d.click('Показать результаты'); await d.press(old);
  assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).optIn,false);
  assert.doesNotMatch(text(d),/мастерская/);
});
test('Пользователь B не открывает/сохраняет чужую карточку и не удаляет чужую закладку', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); const old = d.payload('Подробнее 1');
  await d.enter(OTHER); await d.press(old,OTHER); assert.equal(count(d,OTHER),0);
  await d.click('Подробнее 1'); await d.click('Сохранить'); await d.click('Мои события'); await d.click('Открыть 1'); await d.click('Удалить закладку');
  await d.press(d.payload('Да, удалить'),OTHER); assert.equal(count(d),1); assert.equal(count(d,OTHER),0);
});
test('Дубликат доставки и новая доставка старой кнопки не повторяют переход', async t => {
  const d = await setup(t); await d.enter(); const p = d.payload('Подобрать');
  await d.press(p,ACTOR,'same-callback'); const revision = getState(d.runtime.store,ACTOR)!.revision;
  assert.equal((await d.press(p,ACTOR,'same-callback')).status,'duplicate'); await d.press(p);
  assert.equal(getState(d.runtime.store,ACTOR)!.revision,revision);
});
test('Из двух клиентов принимается один переход данной ревизии; поздний timestamp не возвращает старый экран', async t => {
  const d = await setup(t); await d.enter(); const pick = d.payload('Подобрать'), about = d.payload('О данных');
  await d.press(pick,ACTOR,'new',d.now + 1,false); await d.press(about,ACTOR,'old',d.now,false); await d.drain();
  assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).stage,'city');
});
test('Delete → save again: поколение закладки и старая кнопка удаления защищают новую запись', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); await d.click('Подробнее 1'); await d.click('Сохранить');
  const gen = (d.runtime.store.db.prepare('SELECT generation FROM bookmarks').get() as {generation:string}).generation;
  await d.click('Мои события'); await d.click('Открыть 1'); await d.click('Удалить закладку'); const old = d.payload('Да, удалить'); await d.click('Да, удалить');
  await d.click('Главная'); await chooseDefaults(d); await d.click('Подробнее 1'); await d.click('Сохранить'); await d.press(old);
  assert.equal(count(d),1); assert.notEqual((d.runtime.store.db.prepare('SELECT generation FROM bookmarks').get() as {generation:string}).generation,gen);
});
test('Замена снимка между выбором, деталями и save не перепривязывает карточку', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); await d.click('Подробнее 1');
  const changed = flowFixture(); changed.events[0]!.title = 'СИНТЕТИКА: изменённая запись'; d.catalog.replace(changed);
  await d.click('Сохранить'); assert.equal(count(d),0); assert.match(text(d),/устарела/);
});
test('Сохранённые данные: изменение, исчезновение, недоступность и давность отображаются без отмены/подмены', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); await d.click('Подробнее 1'); await d.click('Сохранить');
  const changed = flowFixture(); changed.events[0]!.price.amount = 50; changed.events[0]!.price.kind = 'EXACT'; d.catalog.replace(changed);
  await d.click('Мои события'); await d.click('Открыть 1'); assert.match(text(d),/Данные изменились/);
  const empty = flowFixture(); empty.events = []; empty.stats.normalizedEvents=0; empty.stats.occurrences=0; d.catalog.replace(empty);
  await d.click('Мои события'); await d.click('Открыть 1'); assert.match(text(d),/не подтверждение отмены/);
  d.catalog.replace(null); await d.click('Мои события'); await d.click('Открыть 1'); assert.match(text(d),/снимок недоступен/);
  d.catalog.replace(flowFixture()); d.advance(86400000); await d.say('/saved'); await d.click('Открыть 1'); assert.match(text(d),/устарели/);
});
test('Отложенный экран отбрасывается при новой ревизии и при новой версии снимка', async t => {
  const d = await setup(t); await d.enter(); await d.click('Подобрать'); await d.click('Казань'); await d.click('Завтра'); await d.click('12:00–18:00'); await d.click('Продолжить'); await d.click('До 500 ₽'); await d.click('Любой');
  await d.press(d.payload('Показать результаты'),ACTOR,'delayed',d.now + 1,false);
  d.advance(1200); await d.runtime.worker.tick(); // callback ACK; экран ещё в outbox
  const next = flowFixture(); next.events[0]!.title += ' изменено'; d.catalog.replace(next); await d.drain();
  assert(d.runtime.store.db.prepare("SELECT 1 FROM outbox WHERE result='FLOW_OR_SNAPSHOT_CHANGED'").get());
  assert.doesNotMatch(text(d),/Совпадает по известным условиям/);
  await d.say('/start'); const p = d.payload('Подобрать'); await d.press(p,ACTOR,'queued',d.now + 1,false);
  await d.post(reply(undefined,d.now + 2,'/start',ACTOR,'new-home')); await d.drain(); assert.match(text(d),/Культурный план/);
});
test('Пустой, неполный, старый, отсутствующий и вне области снимок имеют восстановление', async t => {
  for (const mode of ['empty','partial','stale','missing','outside'] as const) {
    const s = flowFixture();
    if (mode === 'empty') { s.events=[]; s.stats.normalizedEvents=0; s.stats.occurrences=0; }
    if (mode === 'partial') { s.outcome='PARTIAL'; s.paginationComplete=false; }
    const d = await setup(t,mode === 'missing' ? null : s); if (mode === 'stale') d.advance(2*86400000); if (mode === 'outside') d.advance(31*86400000);
    await d.enter(); if(mode==='missing'){await d.click('Подобрать');assert.match(text(d),/Снимков сейчас нет/);continue;} await chooseDefaults(d);
    assert.match(text(d),mode==='empty' ? /совпадений.*нет/ : mode==='partial' ? /неполное/ : mode==='stale' ? /старше/ : /вне дат/);
    assert(d.buttons().some(b=>b.text==='Дата')); assert.doesNotMatch(text(d),/дорогой зал/);
  }
});
test('Ввод ограничен явным форматом и кодом ревизии; невозможные даты/время/числа отвергаются', async t => {
  const d = await setup(t); await d.enter(); await d.click('Подобрать'); await d.click('Казань'); await d.click('Другая дата');
  const token = /([A-F0-9]{6}) ГГГГ/.exec(text(d))![1];
  for (const value of ['завтра',`${token} 2030-04-31`,`${token} 2040-01-01`]) { await d.say(value); assert.match(text(d),/Ввод не принят/); }
  await d.say(`${token} 2030-04-06`); assert.match(text(d),/В какое время/); await d.click('Другое время');
  const tt = /([A-F0-9]{6}) ЧЧ/.exec(text(d))![1]; await d.say(`${tt} 24:00-25:00`); assert.match(text(d),/Ввод не принят/);
  await d.say(`${tt} 19:00-18:00`); assert.match(text(d),/Ввод не принят/); await d.say(`${tt} 12:00-18:00`);await d.click('Продолжить');
  await d.click('Другая сумма'); const bt = /([A-F0-9]{6}) СУММА/.exec(text(d))![1]; await d.say(`${token} 500`); assert.match(text(d),/Ввод не принят/);
  await d.say(`${bt} 500`); assert.match(text(d),/Культурный интерес/);
  const arbitrary = d.runtime.store.db.prepare("SELECT payload FROM inbox WHERE payload LIKE '%завтра%'").get(); assert.equal(arbitrary,undefined);
});
test('Истёкшее действие восстанавливается через /start без побочного изменения', async t => {
  const d = await setup(t); await d.enter(); const p = d.payload('Подобрать'); d.advance(16*60000); await d.press(p);
  assert.match(d.operations.at(-1)!.method === 'answers' ? (d.operations.at(-1) as any).body.notification : '',/устарела/);
  await d.say('/start'); assert.match(text(d),/Культурный план/);
});
test('Удаление личных данных и probe cleanup не удаляют активные закладки', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); await d.click('Подробнее 1'); await d.click('Сохранить');
  d.runtime.store.cleanup(d.now+8*86400000); assert.equal(count(d),1);
  await d.say('/delete_data'); await d.click('Да, удалить'); assert.equal(count(d),0);
  assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).cards.length,0);
});
test('Лимит/страницы: 5 из 50, личная изоляция, запись не превращается в регистрацию', async t => {
  const d = await setup(t); await d.enter(); await chooseDefaults(d); await d.click('Подробнее 1'); await d.click('Сохранить');
  const row = d.runtime.store.db.prepare('SELECT data FROM bookmarks').get() as {data:string};
  for (let i=1;i<7;i++) d.runtime.store.db.prepare('INSERT INTO bookmarks VALUES(?,?,?,?,?)').run(ACTOR,`synthetic-page-${i}`,`g-${i}`,d.now+i,row.data);
  await d.click('Мои события'); assert.equal(d.buttons().filter(b=>b.text.startsWith('Открыть')).length,5); await d.click('Следующие'); assert.equal(d.buttons().filter(b=>b.text.startsWith('Открыть')).length,2);
  await d.enter(OTHER); await d.click('Мои события',OTHER); assert.match(d.screen(OTHER)!.body.text,/пока нет/);
});
test('SQLite v1 мигрирует без потери очереди; повторный startup сохраняет v3/закладки', async t => {
  const d = await setup(t); const path=d.config.databasePath; await d.close();
  const db = new Storage(path,d.config); db.db.exec('DROP TABLE flow_screens; DROP TABLE ui_messages; DROP TABLE flow_actions; DROP TABLE flow_states; DROP TABLE bookmarks; ALTER TABLE outbox DROP COLUMN flow_revision; ALTER TABLE outbox DROP COLUMN catalog_version; PRAGMA user_version=1;');
  db.setMeta('migration_test','keep'); db.close(); await d.restart(); assert.equal(d.runtime.store.getMeta('migration_test'),'keep');
  await d.enter(); await chooseDefaults(d); await d.click('Подробнее 1'); await d.click('Сохранить'); await d.restart(); assert.equal(count(d),1);
});
test('Публичная граница LiveMax отклоняет provider и немаркированную синтетику до HTTP; preview выключен', async t => {
  const d = await setup(t); let requests=0; let url='';
  const cfg = { ...d.config, mode:'live' as const, token:'synthetic-only-test-token' };
  const client = new LiveMax(cfg,(async (u: unknown)=> { requests++;url=String(u);return new Response('{"success":false}'); }) as typeof fetch);
  await assert.rejects(client.execute({method:'messages',recipient:ACTOR,audience:'PROVIDER',body:{text:'закрыто'}}),{kind:'PERMISSION'}); assert.equal(requests,0);
  await assert.rejects(new LiveMax({...cfg,flowDataMode:'real'},(async()=>{requests++;}) as any).execute({method:'messages',recipient:ACTOR,audience:'SYNTHETIC',body:{text:'test'}}),{kind:'PERMISSION'}); assert.equal(requests,0);
  await assert.rejects(client.execute({method:'answers',callbackId:'id',body:{notification:'тест'}}),{kind:'SEMANTIC'}); assert.match(url,/disable_link_preview=true/);
  assert.throws(()=>createApp({...cfg,flowDataMode:'real'},{clock:()=>1}),/CLOCK/);
});
test('Snapshot boundary валидирует/замораживает данные, не смешивает режимы и не обновляет timestamps', () => {
  const s=flowFixture(), c=new Catalog('synthetic-test',s); assert.equal(c.snapshot?.retrievedAt,syntheticClock.toISOString());
  s.events[0]!.title='mutation'; assert.notEqual(c.snapshot!.events[0]!.title,'mutation'); assert.throws(()=>{ c.snapshot!.events[0]!.title='bad'; });
  assert.throws(()=>new Catalog('real',flowFixture()),/MODE/); assert.throws(()=>c.replace({version:999}));
});
test('Безопасные ссылки и ограничения сообщений/клавиатур', () => {
  const op = {method:'messages' as const,recipient:ACTOR,body:{text:'Текст',attachments:[{type:'inline_keyboard' as const,payload:{buttons:[[{type:'link' as const,text:'Источник: KudaGo',url:'javascript:alert(1)'}]]}}]}};
  assert.throws(()=>validateOperation(op)); op.body.attachments[0]!.payload.buttons[0]![0]!.url='https://kzn.kudago.com/event/test/'; validateOperation(op);
  op.body.text='x'.repeat(4001); assert.throws(()=>validateOperation(op));
});
test('Общий реестр карантина исключает противоречивую идентичность из strict и uncertain без изменения фактов', () => {
  const s=flowFixture(), q=representativeQueries(syntheticClock).weekend500!; const original=JSON.stringify(s);
  const review={...sourceReviews[0]!,eventId:s.events[0]!.id};
  const before=select(s,q,syntheticClock,true,true,[]), after=select(s,q,syntheticClock,true,true,[review]);
  assert.equal(before.strictTotal,1);assert.equal(after.strictTotal,0);assert.equal(after.excluded.SOURCE_IDENTITY_CONFLICT,1);
  assert(!after.uncertain.some(c=>c.eventId===review.eventId));assert.equal(JSON.stringify(s),original);
});
test('Worker запрещает provider-карточку у транспорта live; semantic false не подтверждает callback', async t => {
  const d=await setup(t);await d.enter();let calls=0;
  const live = new Worker(d.runtime.store,{...d.config,mode:'live'}, {execute:async()=>{calls++;return {simulated:false};}},()=>d.now,undefined,d.catalog);
  d.runtime.store.enqueue('display-test',ACTOR,null,'culture_screen',{method:'messages',recipient:ACTOR,audience:'PROVIDER',body:{text:'provider data'}},d.now,d.now+60000);
  await live.tick();assert.equal(calls,0);assert(d.runtime.store.db.prepare("SELECT 1 FROM outbox WHERE status='SUPPRESSED_DISPLAY'").get());
  d.runtime.store.enqueue('semantic-test',ACTOR,null,'culture_answer',{method:'answers',callbackId:'false',body:{notification:'тест'}},d.now,d.now+60000);
  const failing=new Worker(d.runtime.store,d.config,{execute:async()=>{throw new MaxError('SEMANTIC',200);}},()=>d.now,undefined,d.catalog);
  await failing.tick();assert(d.runtime.store.db.prepare("SELECT 1 FROM outbox WHERE status='FAILED_SEMANTIC'").get());
});
test('Отложенный ответ транспорта не привязывается к новой ревизии; overlapping tick не запускает вторую отправку', async t => {
  const d=await setup(t);await d.enter();const row=getState(d.runtime.store,ACTOR)!;let calls=0;let release!:()=>void;
  const waiting=new Promise<void>(r=>{release=r;});
  const worker=new Worker(d.runtime.store,d.config,{execute:async()=>{calls++;await waiting;return {simulated:true,mid:activeScreen(d.runtime.store,ACTOR)!.mid!,chat:activeScreen(d.runtime.store,ACTOR)!.chat};}},()=>d.now,undefined,d.catalog);
  d.runtime.store.enqueue('delayed-transport',ACTOR,null,'culture_screen',{method:'messages',recipient:ACTOR,screen:{...activeScreen(d.runtime.store,ACTOR)!,revision:row.revision},body:{text:'старый экран',attachments:[]}},d.now,d.now+60000,{revision:row.revision,catalogVersion:d.catalog.version});
  const sending=worker.tick();await worker.tick();assert.equal(calls,1);
  await d.post(reply(undefined,d.now+1,'/start',ACTOR,'newer-query'));release();await sending;
  assert(d.runtime.store.db.prepare("SELECT 1 FROM outbox WHERE result='SENT_BEFORE_NEW_INPUT_OR_SNAPSHOT'").get());
  await d.drain();assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).stage,'home');
});
test('Живой режим не принимает test clock без явного synthetic-test; нет автоматического fallback', () => {
  assert.throws(()=>loadConfig({APP_MODE:'local',DATABASE_PATH:':memory:',MAX_WEBHOOK_SECRET:'synthetic-test-secret-000000000000000000',PROBE_TESTER_IDS:ACTOR,FLOW_TEST_CLOCK:'2030-04-05T06:00:00Z'}),/synthetic-test/);
  const c=Catalog.load({flowDataMode:'real',snapshotPath:'.tmp/definitely-missing-snapshot.json'} as any);assert.equal(c.snapshot,null);
});
test('Свежая синтетика для клиентского smoke создаётся отдельно и работает с действительными часами MAX', () => {
  const now=new Date('2026-09-24T09:00:00Z'), s=flowFixture(now), result=select(s,representativeQueries(now).weekend500!,now,true,true);
  assert.equal(s.mode,'SYNTHETIC_FIXTURE');assert.equal(result.strictTotal,1);assert.equal(result.uncertain.length,1);
  assert.equal(flowFixture().retrievedAt,syntheticClock.toISOString());
});
test('Запоздалый /probe не сбрасывает более новый продуктовый экран', async t => {
  const d=await setup(t);await d.enter();const oldTime=d.now;await chooseDefaults(d);
  const before=getState(d.runtime.store,ACTOR)!;
  await d.post(reply(undefined,oldTime,'/probe',ACTOR,'old-probe-command'));await d.drain();
  assert.equal(getState(d.runtime.store,ACTOR)?.revision,before.revision);
  assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).stage,'results');
  await d.post(reply(undefined,d.now+1,'/probe',ACTOR,'new-probe-command'));await d.drain();
  const probeState=getState(d.runtime.store,ACTOR)!;assert.equal(JSON.parse(probeState.data).route,'probe');
  await d.post(reply(undefined,oldTime,'/start',ACTOR,'old-home-command'));await d.drain();
  assert.equal(getState(d.runtime.store,ACTOR)!.revision,probeState.revision);
  await d.say('/start');assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).route,undefined);
});
