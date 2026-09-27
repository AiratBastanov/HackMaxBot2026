import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {flowDriver} from '../scripts/flow-driver.js';
import {variantsFixture,search,savedRows,state} from '../scripts/bookmark-scenario.js';
import {LiveMax,MaxError,type MaxOperation,type MaxResult,LocalMax,validateOperation} from '../src/max.js';
import {loadConfig} from '../src/config.js';
import {getState} from '../src/culture/flow.js';
import {ACTOR,OTHER,CHAT,SECRET,encode,message,lifecycle} from './fixtures.js';

type Hook=(op:MaxOperation,local:LocalMax)=>Promise<MaxResult>;
async function setup(t:TestContext,hook?:Hook) {
  const d=await flowDriver(':memory:',variantsFixture(),undefined,false,null,true,hook);t.after(()=>d.close());return d;
}
test('R27 LiveMax: method-specific errors и bounded allowlist, без body/IDs; реальные success semantics',async()=>{
  const config=loadConfig({APP_MODE:'local',DATABASE_PATH:':memory:',MAX_WEBHOOK_SECRET:SECRET,FLOW_DATA_MODE:'synthetic-test',PROBE_TESTER_IDS:ACTOR});
  let status=400,body='{"code":"private-id-secret","message":"private text and token"}';const requests:{url:string;init:RequestInit}[]=[];
  const max=new LiveMax({...config,mode:'live',token:'synthetic-token-only'},(async(url,init)=>{requests.push({url:String(url),init:init!});return new Response(body,{status});}) as typeof fetch);
  const op:MaxOperation={method:'messages',recipient:ACTOR,body:{text:'Синтетика <>& _*',attachments:[]},audience:'SYNTHETIC'};
  await assert.rejects(max.execute(op),(e:unknown)=>e instanceof MaxError&&e.kind==='INVALID_REQUEST'&&e.providerCode===undefined&&!JSON.stringify(e).includes('private'));
  assert.equal(new URL(requests[0]!.url).searchParams.get('user_id'),ACTOR);assert(!new URL(requests[0]!.url).searchParams.has('chat_id'));assert.equal(JSON.parse(String(requests[0]!.init.body)).format,undefined);
  status=403;body='{"code":"chat.denied","message":"не публиковать"}';await assert.rejects(max.execute(op),{kind:'RECIPIENT_UNAVAILABLE',providerCode:'chat.denied'});
  const edit:MaxOperation={...op,method:'edit',mid:'synthetic-mid',chat:CHAT};await assert.rejects(max.execute(edit),{kind:'PERMISSION'});
  status=400;await assert.rejects(max.execute(op),{kind:'INVALID_REQUEST'});
  status=404;await assert.rejects(max.execute(edit),{kind:'RESOURCE_NOT_FOUND'});await assert.rejects(max.execute(op),{kind:'HTTP'});
  for(const [code,kind] of [[401,'AUTH'],[429,'RATE_LIMIT'],[503,'SERVER']] as const){status=code;await assert.rejects(max.execute(op),{kind});}
  status=400;body='x'.repeat(8192);await assert.rejects(max.execute(op),{kind:'INVALID_REQUEST',providerCode:undefined});
  status=200;body='{"success":false,"message":"private"}';await assert.rejects(max.execute(edit),{kind:'SEMANTIC'});
  await assert.rejects(max.execute({method:'answers',callbackId:'fixture',body:{notification:'Готово'}}),{kind:'SEMANTIC'});
  body='{"success":true}';await max.execute(edit);await max.execute({method:'answers',callbackId:'fixture',body:{notification:'Готово'}});await assert.rejects(max.execute(op),{kind:'MALFORMED'});
  body=encode({message:message()});await max.execute(op);
});

test('R27 single deletion commit survives HTTP400; no identical replacement POST, contact usable, fresh text below input',async t=>{
  let fail=false;const d=await setup(t,async(op,local)=>{if(fail&&op.method==='edit'){fail=false;throw new MaxError('INVALID_REQUEST',400);}return local.execute(op);});
  await search(d);await d.click('Подробнее 1');await d.click('Сохранить');
  await search(d,{date:'2030-04-07'});await d.click('Подробнее 1');await d.click('Сохранить');await d.click('Мои события');
  const saved=savedRows(d),draft=state(d).draft;await d.click('Удалить 1');fail=true;const before=d.attempts.length;await d.click('Да, удалить');
  assert.equal(savedRows(d).length,1);assert.deepEqual(savedRows(d)[0],saved[1]);assert.deepEqual(state(d).draft,draft);assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);
  assert.equal(d.attempts.slice(before).filter(o=>o.method==='edit').length,1);assert.equal(d.attempts.slice(before).filter(o=>o.method==='messages').length,0);
  assert(d.runtime.store.db.prepare("SELECT 1 FROM outbox WHERE status='FAILED_INVALID_REQUEST' AND attempts=1").get());
  const diagnostics=d.reports.filter(r=>'errorClass' in r);assert.equal(diagnostics.length,1);const safe=JSON.stringify(diagnostics);assert.match(safe,/textLength/);assert.match(safe,/outbox-/);assert(!safe.includes(ACTOR));assert(!safe.includes(CHAT));assert(!safe.includes('Свет'));
  await d.say('/saved');assert.equal(d.screen()!.method,'messages');assert.match(d.screen()!.body.text,/Мои события/);assert.equal(savedRows(d).length,1);
  await d.click('Открыть 1');assert.equal(d.screen()!.method,'edit');
});

test('R27 arbitrary POST400 и semantic false не означают Stop; network ambiguity не повторяет POST',async t=>{
  for(const error of [new MaxError('INVALID_REQUEST',400),new MaxError('SEMANTIC',200),new MaxError('TIMEOUT_AMBIGUOUS')]) {
    let fail=true;const d=await setup(t,async(op,local)=>{if(op.method==='messages'&&fail){fail=false;throw error;}return local.execute(op);});
    await d.say('/start');assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);assert.equal(d.attempts.filter(o=>o.method==='messages').length,1);
    await d.drain();assert.equal(d.attempts.filter(o=>o.method==='messages').length,1);await d.say('/start');assert(d.screen());assert.equal(state(d).stage,'home');
  }
});

test('R27 documented recipient denial recovers via fresh private message; lifecycle Stop requires later bot_started',async t=>{
  let fail=false;const d=await setup(t,async(op,local)=>{if(fail&&op.method==='messages'){fail=false;throw new MaxError('RECIPIENT_UNAVAILABLE',403,undefined,'chat.denied');}return local.execute(op);});
  await d.enter();const old=d.payload('Подобрать');fail=true;await d.say('/saved');assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,4);
  await d.press(old);assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,4);await d.say('/start');assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);
  const stopAt=d.now+1;await d.post(lifecycle('bot_stopped',stopAt));await d.drain();assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,2);
  const attempts=d.attempts.length;await d.press(old);await d.say('/start');assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,2);assert.equal(d.attempts.length,attempts);
  await d.enter();assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);assert(d.screen());await d.press(old);assert.equal(state(d).stage,'home');
  // Legacy UNKNOWN разрешает восстановление без приравнивания к Stop.
  d.runtime.store.db.prepare('UPDATE contacts SET access_mask=0 WHERE actor=?').run(ACTOR);await d.say('/start');assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);
});

test('R27 erase commits before final delivery, suppresses obsolete callbacks and cannot erase new interaction',async t=>{
  let fail=false;const d=await setup(t,async(op,local)=>{if(op.forgetAfterSend&&op.method==='messages'&&fail){fail=false;throw new MaxError('INVALID_REQUEST',400);}return local.execute(op);});
  for(const actor of [ACTOR,OTHER]){await search(d,{actor});await d.click('Подробнее 1',actor);await d.click('Сохранить',actor);}
  const other=savedRows(d,OTHER),old=d.payload('✅ Сохранено');await d.say('/delete_data');const erase=d.payload('Да, удалить');fail=true;await d.click('Да, удалить');
  assert.equal(savedRows(d).length,0);assert.deepEqual(savedRows(d,OTHER),other);
  for(const table of ['flow_states','flow_actions','contacts','flow_screens','ui_messages'])assert(!d.runtime.store.db.prepare(`SELECT 1 FROM ${table} WHERE actor=?`).get(ACTOR));
  assert(!d.runtime.store.db.prepare('SELECT 1 FROM outbox WHERE actor=?').get(ACTOR));assert(!d.runtime.store.db.prepare("SELECT 1 FROM inbox WHERE json_extract(payload,'$.actor')=?").get(ACTOR));
  await d.press(old);await d.press(erase);assert(!getState(d.runtime.store,ACTOR));assert(!d.runtime.store.contact(ACTOR));
  await d.post(lifecycle('bot_stopped',d.now+1));await d.drain();await d.say('/saved');assert(!getState(d.runtime.store,ACTOR));assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,2);
  await d.enter();
  await d.say('/saved');assert.equal(savedRows(d).length,0);assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);assert.match(d.screen()!.body.text,/Закладок пока нет/);
  await d.press(erase);assert(getState(d.runtime.store,ACTOR));assert.deepEqual(savedRows(d,OTHER),other);
  for(const op of d.attempts){validateOperation(op);if(op.forgetAfterSend&&op.method==='messages')assert.deepEqual(op.body.attachments,[]);}
});

test('R27 erase with in-flight confirmation retains a fresh interaction; payload-free pending completion after expiry',async t=>{
  let release!:()=>void,hold=false;const wait=new Promise<void>(r=>release=r);
  const d=await setup(t,async(op,local)=>{if(hold&&op.forgetAfterSend&&op.method==='messages')await wait;return local.execute(op);});
  await d.enter();await d.say('/delete_data');const action=d.payload('Да, удалить');hold=true;
  await d.press(action,ACTOR,'erase-held',d.now+1,false);d.advance(1200);await d.runtime.worker.tick();d.advance(1200);const tick=d.runtime.worker.tick();
  assert(!getState(d.runtime.store,ACTOR));assert(!d.runtime.store.contact(ACTOR));
  await d.post((await import('./fixtures.js')).reply(undefined,d.now+1,'/start',ACTOR,'fresh-after-erasure'));release();await tick;await d.drain();
  assert(getState(d.runtime.store,ACTOR));assert.equal(d.runtime.store.contact(ACTOR)?.access_mask,1);assert.equal(state(d).stage,'home');
});
