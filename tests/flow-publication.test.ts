import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {Storage,type OutboxRow} from '../src/storage.js';
import {Worker} from '../src/worker.js';
import {loadConfig} from '../src/config.js';
import {admitUpdate} from '../src/admission.js';
import {commitBatch} from '../src/polling.js';
import {LocalMax,MaxError,type MaxOperation,type MaxResult} from '../src/max.js';
import {Catalog} from '../src/culture/catalog.js';
import {compactFixture} from '../src/culture/compact-fixture.js';
import {activeScreen,completeScreenOperation,prepareScreenOperation} from '../src/screens.js';
import {getState} from '../src/culture/flow.js';
import {ACTOR,OTHER,CHAT,SECRET,callback,reply,lifecycle,encode} from './fixtures.js';
import {parseJson} from '../src/contracts.js';

type Hook=(op:MaxOperation,local:LocalMax)=>Promise<MaxResult>;
async function harness(t:TestContext,ingress:'webhook'|'polling'='webhook',hook?:Hook,disk=false) {
  mkdirSync('.cache/publication-tests',{recursive:true});
  const path=disk?resolve(mkdtempSync('.cache/publication-tests/run-'),'test.sqlite'):':memory:';
  const config={...loadConfig({APP_MODE:'local',ADMISSION_MODE:'PUBLIC',DATABASE_PATH:path,MAX_WEBHOOK_SECRET:SECRET,FLOW_DATA_MODE:'synthetic-test'}),ingress};
  let store=new Storage(path,config),now=Date.parse('2030-04-05T06:00:00Z'),seq=0;
  const local=new LocalMax(),ops:MaxOperation[]=[],catalog=new Catalog('synthetic-test',compactFixture());
  const transport={execute:async(op:MaxOperation)=>{ops.push(structuredClone(op));return hook?hook(op,local):local.execute(op);}};
  let worker=new Worker(store,config,transport,()=>now,undefined,catalog);
  t.after(()=>store.close());
  const feed=(value:unknown)=>{
    const normalized=parseJson(encode(value));
    if(ingress==='polling')return commitBatch(store,config,{updates:[normalized],marker:String(++seq)},now);
    const admitted=admitUpdate(normalized,config);assert(!admitted.ignored);
    return store.accept(admitted.event,now);
  };
  const say=(text:string,actor=ACTOR)=>feed(reply(undefined,++now,text,actor,`input-${++seq}`));
  const click=(purpose:string,data?:string,patch:Record<string,unknown>={})=>{
    const a=store.db.prepare('SELECT id FROM flow_actions WHERE actor=? AND purpose=?'+(data===undefined?'':' AND data=?')+' LIMIT 1')
      .get(...(data===undefined?[ACTOR,purpose]:[ACTOR,purpose,JSON.stringify(data)])) as {id:string}|undefined;assert(a,purpose);
    const raw=callback('',`callback-${++seq}`,ACTOR,++now);raw.callback.payload=`cp:${a.id}`;
    raw.message.body.mid=activeScreen(store,ACTOR)!.mid!;
    // Текст сообщения, на котором нажали кнопку, не является текстовым вводом.
    raw.message.body.text='/start';Object.assign(raw,patch);return feed(raw);
  };
  const tick=async()=>{now+=1200;await worker.tick();};
  const drain=async()=>{for(let i=0;i<45;i++){await tick();if(!store.pendingInbox(1).length&&!store.pendingOutbox(now+10000))return;}throw Error('OUTBOX_NOT_DRAINED');};
  const current=()=>activeScreen(store,ACTOR)!;
  const state=()=>JSON.parse(getState(store,ACTOR)!.data);
  const restart=()=>{assert(disk);store.close();store=new Storage(path,config);worker=new Worker(store,config,transport,()=>now,undefined,catalog);};
  say('/start');await drain();
  return {get store(){return store;},get worker(){return worker;},get now(){return now;},local,ops,feed,say,click,tick,drain,current,state,restart};
}

for(const ingress of ['webhook','polling'] as const) test(`${ingress}: текст города, ошибки и исправления формы дают POST; callback с текстом даёт PUT`,async t=>{
  const h=await harness(t,ingress),first=h.current().mid!;
  h.click('pick');await h.drain();assert.equal(h.current().mid,first);
  assert.equal(h.ops.filter(o=>o.method==='edit').length,1);
  h.say('Неизвестный город');await h.drain();const invalidCity=h.current().mid!;
  assert.notEqual(invalidCity,first);assert.match(h.local.messages.get(invalidCity)!.body.text,/Не удалось распознать/);
  h.say('Казань');await h.drain();assert.notEqual(h.current().mid,invalidCity);assert.equal(h.state().stage,'date');
  h.click('custom','date');await h.drain();const form=h.current().mid!,token=h.state().input.token;
  h.say(`${token} 2030-02-31`);await h.drain();const invalid=h.current().mid!;
  assert.notEqual(invalid,form);assert.match(h.local.messages.get(invalid)!.body.text,/календарной даты нет/);
  assert.equal(h.state().input.token,token);assert.equal(h.state().stage,'input');
  h.say(`${token} 2030-04-06`);await h.drain();assert.notEqual(h.current().mid,invalid);assert.equal(h.state().stage,'time');
  const before=h.current().mid;h.say('/saved');await h.drain();assert.notEqual(h.current().mid,before);
  assert(h.ops.filter(o=>o.method==='messages'||o.method==='edit').every(o=>o.body.notify===false));
  assert(h.ops.filter(o=>o.method==='delete').every(o=>o.mid.startsWith('synthetic-')));
});

test('Создание сначала подтверждается и принимается; затем удаляется зафиксированный предшественник',async t=>{
  let inspect:(op:MaxOperation)=>void=()=>{};
  const h=await harness(t,'webhook',async(op,local)=>{inspect(op);return local.execute(op);});
  const old=h.current().mid!;
  inspect=op=>{if(op.method==='messages'){assert.equal(h.current().mid,old);assert(h.local.messages.has(old));assert.equal(h.ops.filter(o=>o.method==='delete').length,0);}};
  h.say('/start');await h.tick();const next=h.current().mid!;assert.notEqual(next,old);
  const queued=h.store.db.prepare("SELECT payload FROM outbox WHERE purpose='culture_cleanup' AND status='PENDING'").get() as {payload:string};
  assert.equal(JSON.parse(queued.payload).mid,old);assert(h.local.messages.has(old));
  inspect=()=>{};await h.drain();assert(!h.local.messages.has(old));assert(h.local.messages.has(next));
});

for(const kind of ['PERMISSION','TIMEOUT_AMBIGUOUS','MALFORMED'] as const) test(`Неуспешный POST (${kind}) сохраняет прежний экран и допускает /start без слепого повтора`,async t=>{
  let fail=false;
  const h=await harness(t,'webhook',async(op,local)=>{
    if(fail&&op.method==='messages'){if(kind==='MALFORMED')return {simulated:true,mid:'wrong-chat',chat:OTHER};throw new MaxError(kind);}
    return local.execute(op);
  });
  const old=h.current().mid!;fail=true;h.say('/start');await h.drain();
  assert.equal(h.current().mid,old);assert(h.local.messages.has(old));assert.equal(h.ops.filter(o=>o.method==='delete').length,0);
  const count=h.ops.length;await h.drain();assert.equal(h.ops.length,count);
  fail=false;h.say('/start');await h.drain();assert.notEqual(h.current().mid,old);
});

test('Повторённый ID POST не даёт удалить активный экран',async t=>{
  let returned:string|undefined;
  const h=await harness(t,'webhook',async(op,local)=>op.method==='messages'&&returned?{simulated:true,mid:returned,chat:CHAT}:local.execute(op));
  returned=h.current().mid!;h.say('/start');await h.drain();assert.equal(h.current().mid,returned);
  assert.equal(h.ops.filter(o=>o.method==='delete').length,0);
  assert(h.store.db.prepare("SELECT 1 FROM outbox WHERE status='UNKNOWN_RESULT' AND result='MALFORMED'").get());
});

test('Ошибка удаления снимает только старую клавиатуру, новый ответ продолжает работать',async t=>{
  const h=await harness(t,'webhook',async(op,local)=>{if(op.method==='delete')throw new MaxError('SEMANTIC',200);return local.execute(op);});
  const old=h.current().mid!;h.say('/start');await h.drain();const next=h.current().mid!;
  assert.notEqual(next,old);assert.deepEqual(h.local.messages.get(old)!.body.attachments,[]);
  h.click('pick');await h.drain();assert.equal(h.current().mid,next);assert.equal(h.state().stage,'city');
});

test('429 удаления ограничен существующими retry, не блокирует новую карточку',async t=>{
  let attempts=0;
  const h=await harness(t,'webhook',async(op,local)=>{if(op.method==='delete'&&++attempts<3)throw new MaxError('RATE_LIMIT',429);return local.execute(op);});
  const old=h.current().mid!;h.say('/start');await h.drain();assert.equal(attempts,3);
  assert.notEqual(h.current().mid,old);assert(!h.local.messages.has(old));
});

test('Дубликаты и быстрая очередь публикуют последнее состояние, очистка не удаляет новый экран',async t=>{
  const h=await harness(t,'polling'),old=h.current().mid!,before=h.ops.filter(o=>o.method==='messages').length;
  const repeated=reply(undefined,h.now+1,'/start',ACTOR,'repeated');h.feed(repeated);h.feed(repeated);
  h.say('/start');h.say('/saved');await h.drain();
  assert.equal(h.ops.filter(o=>o.method==='messages').length,before+1);assert.equal(h.state().stage,'saved');
  assert(!h.local.messages.has(old));assert(h.local.messages.has(h.current().mid!));
});

test('Ввод во время POST не отвергает подтверждённый экран; игнорируемое событие не оставляет пустой диалог',async t=>{
  let during:()=>void=()=>{};
  const h=await harness(t,'webhook',async(op,local)=>{if(op.method==='messages')during();return local.execute(op);});
  const old=h.current().mid!;
  during=()=>{h.feed(reply(undefined,h.now-5000,'/start',ACTOR,'older-during-send'));during=()=>{};};
  h.say('/start');await h.drain();assert.notEqual(h.current().mid,old);assert(h.local.messages.has(h.current().mid!));
  assert(h.store.db.prepare("SELECT 1 FROM inbox WHERE result='FLOW_OLDER_EVENT'").get());
  during=()=>{h.say('/saved');during=()=>{};};h.say('/start');await h.drain();
  assert.equal(h.state().stage,'saved');assert(h.local.messages.has(h.current().mid!));
});

test('Перезапуск после принятия экрана сохраняет exact cleanup; поздний результат не меняет новый mid',async t=>{
  const h=await harness(t,'webhook',undefined,true),old=h.current().mid!;
  h.say('/start');await h.tick();const middle=h.current().mid!;
  const cleanup=h.store.db.prepare("SELECT * FROM outbox WHERE purpose='culture_cleanup' AND status='PENDING'").get() as OutboxRow;
  h.restart();h.say('/saved');await h.drain();const last=h.current().mid!;assert.notEqual(last,middle);
  completeScreenOperation(h.store,cleanup,JSON.parse(cleanup.payload),{simulated:true,mid:old,chat:CHAT},h.now);
  assert.equal(h.current().mid,last);assert(h.local.messages.has(last));assert(!h.local.messages.has(old));
  assert(!h.local.messages.has(middle));assert.equal(h.state().stage,'saved');
});

test('Crash между POST и фиксацией: UNKNOWN_RESULT без повторной отправки и без удаления прежнего экрана',async t=>{
  const h=await harness(t,'webhook',undefined,true),old=h.current().mid!;
  // Выполняем вход/рендер до сети, затем оставляем durable SENDING как после crash.
  h.say('/start');h.store.setMeta('auth_blocked','true');await h.tick();h.store.setMeta('auth_blocked','false');
  const row=h.store.db.prepare("SELECT * FROM outbox WHERE purpose='culture_screen' ORDER BY id DESC LIMIT 1").get() as OutboxRow;
  const op=prepareScreenOperation(h.store,row,JSON.parse(row.payload),h.now)!;
  h.store.db.prepare("UPDATE outbox SET status='SENDING' WHERE id=?").run(row.id);
  await h.local.execute(op);h.restart();const count=h.ops.length;await h.drain();
  assert.equal(h.ops.length,count);assert.equal(h.current().mid,old);assert(h.local.messages.has(old));
  assert.equal((h.store.db.prepare('SELECT status FROM outbox WHERE id=?').get(row.id) as {status:string}).status,'UNKNOWN_RESULT');
  h.say('/start');await h.drain();assert.notEqual(h.current().mid,old);
});

test('Старые и чужие кнопки отвергаются; PUBLIC erasure оставляет нейтральное подтверждение',async t=>{
  const h=await harness(t),old=h.current().mid!;
  const stolen=h.store.db.prepare("SELECT id FROM flow_actions WHERE actor=? AND purpose='pick'").get(ACTOR) as {id:string};
  h.say('/start');await h.drain();const current=h.current().mid!;
  for(const actor of [ACTOR,OTHER]){
    const raw=callback('',`stale-${actor}`,actor,h.now);raw.callback.payload=`cp:${stolen.id}`;raw.message.body.mid=old;h.feed(raw);
  }
  await h.drain();assert.equal(h.current().mid,current);assert.equal(h.state().stage,'home');assert(!h.store.contact(OTHER));
  h.say('/delete_data');await h.drain();h.click('confirmErase');await h.drain();
  assert(!h.store.contact(ACTOR));assert(!activeScreen(h.store,ACTOR));assert(!getState(h.store,ACTOR));
  const ack=h.ops.filter(o=>o.method==='messages'||o.method==='edit').at(-1)!;
  assert.equal(ack.body.text,'Ваши данные удалены. Для нового подбора отправьте /start.');
  assert.equal((h.store.db.prepare('SELECT count(*) n FROM ui_messages WHERE actor=?').get(ACTOR) as {n:number}).n,0);
});

test('Другой диалог того же actor не наследует mid и очистку из прежнего диалога',async t=>{
  const h=await harness(t),old=h.current().mid!,otherChat='-9007199254741999';
  const raw=lifecycle('bot_started',h.now+1,ACTOR,otherChat);delete (raw as any).payload;
  h.feed(raw);await h.drain();assert.equal(h.current().chat,otherChat);assert.notEqual(h.current().mid,old);
  const sent=h.ops.filter(o=>o.method==='messages').at(-1)!;assert.equal(sent.screen!.previousMid,null);
  assert(h.local.messages.has(old));assert.equal(h.ops.filter(o=>o.method==='delete').length,0);
});

test('Позднее подтверждение старого POST не заменяет и не удаляет более новый экран',async t=>{
  const h=await harness(t);
  const oldRow=h.store.db.prepare("SELECT * FROM outbox WHERE purpose='culture_screen' ORDER BY id DESC LIMIT 1").get() as OutboxRow;
  const oldOp=JSON.parse(oldRow.payload) as MaxOperation;
  h.say('/saved');await h.drain();const newest=h.current().mid!;
  const late=await h.local.execute(oldOp);
  h.store.db.transaction(()=>completeScreenOperation(h.store,oldRow,oldOp,late,h.now)).immediate();
  assert.equal(h.current().mid,newest);await h.drain();assert.equal(h.current().mid,newest);
  assert(h.local.messages.has(newest));assert(!h.local.messages.has(late.mid!));assert.equal(h.state().stage,'saved');
});
