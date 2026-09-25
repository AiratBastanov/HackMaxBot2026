import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PollingMax, commitBatch, openCampaign, runPolling, verifyPolling, batchSchema, observeDelivery } from '../src/polling.js';
import { loadPollingConfig, loadCurrentSynthetic, replacementAccess } from '../src/polling-config.js';
import { publicBot, pinInspectedBot } from '../src/inspection.js';
import { PairingWindow, savePairedTester } from '../src/pairing.js';
import { acquireConsumerLock } from '../src/consumer-lock.js';
import { Config, loadConfig } from '../src/config.js';
import { LiveMax, MaxError, type MessageRequest } from '../src/max.js';
import { Storage } from '../src/storage.js';
import { Worker } from '../src/worker.js';
import { createApp } from '../src/app.js';
import { parseJson, subscribedTypes } from '../src/contracts.js';
import { Catalog } from '../src/culture/catalog.js';
import { stage4Fixture } from '../src/culture/stage4-fixture.js';
import { ACTOR, OTHER, BOT, SECRET, encode, reply, callback, message } from './fixtures.js';

const stores = new WeakMap<TestContext,Storage[]>();
function workspace(t: TestContext) {
  const root=resolve('.review/polling-tests');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(resolve(root,'case-'));
  t.after(()=>{for(const s of stores.get(t)??[])if(s.db.open)s.close();assert(dir.startsWith(root+sep));rmSync(dir,{recursive:true});});return dir;
}
function config(path=':memory:'): Config { return {mode:'live',ingress:'test-polling',host:'127.0.0.1',port:3000,databasePath:path,
  apiBaseUrl:'https://platform-api2.max.ru',token:'synthetic-contract-only',botId:BOT,testers:new Set([ACTOR]),probeTtlMs:600000,requestTimeoutMs:100,flowDataMode:'synthetic-test'}; }
function storage(t: TestContext,c=config()) {const s=new Storage(c.databasePath,c);stores.set(t,[...(stores.get(t)??[]),s]);t.after(()=>{if(s.db.open)s.close();});return s;}
const batch=(updates:unknown[],marker:string|null='9007199254740993')=>({updates:updates.map(v=>parseJson(encode(v))),marker});
const signal=()=>new AbortController().signal;

test('Marker выше MAX_SAFE_INTEGER проходит HTTP query и SQLite без округления; limit/types/timeout явные',async t=>{
  const c=config(),s=storage(t,c);const calls:URL[]=[];
  const max=new PollingMax(c,(async(url,init)=>{calls.push(new URL(String(url)));assert.equal(init?.method,'GET');assert.equal((init?.headers as Record<string,string>).Authorization,c.token);
    return new Response('{"updates":[],"marker":9007199254740993}');}) as typeof fetch);
  const first=await max.updates(null,signal(),true);assert.equal(first.marker,'9007199254740993');commitBatch(s,c,first,Date.now());
  await max.updates(s.pollingMarker(),signal());
  assert(!calls[0]!.searchParams.has('marker'));assert.equal(calls[0]!.searchParams.get('timeout'),'0');
  assert.equal(calls[1]!.searchParams.get('marker'),'9007199254740993');assert.equal(calls[1]!.searchParams.get('limit'),'10');
  assert.equal(calls[1]!.searchParams.get('timeout'),'30');assert.equal(calls[1]!.searchParams.get('types'),subscribedTypes.join(','));
  assert(!calls[1]!.searchParams.has('access_token'));
});

test('Nullable/absent cursor означает latest; непустой batch или сброс закреплённого cursor не проглатывается',t=>{
  const c=config(),s=storage(t,c);
  assert.equal(batchSchema.parse(parseJson('{"updates":[]}')).marker,undefined);
  assert.equal(batchSchema.parse(parseJson('{"updates":[],"marker":null}')).marker,null);
  commitBatch(s,c,batch([],null),1);assert.equal(s.pollingMarker(),null);
  assert.throws(()=>commitBatch(s,c,batch([reply(undefined,2,'/start')],null),2),/NULL_MARKER/);
  commitBatch(s,c,batch([],'42'),3);
  assert.throws(()=>commitBatch(s,c,batch([],null),4),/NULL_MARKER/);assert.equal(s.pollingMarker(),'42');
  for(const text of ['{"updates":[],"marker":"42"}','{"updates":[],"marker":9223372036854775808}','{"updates":{}}','{"updates":[],"marker":2.5}']) assert.throws(()=>batchSchema.parse(parseJson(text)));
});

test('Batch атомарен: duplicate/empty; crash после commit сохраняет marker и дедупликацию',t=>{
  const c=config(resolve(workspace(t),'poll.sqlite'));let s=storage(t,c);const event=reply(undefined,Date.now(),'/start');
  assert.deepEqual(commitBatch(s,c,batch([event,event]),Date.now()),{accepted:1,duplicate:1,ignored:0,candidate:undefined});
  s.close();s=storage(t,c);assert.equal(s.pollingMarker(),'9007199254740993');
  assert.equal(commitBatch(s,c,batch([event],'9007199254740995'),Date.now()).duplicate,1);
  assert.equal(s.pendingInbox(10).length,1);commitBatch(s,c,batch([],'9007199254740997'),Date.now());assert.equal(s.pollingMarker(),'9007199254740997');
});

test('Ошибка commit откатывает ВСЕ события и marker; restart оставляет предыдущую границу',t=>{
  const c=config(resolve(workspace(t),'poll.sqlite'));let s=storage(t,c);commitBatch(s,c,batch([],'41'),1);
  s.db.exec("CREATE TEMP TRIGGER fail_marker BEFORE UPDATE ON meta WHEN NEW.key='poll_marker' BEGIN SELECT RAISE(ABORT,'synthetic disk failure'); END");
  assert.throws(()=>commitBatch(s,c,batch([reply(undefined,2,'/start')],'42'),3));assert.equal(s.pendingInbox(10).length,0);assert.equal(s.pollingMarker(),'41');
  s.close();s=storage(t,c);assert.equal(s.pollingMarker(),'41');assert.equal(s.pendingInbox(10).length,0);
});

test('Невалидный relevant event ломает batch; корректный non-tester/неизвестный тип игнорируются безопасно',t=>{
  const c=config(),s=storage(t,c),now=Date.now();
  const ignored=commitBatch(s,c,batch([reply(undefined,now,'/start',OTHER),{update_type:'future_event',timestamp:now}]),now);
  assert.equal(ignored.ignored,2);assert.equal(s.pendingInbox(10).length,0);
  assert.throws(()=>commitBatch(s,c,batch([reply(undefined,now,'/start'),{update_type:'message_created',timestamp:now}],'77'),now));
  assert.equal(s.pendingInbox(10).length,0);assert.equal(s.pollingMarker(),'9007199254740993');
});

test('Сеанс сохраняет deadline, число запросов, retry delay и snapshot через restart',t=>{
  const c=config(resolve(workspace(t),'poll.sqlite'));let s=storage(t,c);const p=openCampaign(s,'start','synthetic',1000);
  p.requests=119;p.lastRequestAt=2000;p.notBefore=6000;s.setMeta('poll_campaign',JSON.stringify(p));s.close();s=storage(t,c);
  assert.deepEqual(openCampaign(s,'resume','synthetic',3000),p);assert.equal(p.deadline,901000);
  assert.throws(()=>openCampaign(s,'start','synthetic',3000),/USE_RESUME/);
  assert.throws(()=>openCampaign(s,'resume','changed',3000),/SNAPSHOT/);
  assert.throws(()=>openCampaign(s,'resume','synthetic',901001),/NOT_RESUMABLE/);
});

test('Wrong identity, webhook и неподтверждённый exclusive consumer запрещают вход',async()=>{
  let count=0;const max=new PollingMax(config(),(async(url)=>{count++;return new Response(String(url).endsWith('/me')?'{"user_id":778,"is_bot":true,"first_name":"Синтетика"}':'{"subscriptions":[]}');}) as typeof fetch);
  await assert.rejects(verifyPolling(max,BOT,true),{kind:'AUTH'});assert.equal(count,1);
  const good={me:async()=>({user_id:BOT,is_bot:true,first_name:'Синтетика'}),subscriptions:async()=>[{url:'https://example.org/private-webhook',time:1}]};
  await assert.rejects(verifyPolling(good,BOT,true),/WEBHOOK_PRESERVED/);
  await assert.rejects(verifyPolling({...good,subscriptions:async()=>[]},BOT,false),/CONFIRMATION/);
});

test('Явный start на 30 минут сохраняет предел 120 запросов; resume не продлевает deadline',t=>{
  const c=config(),s=storage(t,c),p=openCampaign(s,'start','synthetic',1000,30);
  assert.equal(p.deadline,1801000);p.requests=119;s.setMeta('poll_campaign',JSON.stringify(p));
  const resumed=openCampaign(s,'resume','synthetic',1000000);
  assert.equal(resumed.deadline,p.deadline);assert.equal(resumed.requests,119);
  assert.throws(()=>openCampaign(s,'resume','synthetic',1000000,30),/EXPLICIT_START/);
  assert.throws(()=>openCampaign(s,'start','synthetic',1000000,30),/USE_RESUME/);
  const other=storage(t,c);assert.throws(()=>openCampaign(other,'start','synthetic',1000,60 as 30),/EXPLICIT_START/);
  assert.equal(openCampaign(other,'start','synthetic',1000).deadline,901000);
});

test('OS mutex отвергает второй процесс и освобождается после остановки владельца',async()=>{
  const release=await acquireConsumerLock(BOT);
  try {
    await assert.rejects(acquireConsumerLock(BOT),/SECOND_LOCAL_CONSUMER/);
    const code=`import {acquireConsumerLock} from ${JSON.stringify(new URL('../src/consumer-lock.js',import.meta.url).href)};try {const release=await acquireConsumerLock('${BOT}');await release();process.exitCode=3;}catch {process.stdout.write('REFUSED');}`;
    const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{timeout:5000,windowsHide:true});assert.equal(result.stdout,'REFUSED');
  } finally {await release();}
  await (await acquireConsumerLock(BOT))();
});

test('Медленный GET проходит при коротком POST deadline; отмена и body limit ограничены',async()=>{
  const c=config();const fetcher=(async(_url,init)=>{await delay(180,undefined,{signal:init?.signal??undefined});return new Response('{"updates":[],"marker":42}');}) as typeof fetch;
  assert.equal((await new PollingMax(c,fetcher).updates(null,signal())).marker,'42');
  await assert.rejects(new LiveMax(c,fetcher).execute({method:'answers',callbackId:'synthetic',body:{notification:'Тест'}}),{kind:'TIMEOUT_AMBIGUOUS'});
  const controller=new AbortController();const pending=new PollingMax(c,fetcher).updates(null,controller.signal);controller.abort();await assert.rejects(pending,{kind:'CANCELLED'});
  await assert.rejects(new PollingMax(c,(async()=>new Response(' '.repeat(262145))) as typeof fetch).updates(null,signal()),{kind:'MALFORMED'});
  const bodyController=new AbortController();let cancelled=false;
  const hanging=new PollingMax(c,(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))) as typeof fetch).updates(null,bodyController.signal);
  await delay(10);bodyController.abort();await assert.rejects(hanging,{kind:'CANCELLED'});assert(cancelled);
});

test('Test-only конфигурация без public origin/secret, с dedicated DB; обычный webhook сохраняет требования',t=>{
  const env={APP_MODE:'live',APP_INGRESS:'test-polling',FLOW_DATA_MODE:'synthetic-test',PUBLIC_DISPLAY:'NOT_CLEARED',LIVE_SCOPE_CONFIRMED:'true',MAX_EXPECTED_BOT_ID:BOT,PROBE_TESTER_IDS:ACTOR,DATA_SNAPSHOT_PATH:'runtime/max-test/current.json'};
  const options={testerPath:resolve(workspace(t),'testers.json'),access:()=>({token:'synthetic-contract-only',apiBaseUrl:'https://platform-api2.max.ru',requestTimeoutMs:5000,expectedBotId:BOT})};
  const c=loadPollingConfig(env,false,options);assert.equal(c.webhookSecret,undefined);assert.equal(c.publicBaseUrl,undefined);assert(c.databasePath.endsWith(`${BOT}.sqlite`));
  assert.throws(()=>createApp(c),/WEBHOOK_INGRESS/);assert.throws(()=>loadConfig(env),/live:poll/);
  for(const patch of [{APP_MODE:'local'},{MAX_EXPECTED_BOT_ID:''},{FLOW_DATA_MODE:'real'},{PUBLIC_DISPLAY:'CLEARED'},{PUBLIC_BASE_URL:'https://example.org'},{MAX_WEBHOOK_SECRET:SECRET},{FLOW_TEST_CLOCK:'2030-01-01T00:00:00Z'},{DATABASE_PATH:'runtime/local.sqlite'},{PROBE_TESTER_IDS:''}]) assert.throws(()=>loadPollingConfig({...env,...patch},false,options));
  assert.throws(()=>loadConfig({APP_MODE:'live',DATABASE_PATH:':memory:',MAX_WEBHOOK_SECRET:SECRET,PROBE_TESTER_IDS:ACTOR,MAX_EXPECTED_BOT_ID:BOT,MAX_BOT_TOKEN:'synthetic-contract-only',LIVE_SCOPE_CONFIRMED:'true'}),/PUBLIC_BASE_URL/);
  assert.throws(()=>replacementAccess({MAX_BOT_TOKEN_FILE:'secrets/max_bot_token'}),/ROTATION_PENDING/);
  assert.throws(()=>replacementAccess({MAX_CREDENTIAL_ROTATION_CONFIRMED:'true',MAX_BOT_TOKEN_FILE:'unrelated'}),/DESIGNATED/);
});

test('Только свежая синтетика; чужая DB identity и recovery quarantine сохраняют блокировки',t=>{
  const dir=workspace(t),c=config(resolve(dir,'test.sqlite'));c.snapshotPath=resolve(dir,'catalog.json');
  writeFileSync(c.snapshotPath,JSON.stringify(stage4Fixture(new Date())));assert(loadCurrentSynthetic(c).snapshot);
  assert.throws(()=>loadCurrentSynthetic(c,Date.now()+3600001),/FRESH_SYNTHETIC/);
  const s=storage(t,c);s.close();assert.throws(()=>new Storage(c.databasePath,{mode:'live',botId:BOT}),/другому/);
  const reopened=storage(t,c);reopened.setMeta('recovery_state','QUARANTINED');reopened.close();assert.throws(()=>new Storage(c.databasePath,c),/QUARANTINED/);
});

test('Проверенное username создаёт ссылку; конфликт pin не меняет ни один config',t=>{
  assert.equal(publicBot({user_id:BOT,first_name:'Имя не username',is_bot:true}).botLink,null);
  assert.equal(publicBot({user_id:BOT,first_name:'Синтетика',username:'synthetic_bot',is_bot:true}).botLink,'https://max.ru/synthetic_bot');
  const dir=workspace(t),a=resolve(dir,'.env.inspect'),b=resolve(dir,'.env.polling');writeFileSync(a,'UNRELATED=keep\n');writeFileSync(b,'MAX_EXPECTED_BOT_ID=778\n');
  assert.throws(()=>pinInspectedBot(BOT,[a,b]),/MISMATCH/);assert.equal(readFileSync(a,'utf8'),'UNRELATED=keep\n');
  writeFileSync(b,'OTHER=keep\n');pinInspectedBot(BOT,[a,b]);assert.match(readFileSync(a,'utf8'),/UNRELATED=keep/);assert.match(readFileSync(b,'utf8'),/MAX_EXPECTED_BOT_ID=777/);
});

test('Pairing: только exact code, actor из decoder, expiration/replay и отдельное подтверждение',t=>{
  const now=Date.now(),p=new PairingWindow(BOT,now),p2=new PairingWindow(BOT,now);assert.notEqual(p.code,p2.code);assert.equal(p.code.length,32);
  const raw=(text:string,actor=ACTOR,at=now+1)=>parseJson(encode(reply(undefined,at,text,actor)));
  assert.equal(p.find(raw('/start'),now+2),undefined);assert.equal(p.find(raw('/pair wrong'),now+2),undefined);
  assert.equal(p.find(raw(`/pair ${p.code}`),now+2),ACTOR);
  assert.equal(p.find(raw(`/pair ${p.code}`),p.expiresAt),undefined);assert.equal(p.find(raw(`/pair ${p.code}`,ACTOR,now-1),now),undefined);
  const c=config(),s=storage(t,c);const result=commitBatch(s,c,{updates:[raw(`/pair ${p.code}`)],marker:'42'},now+2,p);
  assert.equal(result.candidate,ACTOR);assert.equal(s.pendingInbox(10).length,0);assert.equal(p.find(raw(`/pair ${p.code}`,OTHER),now+3),undefined);
  const file=resolve(workspace(t),'testers.json');assert(!existsSync(file));savePairedTester(BOT,p.confirm(true,now+3),file);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{botId:BOT,testers:[ACTOR]});assert(!readFileSync(file,'utf8').includes(p.code));
  assert.throws(()=>p.confirm(true,now+4),/EXPIRED/);p2.bind(OTHER);assert.throws(()=>p2.confirm(false,now+4),/NOT_CONFIRMED/);
});

test('Pairing не связывает actor до commit; два actor с одним кодом отвергаются',t=>{
  const now=Date.now(),p=new PairingWindow(BOT,now),c=config(),s=storage(t,c);
  const event=(actor:string)=>reply(undefined,now+1,`/pair ${p.code}`,actor,`pair-${actor}`);
  assert.throws(()=>commitBatch(s,c,batch([event(ACTOR),event(OTHER)]),now+2,p),/MULTIPLE_ACTORS/);assert.equal(s.getMeta('poll_marker'),undefined);
  const expired=new PairingWindow(BOT,now);expired.bind(ACTOR);assert.throws(()=>expired.confirm(true,expired.expiresAt),/EXPIRED/);
});

test('Три ошибки останавливают polling; Retry-After и частота сохраняются',async t=>{
  const c=config(),s=storage(t,c);let now=10000,requests=0;const times:number[]=[];const campaign=openCampaign(s,'start','synthetic',now);
  const max={subscriptions:async()=>[],updates:async()=>{times.push(now);requests++;throw new MaxError('RATE_LIMIT',429,7000);}};
  await assert.rejects(runPolling({max,store:s,config:c,campaign,signal:signal(),clock:()=>now,wait:async ms=>{now+=ms;}}),{kind:'RATE_LIMIT'});
  assert.equal(requests,3);assert(times[1]!-times[0]!>=7000);assert(times[2]!-times[1]!>=7000);
  assert.throws(()=>openCampaign(s,'resume','synthetic',now),/NOT_RESUMABLE/);
});

test('AUTH/webhook/malformed не повторяются и не двигают cursor',async t=>{
  for(const failure of [new MaxError('AUTH',401),new MaxError('MALFORMED',200),new MaxError('HTTP',405)]) {
    const c=config(),s=storage(t,c),campaign=openCampaign(s,'start','synthetic');let calls=0;
    await assert.rejects(runPolling({max:{subscriptions:async()=>[],updates:async()=>{calls++;throw failure;}},store:s,config:c,campaign,signal:signal()}));
    assert.equal(calls,1);assert.equal(s.getMeta('poll_marker'),undefined);
  }
  const c=config(),s=storage(t,c),campaign=openCampaign(s,'start','synthetic');
  await assert.rejects(runPolling({max:{subscriptions:async()=>[{url:'https://example.org/hook',time:1}],updates:async()=>{assert.fail('updates forbidden');}},store:s,config:c,campaign,signal:signal()}),/WEBHOOK_PRESERVED/);assert.equal(campaign.requests,0);
});

test('120 запросов / deadline / отмена не сбрасывают campaign или cursor',async t=>{
  const c=config(),s=storage(t,c);let now=10000;const campaign=openCampaign(s,'start','synthetic',now);campaign.requests=119;
  let calls=0;await runPolling({max:{subscriptions:async()=>[],updates:async()=>{calls++;return batch([],'42');}},store:s,config:c,campaign,signal:signal(),clock:()=>now,wait:async ms=>{now+=ms;}});
  assert.equal(calls,1);assert.equal(JSON.parse(s.getMeta('poll_campaign')!).requests,120);
  const s2=storage(t,c),p2=openCampaign(s2,'start','synthetic',now),controller=new AbortController();
  await runPolling({max:{subscriptions:async()=>[],updates:async()=>{controller.abort();return batch([],'77');}},store:s2,config:c,campaign:p2,signal:controller.signal,clock:()=>now});
  assert.equal(s2.getMeta('poll_marker'),undefined);assert.equal(JSON.parse(s2.getMeta('poll_campaign')!).requests,1);
  const s3=storage(t,c),p3=openCampaign(s3,'start','synthetic',now);p3.notBefore=p3.deadline+1;
  await runPolling({max:{subscriptions:async()=>[],updates:async()=>{assert.fail();}},store:s3,config:c,campaign:p3,signal:signal(),clock:()=>now});assert.equal(p3.requests,0);
});

test('Реальный transport сохраняет provider guard и не позволяет subscribe из polling',async()=>{
  let calls=0;const max=new LiveMax(config(),(async()=>{calls++;assert.fail();}) as typeof fetch);
  await assert.rejects(max.execute({method:'messages',recipient:ACTOR,body:{text:'provider'},audience:'PROVIDER'}),{kind:'PERMISSION'});
  await assert.rejects(max.subscribe('https://example.org',[]),/FORBIDDEN/);assert.equal(calls,0);
});

test('Исходящая AUTH немедленно останавливает campaign; повторяющиеся send errors переживают restart',t=>{
  const c=config(),s=storage(t,c),p=openCampaign(s,'start','synthetic');
  const error={operation:'messages',errorClass:'SERVER'};
  assert.equal(observeDelivery(s,p,error),false);assert.equal(observeDelivery(s,p,error),false);
  const resumed=openCampaign(s,'resume','synthetic');assert.equal(resumed.sendErrors,2);assert.equal(observeDelivery(s,resumed,error),true);
  assert.throws(()=>openCampaign(s,'resume','synthetic'),/NOT_RESUMABLE/);
  const s2=storage(t,c),p2=openCampaign(s2,'start','synthetic');assert.equal(observeDelivery(s2,p2,{operation:'answers',errorClass:'AUTH'}),true);
});

test('HTTP E2E: updates → decoder/admission/SQLite/worker/renderer → outgoing MAX; worker отвечает во время long poll',async t=>{
  const dir=workspace(t),c=config(resolve(dir,'session.sqlite'));c.requestTimeoutMs=3000;
  let now=Date.now(),seq=0,marker=9007199254740993n;const snapshot=stage4Fixture(new Date(now)),catalog=new Catalog('synthetic-test',snapshot);
  let incoming:unknown[]=[],hold=false,releaseHeld:(()=>void)|undefined;const screens:MessageRequest[]=[],transcript:string[]=[];
  const remote=new Map<string,{recipient:string;body:MessageRequest}>(),methods:string[]=[];
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url!,'http://localhost');res.setHeader('Content-Type','application/json');
      if(url.pathname==='/updates') {if(hold)await new Promise<void>(r=>{releaseHeld=r;});const updates=incoming;incoming=[];res.end(encode({updates,marker:marker++}));return;}
      if(url.pathname==='/subscriptions'){res.end('{"subscriptions":[]}');return;}
      if(url.pathname==='/me'){res.end(encode({user_id:777,is_bot:true,first_name:'СИНТЕТИКА'}));return;}
      let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):null;
      if(url.pathname.startsWith('/messages/')) {
        methods.push('GET');const mid=decodeURIComponent(url.pathname.slice('/messages/'.length)),known=remote.get(mid);
        if(!known){res.statusCode=404;res.end('{}');return;}
        const m=message(known.recipient,mid);res.end(encode({...m,body:{...m.body,...known.body}}));return;
      }
      if(url.pathname==='/messages') {
        methods.push(req.method!);
        if(req.method==='POST') {
          const mid=`out-${++seq}`,recipient=url.searchParams.get('user_id')!;remote.set(mid,{recipient,body});screens.push(body);transcript.push(body.text);res.end(encode({message:{...message(recipient,mid),body:{...message(recipient,mid).body,...body}}}));return;
        }
        const mid=url.searchParams.get('message_id')!,known=remote.get(mid);
        if(!known){res.end('{"success":false}');return;}
        if(req.method==='PUT'){assert(Array.isArray(body.attachments));assert.equal(body.notify,false);known.body=body;screens.push(body);transcript.push(body.text);}
        else if(req.method==='DELETE')remote.delete(mid);
        res.end('{"success":true}');return;
      }
      if(url.pathname==='/answers'){res.end('{"success":true}');return;}
      res.statusCode=404;res.end('{}');
    } catch {res.statusCode=500;res.end('{}');}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert(address&&typeof address!=='string');
  t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
  const fetcher=(async(url,init)=>{const target=new URL(String(url));return fetch(`http://127.0.0.1:${address.port}${target.pathname}${target.search}`,init);}) as typeof fetch;
  const max=new PollingMax(c,fetcher);await verifyPolling(max,BOT,true);
  let s=storage(t,c),worker=new Worker(s,c,new LiveMax(c,fetcher),()=>now,undefined,catalog);
  const drain=async()=>{for(let i=0;i<12;i++){now+=1200;await worker.tick();if(!s.pendingInbox(1).length&&!s.pendingOutbox(now))return;}assert.fail('worker not drained');};
  const send=async(event:unknown)=>{incoming=[event];commitBatch(s,c,await max.updates(s.pollingMarker(),signal()),now);await drain();};
  await send(reply(undefined,++now,'/start',ACTOR,'start'));
  assert.match(screens.at(-1)!.text,/Культурный план/);
  const click=async(text:string)=>{const b=screens.at(-1)!.attachments!.flatMap(a=>a.payload.buttons.flat()).find(b=>b.text===text);assert(b&&b.type==='callback',text);const v=callback('',`cb-${++seq}`,ACTOR,++now);v.callback.payload=b.payload;v.message.body.mid=(s.db.prepare('SELECT mid FROM flow_screens WHERE actor=?').get(ACTOR) as {mid:string}).mid;await send(v);};
  for(const label of ['Подобрать','Казань','Завтра','12:00–18:00','Продолжить','До 500 ₽','Театр','Показать результаты'])await click(label);
  assert.match(screens.at(-1)!.text,/Совпадает по известным условиям/);assert.doesNotMatch(screens.at(-1)!.text,/мастерская/);
  await click('Подробнее 1');await click('Условия посещения');assert.match(screens.at(-1)!.text,/200|регистрац/);
  await click('К карточке');await click('Сохранить');assert.equal((s.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,1);
  await click('Мои события');await click('Открыть 1');await click('Удалить закладку');await click('Да, удалить');
  assert.equal((s.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
  await click('Главная');for(const label of ['Подобрать','Казань','Завтра','12:00–18:00','Продолжить','До 500 ₽','Театр','Показать результаты','Показать варианты для проверки'])await click(label);
  assert.match(screens.at(-1)!.text,/Варианты, где нужно уточнение/);await click('Подробнее 3');assert.match(screens.at(-1)!.text,/Нужно уточнить|тариф/);await click('Сохранить');
  const savedMarker=s.pollingMarker();await worker.stop();s.close();s=storage(t,c);worker=new Worker(s,c,new LiveMax(c,fetcher),()=>now,undefined,catalog);
  assert.equal(s.pollingMarker(),savedMarker);await send(reply(undefined,++now,'/saved',ACTOR,'saved-after-restart'));assert.match(screens.at(-1)!.text,/мастерская/);
  // Второй GET ждёт; worker уже может доставить ответ на ранее committed input.
  incoming=[reply(undefined,++now,'/start',ACTOR,'parallel-start')];commitBatch(s,c,await max.updates(s.pollingMarker(),signal()),now);
  hold=true;const pending=max.updates(s.pollingMarker(),signal());while(!releaseHeld)await delay(5);
  const before=screens.length;await drain();assert(screens.length>before);releaseHeld();await pending;
  assert.equal((s.db.prepare("SELECT count(*) n FROM outbox WHERE status='ACKNOWLEDGED'").get() as {n:number}).n>0,true);
  assert.equal((s.db.prepare("SELECT count(*) n FROM inbox WHERE status='FAILED'").get() as {n:number}).n,0);
  // Сообщённое в real-client сеансе расхождение: /saved после erasure не должен снова просить подтверждение.
  hold=false;await send(reply(undefined,++now,'/delete_data',ACTOR,'erase-command'));
  await click('Да, удалить');
  for(const client of ['mobile','web']) {
    await send(reply(undefined,++now,'/saved',ACTOR,`saved-after-erase-${client}`));
    assert.match(screens.at(-1)!.text,/Закладок пока нет/);
    assert.doesNotMatch(screens.at(-1)!.text,/Удалить все ваши/);
    const labels=screens.at(-1)!.attachments!.flatMap(a=>a.payload.buttons.flat()).map(b=>b.text);
    assert(!labels.includes('Да, удалить мои данные'));assert(!labels.includes('Да, удалить'));
  }
  assert.equal((s.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
  const current=s.db.prepare('SELECT mid,chat FROM flow_screens WHERE actor=?').get(ACTOR) as {mid:string;chat:string};
  const read=await new LiveMax(c,fetcher).execute({method:'read',mid:current.mid,chat:current.chat,recipient:ACTOR});assert.match(read.message!.text,/Закладок пока нет/);
  assert(methods.includes('PUT'));assert(methods.includes('DELETE'));assert(methods.includes('GET'));
  mkdirSync('.review/compact-ux',{recursive:true});writeFileSync('.review/compact-ux/polling-synthetic-transcript.md','# Локальный polling HTTP E2E; реальные клиенты NOT_VERIFIED\n\n'+transcript.map(s=>s.replace(/\b[A-F0-9]{6}\b/g,'<код формы>')).join('\n\n---\n\n'));
});
