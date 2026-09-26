import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {Storage} from '../src/storage.js';
import {Worker} from '../src/worker.js';
import {loadConfig} from '../src/config.js';
import {LiveMax,LocalMax,MaxError,type MaxOperation,type MaxResult} from '../src/max.js';
import {Catalog} from '../src/culture/catalog.js';
import {compactFixture} from '../src/culture/compact-fixture.js';
import {activeScreen} from '../src/screens.js';
import {getState} from '../src/culture/flow.js';
import {ACTOR,OTHER,CHAT,SECRET,encode,message} from './fixtures.js';

const config=loadConfig({APP_MODE:'local',DATABASE_PATH:':memory:',MAX_WEBHOOK_SECRET:SECRET,PROBE_TESTER_IDS:`${ACTOR},${OTHER}`,FLOW_DATA_MODE:'synthetic-test'});
type Hook=(op:MaxOperation,local:LocalMax)=>Promise<MaxResult>;
async function harness(t:TestContext,hook?:Hook) {
  const store=new Storage(':memory:',config),local=new LocalMax(),ops:MaxOperation[]=[];let now=Date.parse('2030-04-05T06:00:00Z'),seq=0;
  const catalog=new Catalog('synthetic-test',compactFixture());
  const transport={execute:async(op:MaxOperation)=>{ops.push(structuredClone(op));return hook?hook(op,local):local.execute(op);}};
  const worker=new Worker(store,config,transport,()=>now,undefined,catalog);
  t.after(()=>store.close());
  const drain=async()=>{for(let i=0;i<30;i++){now+=1200;await worker.tick();if(!store.pendingInbox(1).length&&!store.pendingOutbox(now)&&!store.db.prepare("SELECT 1 FROM ui_messages WHERE status='UNCERTAIN'").get())break;}};
  const home=()=>store.accept({key:`home-${++seq}`,kind:'message_created',actor:ACTOR,chat:CHAT,timestamp:++now,input:'/start',homeEntry:true},now);
  const action=(purpose:string)=>{const a=store.db.prepare('SELECT id FROM flow_actions WHERE actor=? AND purpose=? LIMIT 1').get(ACTOR,purpose) as {id:string};assert(a);return a.id;};
  const click=(purpose:string)=>store.accept({key:`click-${++seq}`,kind:'message_callback',actor:ACTOR,chat:CHAT,mid:activeScreen(store,ACTOR)!.mid!,timestamp:++now,callbackId:`cb-${seq}`,flowAction:action(purpose)},now);
  home();await drain();return {store,local,ops,worker,catalog,drain,home,click,get now(){return now;},advance(){now+=1200;}};
}
test('C16 MAX PUT/DELETE semantic false; exact payload replaces keyboard, notify=false; read verifies sender/chat/actor',async()=>{
  const calls:{url:string;method:string;body:any}[]=[];let response:unknown={success:true};
  const max=new LiveMax({...config,mode:'live',token:'synthetic-test-only'},(async(u,init)=>{calls.push({url:String(u),method:init!.method!,body:init?.body?JSON.parse(String(init.body)):undefined});return new Response(encode(response));}) as typeof fetch);
  const op:MaxOperation={method:'edit',mid:'synthetic-mid',recipient:ACTOR,chat:CHAT,audience:'SYNTHETIC',body:{text:'Удалить?',notify:false,attachments:[{type:'inline_keyboard',payload:{buttons:[[{type:'callback',text:'Да, удалить',payload:'yes'},{type:'callback',text:'Отмена',payload:'no'}]]}}]}};
  await max.execute(op);assert.equal(calls[0]!.method,'PUT');assert.equal(new URL(calls[0]!.url).searchParams.get('message_id'),'synthetic-mid');assert.equal(calls[0]!.body.attachments[0].payload.buttons.flat().length,2);assert.equal(calls[0]!.body.notify,false);
  await max.execute({...op,body:{text:'Закрыто',attachments:[]}});assert.deepEqual(calls[1]!.body.attachments,[]);
  response={success:false};await assert.rejects(max.execute(op),{kind:'SEMANTIC'});await assert.rejects(max.execute({method:'delete',mid:op.mid,recipient:ACTOR,chat:CHAT}),{kind:'SEMANTIC'});
  response=message();await max.execute({method:'read',mid:op.mid,recipient:ACTOR,chat:CHAT});
  response=message(OTHER);await assert.rejects(max.execute({method:'read',mid:op.mid,recipient:ACTOR,chat:CHAT}),{kind:'PERMISSION'});
  response={...message(),sender:{user_id:778,first_name:'Чужой бот',is_bot:true}};await assert.rejects(max.execute({method:'read',mid:op.mid,recipient:ACTOR,chat:CHAT}),{kind:'PERMISSION'});
  const before=calls.length;await assert.rejects(max.execute({...op,audience:'PROVIDER'}),{kind:'PERMISSION'});assert.equal(calls.length,before);
});
test('C16 worker refuses untracked/wrong actor mutation, no external target from callback',async t=>{
  const h=await harness(t),current=activeScreen(h.store,ACTOR)!,start=h.ops.length;
  h.store.enqueue('wrong-untracked',ACTOR,null,'culture_screen',{method:'edit',mid:'untracked',recipient:ACTOR,chat:CHAT,screen:{...current},body:{text:'wrong',attachments:[]}},h.now,h.now+60000,{revision:current.revision});
  assert.throws(()=>h.store.enqueue('wrong-actor',ACTOR,null,'culture_screen',{method:'edit',mid:current.mid!,recipient:OTHER,chat:CHAT,screen:{...current},body:{text:'wrong',attachments:[]}},h.now,h.now+60000,{revision:current.revision}),/ACTOR_MISMATCH/);
  await h.drain();assert.equal(h.ops.length,start);assert.equal(activeScreen(h.store,ACTOR)!.mid,current.mid);
});
test('C16 semantic edit failure creates one replacement; creation must confirm before adoption',async t=>{
  let reject=true;const h=await harness(t,async(op,local)=>{if(op.method==='edit'&&reject){reject=false;throw new MaxError('SEMANTIC',200);}return local.execute(op);});
  const old=activeScreen(h.store,ACTOR)!.mid;h.click('pick');await h.drain();
  assert.notEqual(activeScreen(h.store,ACTOR)!.mid,old);assert.equal(h.ops.filter(o=>o.method==='messages').length,2);assert.equal(h.ops.filter(o=>o.method==='edit').length,1);
  assert.equal(JSON.parse(getState(h.store,ACTOR)!.data).stage,'city');
});
test('C16 replacement cleanup permission failure retires only tracked obsolete keyboard once; failure leaves selection working',async t=>{
  const h=await harness(t,async(op,local)=>{if(op.method==='delete')throw new MaxError('PERMISSION',403);if(op.method==='edit'&&!op.screen)throw new MaxError('SEMANTIC',200);return local.execute(op);});
  const old=activeScreen(h.store,ACTOR)!.mid;h.home();await h.drain();const mid=activeScreen(h.store,ACTOR)!.mid;assert.notEqual(mid,old);
  const cleanup=h.ops.filter(o=>o.method==='delete');assert.equal(cleanup.length,1);assert.equal((cleanup[0] as any).mid,old);
  const retire=h.ops.find(o=>o.method==='edit'&&!o.screen) as Extract<MaxOperation,{method:'edit'}>;assert.deepEqual(retire.body.attachments,[]);assert.equal(retire.mid,old);
  h.click('pick');await h.drain();assert.equal(activeScreen(h.store,ACTOR)!.mid,mid);assert.equal(h.ops.filter(o=>o.method==='delete').length,1);
});
test('C16 ambiguous edit is read/reconciled before the next write; no blind retry',async t=>{
  let fail=true;const h=await harness(t,async(op,local)=>{const r=await local.execute(op);if(op.method==='edit'&&fail){fail=false;throw new MaxError('TIMEOUT_AMBIGUOUS');}return r;});
  h.click('pick');await h.drain();assert.equal(h.ops.filter(o=>o.method==='edit').length,1);assert.equal(h.ops.filter(o=>o.method==='read').length,1);
  h.click('city');await h.drain();assert.equal(h.ops.filter(o=>o.method==='messages').length,1);
  const methods=h.ops.map(o=>o.method);assert(methods.lastIndexOf('edit')>methods.indexOf('read'));
});
test('C16 unresolved read blocks old target; subsequent screen uses one new creation',async t=>{
  let fail=true;const h=await harness(t,async(op,local)=>{if(op.method==='edit'&&fail){fail=false;throw new MaxError('TRANSPORT_AMBIGUOUS');}if(op.method==='read')throw new MaxError('HTTP',404);return local.execute(op);});
  const old=activeScreen(h.store,ACTOR)!.mid;h.click('pick');await h.drain();assert.notEqual(activeScreen(h.store,ACTOR)!.mid,old);
  assert.equal(h.ops.filter(o=>o.method==='messages').length,2); // восстановление без нового пользовательского ввода
  assert.equal(h.ops.filter(o=>o.method==='read').length,1);assert.equal(h.ops.filter(o=>o.method==='edit').length,1);
});
test('C16 in-flight late edit cannot roll state back; one writer; superseded queued views discarded',async t=>{
  let hold=false,release!:()=>void;const pending=new Promise<void>(r=>release=r);
  const h=await harness(t,async(op,local)=>{if(op.method==='edit'&&hold)await pending;return local.execute(op);});
  h.click('pick');h.advance();await h.worker.tick(); // ACK, view pending
  hold=true;h.advance();const sending=h.worker.tick();await h.worker.tick();assert.equal(h.ops.filter(o=>o.method==='edit').length,1);
  h.home();release();await sending;await h.drain();assert.equal(JSON.parse(getState(h.store,ACTOR)!.data).stage,'home');
  assert(h.store.db.prepare("SELECT 1 FROM outbox WHERE result='SENT_BEFORE_NEW_INPUT_OR_SNAPSHOT'").get());
  const count=h.ops.length;h.click('pick');h.home();await h.drain();assert.equal(JSON.parse(getState(h.store,ACTOR)!.data).stage,'home');assert(h.ops.length>count);
  assert(h.store.db.prepare("SELECT 1 FROM outbox WHERE result='FLOW_REVISION_CHANGED'").get());
});
test('C16 worker display guard covers pending edit and saved payload before transport',async t=>{
  const h=await harness(t),s=activeScreen(h.store,ACTOR)!;let calls=0;
  h.store.enqueue('forbidden-edit',ACTOR,null,'culture_screen',{method:'edit',recipient:ACTOR,chat:CHAT,mid:s.mid!,audience:'PROVIDER',screen:{...s},body:{text:'private provider saved context',attachments:[]}},h.now,h.now+60000,{revision:s.revision});
  const worker=new Worker(h.store,{...config,mode:'live'},{execute:async()=>{calls++;return {simulated:false};}},()=>h.now,undefined,h.catalog);await worker.tick();assert.equal(calls,0);
  assert(h.store.db.prepare("SELECT 1 FROM outbox WHERE status='SUPPRESSED_DISPLAY'").get());
});
