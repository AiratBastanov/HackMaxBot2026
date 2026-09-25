import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { Catalog } from '../src/culture/catalog.js';
import { loadConfig } from '../src/config.js';
import { snapshotDigest } from '../src/data/source-policy.js';
import { parseJson } from '../src/contracts.js';
import { ACTOR, BOT, CHAT, OTHER, encode, lifecycle, callback, reply, message } from '../tests/fixtures.js';
import type { MessageRequest, Button } from '../src/max.js';

// Закрытый disposable harness: actual index/HTTP/worker/SQLite/LiveMax, MAX только на loopback.
// Запускать через выбранный Compose app с network_mode:none, без Caddy и без портов.
async function main() {
  const config=loadConfig(process.env),root=dirname(config.databasePath),catalog=Catalog.load(config);
  assert.equal(config.token,'offline-webhook-smoke-token');assert.equal(config.botId,BOT);
  assert.equal(config.flowDataMode,'real');assert.equal(process.getuid?.(),1000);
  assert.equal(config.publicBaseUrl,'https://offline-webhook.example.org');
  assert.equal(config.testers.size,1);assert(config.testers.has(ACTOR));
  for(const path of ['/app/package.json',config.snapshotPath!,process.env.MAX_BOT_TOKEN_FILE!]) {
    assert.throws(()=>{const fd=openSync(path,'r+');closeSync(fd);},/EROFS|EACCES/);
  }
  mkdirSync(process.env.LIVE_SUBSCRIPTION_JOURNAL_DIR!,{recursive:true});
  const journal=resolve(process.env.LIVE_SUBSCRIPTION_JOURNAL_DIR!,'smoke-sentinel');
  const checkpoint=resolve(root,'smoke-checkpoint.json'),second=existsSync(checkpoint);
  const previous=second?JSON.parse(readFileSync(checkpoint,'utf8')):null;
  if(second)assert.equal(readFileSync(journal,'utf8'),'disposable journal persists');
  else writeFileSync(journal,'disposable journal persists');
  const ops:{method:string;path:string}[]=[],messages=new Map<string,MessageRequest>();
  const runId=randomUUID();
  let active='',seq=0,child:ChildProcess|undefined,output='',wrongIdentity=false;
  const simulator=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url!,'http://127.0.0.1');const method=req.method!;
      ops.push({method,path:url.pathname});assert.equal(req.headers.authorization,config.token);
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const body=chunks.length?parseJson(Buffer.concat(chunks).toString()) as MessageRequest:undefined;
      let result:unknown;
      if(method==='GET'&&url.pathname==='/me')result={user_id:BigInt(wrongIdentity?'778':BOT),is_bot:true,first_name:'Offline MAX'};
      else if(method==='POST'&&url.pathname==='/messages'){
        assert.equal(url.searchParams.get('user_id'),ACTOR);active='offline-'+Date.now()+'-'+(++seq);messages.set(active,body!);
        result={message:{...message(ACTOR,active,CHAT),body:{mid:active,seq:1,...body}}};
      }else if(method==='PUT'&&url.pathname==='/messages') {active=url.searchParams.get('message_id')!;messages.set(active,body!);result={success:true};}
      else if(method==='DELETE'&&url.pathname==='/messages'){messages.delete(url.searchParams.get('message_id')!);result={success:true};}
      else if(method==='POST'&&url.pathname==='/answers')result={success:true};
      else throw Error('UNEXPECTED_MAX_OPERATION');
      res.writeHead(200,{'content-type':'application/json'});res.end(encode(result));
    }catch {res.writeHead(500);res.end('{}');}
  });
  await new Promise<void>(r=>simulator.listen(0,'127.0.0.1',r));
  const address=simulator.address();assert(address&&typeof address!=='string');
  const env={...process.env,WEBHOOK_SMOKE_ORIGIN:`http://127.0.0.1:${address.port}`};
  const url=`http://127.0.0.1:${config.port}`;
  const launch=(patch:NodeJS.ProcessEnv={})=>{
    output='';child=spawn(process.execPath,['--import',resolve('dist/scripts/webhook-smoke-fetch.js'),'dist/src/index.js'],{env:{...env,...patch},stdio:['ignore','pipe','pipe']});
    child.stdout!.on('data',c=>{output+=c;});child.stderr!.on('data',c=>{output+=c;});
    return child;
  };
  const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await Promise.race([done,delay(17000).then(()=>{throw Error('SHUTDOWN_TIMEOUT');})]);assert.equal(child.exitCode,0);}child=undefined;};
  const ready=async()=>{for(let i=0;i<150;i++){if(child?.exitCode!==null)throw Error('STARTUP_FAILED: '+output);try{if((await fetch(url+'/healthz')).ok)return;}catch{}await delay(40);}throw Error('HEALTH_TIMEOUT');};
  const screen=()=>messages.get(active)!;
  const buttons=():Button[]=>screen()?.attachments?.flatMap(a=>a.payload.buttons.flat())??[];
  const dbRead=(sql:string)=>{const db=new Database(config.databasePath,{readonly:true});try{return db.prepare(sql).all();}finally{db.close();}};
  const drain=async()=>{for(let i=0;i<250;i++){const rows=dbRead("SELECT (SELECT count(*) FROM inbox WHERE status='PENDING')+(SELECT count(*) FROM outbox WHERE status IN ('PENDING','SENDING')) AS n") as {n:number}[];if(rows[0]!.n===0)return;await delay(40);}throw Error('WORKER_TIMEOUT');};
  const post=async(value:unknown,secret=config.webhookSecret!)=>fetch(url+'/webhooks/max',{method:'POST',headers:{'content-type':'application/json','x-max-bot-api-secret':secret},body:encode(value),signal:AbortSignal.timeout(5000)});
  const say=async(text:string)=>{assert.equal((await post(reply(undefined,Date.now(),text,ACTOR,`offline-input-${runId}-${++seq}`))).status,200);await drain();};
  const click=async(label:string)=>{const b=buttons().find(b=>b.text===label||label==='Завтра'&&b.text.startsWith('Завтра · '));assert(b?.type==='callback',`BUTTON: ${label}`);const update=callback('',`offline-cb-${runId}-${++seq}`,ACTOR,Date.now());update.callback.payload=b.payload;update.message.body.mid=active;assert.equal((await post(update)).status,200);await drain();};
  const preflight=(patch:NodeJS.ProcessEnv={},pass=true)=>{
    const p=spawnSync(process.execPath,['dist/scripts/live-preflight.js'],{env:{...process.env,...patch},encoding:'utf8',timeout:10000});
    assert.equal(p.status===0,pass,'PREFLIGHT_EXPECTATION');return JSON.parse(p.stdout||p.stderr);
  };
  try {
    const prep=preflight();assert.equal(prep.catalogVersion,catalog.version);
    launch();await ready();assert.equal((await post(lifecycle(), 'wrong')).status,401);
    assert.equal((await (await post(lifecycle('bot_started',Date.now(),OTHER))).json() as any).status,'ignored');
    if(!second) {
      await say('/start');
      for(const label of ['Подобрать','Казань','Завтра','12:00–18:00','Продолжить','До 500 ₽','Любая тема','Показать результаты','Подробнее 1'])await click(label);
      assert.match(screen().text,/Гелий Коржев|Казанское Поволжье/);assert(buttons().some(b=>b.type==='link'&&b.url.startsWith('https://kazan-kremlin.ru/')));
      await click('Условия посещения');await click('К карточке');await click('Сохранить');
      const rows=dbRead('SELECT * FROM bookmarks');assert.equal(rows.length,1);
      await stop();writeFileSync(checkpoint,JSON.stringify({catalogVersion:catalog.version,bookmarkHash:snapshotDigest(rows)}));
    }else {
      assert.notEqual(catalog.version,previous.catalogVersion,'Atomic pointer update must be visible in the same container');
      assert.equal(snapshotDigest(dbRead('SELECT * FROM bookmarks')),previous.bookmarkHash);
      await say('/saved');await click('Открыть 1');assert.match(screen().text,/Сохранено ·/);
      await click('Удалить закладку');assert.deepEqual(buttons().map(b=>b.text),['Да, удалить','Отмена']);await click('Отмена');assert.match(screen().text,/Сохранено ·/);
      await stop();
      // Производные повреждённые/просроченные fixtures только в disposable runtime.
      const corrupt=resolve(root,'corrupt.json');writeFileSync(corrupt,'{');
      const pointer=JSON.parse(readFileSync(config.snapshotPath!,'utf8'));
      const snapshot=resolve(dirname(config.snapshotPath!),pointer.snapshot),review=JSON.parse(readFileSync(resolve(dirname(config.snapshotPath!),pointer.review),'utf8'));
      review.entries.forEach((e:any)=>{e.validUntil='2000-01-01T00:00:00.000Z';});
      const expired=resolve(root,'expired.review.json');writeFileSync(expired,JSON.stringify(review));
      for(const patch of [{DATA_SNAPSHOT_PATH:resolve(root,'missing.json')},{DATA_SNAPSHOT_PATH:corrupt},{DATA_SNAPSHOT_PATH:snapshot,DATA_REVIEW_PATH:expired}]) {
        preflight(patch,false);launch(patch);await ready();await say('/saved');assert.doesNotMatch(screen().text,/Гелий Коржев|Казанское Поволжье/);
        await click('Открыть 1');assert.match(screen().text,/недоступ|не подтвержд/i);await click('Удалить закладку');assert.deepEqual(buttons().map(b=>b.text),['Да, удалить','Отмена']);await click('Отмена');
        await say('/start');assert(buttons().some(b=>b.text==='Подобрать'));await stop();
      }
      for(const patch of [{PUBLIC_BASE_URL:''},{MAX_WEBHOOK_SECRET_FILE:resolve(root,'missing-secret')},{MAX_BOT_TOKEN:'duplicate'},{FLOW_DATA_MODE:'synthetic-test'},{LIVE_SUBSCRIPTION_JOURNAL_DIR:'/app/forbidden/journal'}])preflight(patch,false);
      wrongIdentity=true;const bad=launch();await Promise.race([once(bad,'exit'),delay(10000).then(()=>{throw Error('IDENTITY_TIMEOUT');})]);assert.equal(bad.exitCode,1);child=undefined;
      assert.doesNotMatch(output,/offline-webhook-smoke-token/);
    }
    assert(!ops.some(o=>o.path==='/subscriptions'||o.path==='/updates'));
    const result={result:'LOCAL_INTEGRATION_SMOKE_PASS',phase:second?'restart-current-and-failures':'save-before-activation',at:new Date().toISOString(),catalogVersion:catalog.version,nonRoot:true,readOnlyMounts:true,network:'NONE; simulated MAX on loopback',realIngress:'NOT_VERIFIED',subscriptionMutations:0,processes:'STOPPED',operations:ops.reduce<Record<string,number>>((a,o)=>{const k=o.method+' '+o.path;a[k]=(a[k]??0)+1;return a;},{})};
    writeFileSync(resolve(root,second?'smoke-second.json':'smoke-first.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await new Promise<void>((r,e)=>simulator.close(x=>x?e(x):r()));}
}
main().catch(e=>{console.error(JSON.stringify({result:'LOCAL_INTEGRATION_SMOKE_FAILED',error:e instanceof Error?e.message:'ERROR'}));process.exitCode=1;});
