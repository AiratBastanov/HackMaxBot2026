import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {loadConfig} from '../src/config.js';
import {stage4Fixture} from '../src/culture/stage4-fixture.js';
import {parseJson} from '../src/contracts.js';
import type {MessageRequest,Button} from '../src/max.js';
import {ACTOR,CHAT,BOT,reply,callback,message,encode} from '../tests/fixtures.js';
import {readReviewedCatalog} from '../src/catalog-prepare.js';
import {Catalog} from '../src/culture/catalog.js';

// Явно запускаемый изолированный тест. Обычные entrypoints не загружают preload.
// Отказ с любым настоящим токеном; внешний MAX host в конфиге по-прежнему фиксирован.
async function main() {
  if(readFileSync(process.env.MAX_BOT_TOKEN_FILE!,'utf8').trim()!=='offline-webhook-smoke-token')throw Error('Только синтетический секрет');
  const scripts=dirname(fileURLToPath(import.meta.url)),initializing=process.argv.includes('--initialize');
  const organizer=process.argv.includes('--organizer'),serving=process.argv.includes('--serve');
  const botId=organizer?'9007199254740997':BOT,username='organizer_synthetic_bot';
  if(serving&&!organizer)throw Error('Для --serve нужен --organizer');
  let subscribed=false;
  const messages=new Map<string,MessageRequest>(),updates:unknown[]=[],requests:{method:string;path:string;marker:string|null}[]=[];
  let marker=100,deliveredMarker=0,seq=0,active='',output='',child:ChildProcess|undefined;
  const server=createServer(async(req,res)=>{
    try {
      const u=new URL(req.url!,'http://127.0.0.1'),method=req.method!;
      requests.push({method,path:u.pathname,marker:u.searchParams.get('marker')});
      assert.equal(req.headers.authorization,'offline-webhook-smoke-token');
      const chunks:Buffer[]=[];for await(const b of req)chunks.push(Buffer.from(b));
      const body=chunks.length?parseJson(Buffer.concat(chunks).toString()) as MessageRequest:undefined;
      let result:unknown;
      if(method==='GET'&&u.pathname==='/me')result={user_id:BigInt(botId),is_bot:true,first_name:'Синтетический бот',...(organizer?{username}:{})};
      else if(method==='GET'&&u.pathname==='/subscriptions')result={subscriptions:subscribed?[{url:'https://integration.example.org/webhook',time:1,update_types:[]}]:[]};
      else if(!initializing&&method==='GET'&&u.pathname==='/updates') {const batch=updates.splice(0,10);
        // Fixtures адресованы базовой test identity; сценарий own-bot использует
        // другую точную identity, которую только что вернул симулятор GET /me.
        if(organizer)for(const update of batch){const u=update as any,m=u.message;if(u.update_type==='message_created'&&m?.recipient?.user_id!==undefined)m.recipient.user_id=BigInt(botId);if(m?.sender?.is_bot)m.sender.user_id=BigInt(botId);}
        marker=Math.max(marker,Number(u.searchParams.get('marker')??0))+1;result={updates:batch,marker};if(batch.length)deliveredMarker=marker;}
      else if(!initializing&&method==='POST'&&u.pathname==='/messages') {
        assert.equal(u.searchParams.get('user_id'),ACTOR);active=`setup-message-${++seq}`;messages.set(active,body!);
        const sent=message(ACTOR,active,CHAT);sent.sender.user_id=BigInt(botId);
        result={message:{...sent,body:{mid:active,seq:1,...body}}};
      }else if(!initializing&&method==='PUT'&&u.pathname==='/messages') {const mid=u.searchParams.get('message_id')!;assert(messages.has(mid));messages.set(mid,body!);result={success:true};}
      else if(!initializing&&method==='DELETE'&&u.pathname==='/messages') {const mid=u.searchParams.get('message_id')!;assert.notEqual(mid,active);messages.delete(mid);result={success:true};}
      else if(!initializing&&method==='POST'&&u.pathname==='/answers')result={success:true};
      else throw Error('Непредусмотренная операция симулятора');
      res.writeHead(200,{'content-type':'application/json'});res.end(encode(result));
    }catch{res.writeHead(500);res.end('{}');}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();assert(address&&typeof address!=='string');
  const baseEnv={...process.env,MAX_EXPECTED_BOT_ID:initializing&&organizer?undefined:botId,WEBHOOK_SMOKE_ORIGIN:`http://127.0.0.1:${address.port}`};
  const launch=(script:string,args:string[]=[],env:NodeJS.ProcessEnv=baseEnv,preload=true)=>{
    output='';child=spawn(process.execPath,[...(preload?['--import',resolve(scripts,'webhook-smoke-fetch.js')]:[]),resolve(scripts,script),...args],{env,stdio:['ignore','pipe','pipe']});
    child.stdout!.on('data',b=>{output+=b;});child.stderr!.on('data',b=>{output+=b;});return child;
  };
  const exited=async(expected=0)=>{const p=child!;await Promise.race([once(p,'exit'),delay(12000).then(()=>{throw Error('PROCESS_TIMEOUT');})]);assert.equal(p.exitCode,expected,output);child=undefined;};
  const stop=async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await exited();}else child=undefined;};
  const until=async(fn:()=>boolean)=>{for(let i=0;i<300;i++){if(fn())return;if(child&&child.exitCode!==null)throw Error('STARTUP_FAILED: '+output);await delay(40);}throw Error('CHECK_TIMEOUT: '+output);};
  try {
    if(initializing) {
      assert(!existsSync('.env.public'),'Нужна чистая копия без .env.public');
      launch('identity-init.js',['.env.public']);await exited();
      const before=readFileSync('.env.public','utf8'),generated=parseEnv(before),result=JSON.parse(output.trim());
      assert.equal(generated.MAX_EXPECTED_BOT_ID,botId);assert.equal(generated.ADMISSION_MODE,'PUBLIC');
      assert.equal(generated.COMPOSE_PROJECT_NAME,`cultural-plan-bot-${botId}`);
      assert.equal(generated.MAX_CONSUMER_PORT,String(30000+createHash('sha256').update(`maxbot-consumer:${botId}`).digest().readUInt32BE()%20000));
      const loaded=loadConfig(generated);assert.equal(loaded.botId,botId);assert.equal(loaded.testers.size,0);
      if(organizer){assert.equal(result.botUrl,`https://max.ru/${username}`);assert.equal(result.webhookExists,false);assert(!before.includes('426717762'));assert(!before.includes('t432_hakaton_max_bot'));}
      launch('identity-init.js',['.env.public']);await exited(1);assert.equal(readFileSync('.env.public','utf8'),before);
      assert.deepEqual(requests.map(r=>r.path),['/me','/subscriptions']);
      if(organizer){
        launch('identity-init.js',['.env.identity-mismatch'],{...baseEnv,MAX_EXPECTED_BOT_ID:'777'});await exited(1);
        assert.match(output,/"code":"AUTH"/);assert(!existsSync('.env.identity-mismatch'));
        subscribed=true;launch('identity-init.js',['.env.subscription-check']);await exited();
        assert.equal(JSON.parse(output.trim()).webhookExists,true);assert.equal(readFileSync('.env.public','utf8'),before);
        assert(requests.every(r=>r.method==='GET'&&['/me','/subscriptions'].includes(r.path)));
      }
      console.log(JSON.stringify({result:'PASS',check:'docker-identity-from-example-no-overwrite',botId,exactInt64:true,transport:'SIMULATED_MAX',realMAXRequests:0}));return;
    }
    const config=loadConfig(process.env);assert.equal(config.botId,botId);assert.equal(config.admissionMode,'PUBLIC');
    launch('polling-check.js',[],baseEnv,false);await exited();assert.match(output,/polling_configuration_ready/);
    if(process.env.NODE_EXTRA_CA_CERTS)assert.match(output,/LOADED_BY_NODE/);
    if(serving){
      const stopped=new Promise<void>(r=>{process.once('SIGTERM',()=>r());process.once('SIGINT',()=>r());});
      console.log(output.trim());
      launch('start-polling.js',[],baseEnv);await until(()=>output.includes('polling_started'));
      await until(()=>requests.some(r=>r.path==='/updates'));
      console.log(JSON.stringify({operation:'polling_started',transport:'SIMULATED_MAX',botId,admission:config.admissionMode,firstMarker:requests.find(r=>r.path==='/updates')!.marker}));
      await stopped;await stop();
      const db=new Database(config.databasePath,{readonly:true});
      try {
        assert.equal((db.prepare("SELECT value FROM meta WHERE key='identity'").get() as {value:string}).value,`live:${botId}`);
        assert.equal(db.prepare("SELECT value FROM meta WHERE key='poll_campaign'").get(),undefined);
        const cursor=JSON.parse((db.prepare("SELECT value FROM meta WHERE key='poll_marker'").get() as {value:string}).value);
        console.log(JSON.stringify({operation:'polling_stopped',transport:'SIMULATED_MAX',cursor,requests:requests.length,realMAXRequests:0}));
      }finally{db.close();}
      return;
    }
    const realCatalog=process.argv.includes('--real-catalog');
    const fixture=resolve(dirname(config.databasePath),'setup-synthetic.json');
    if(!realCatalog)writeFileSync(fixture,JSON.stringify(stage4Fixture(new Date())));
    else {const prepared=readReviewedCatalog(dirname(config.snapshotPath!));assert.equal(prepared.pointer.snapshot,'83664734f5fbb931cb19.json');assert.equal(prepared.snapshots.flatMap(s=>s.events).length,858);}
    const env=realCatalog?baseEnv:{...baseEnv,FLOW_DATA_MODE:'synthetic-test',DATA_SNAPSHOT_PATH:fixture};
    const rows=(sql:string)=>{if(!existsSync(config.databasePath))return [];const db=new Database(config.databasePath,{readonly:true});try{return db.prepare(sql).all() as any[];}finally{db.close();}};
    const drain=async()=>{await until(()=>updates.length===0&&Number(JSON.parse(rows("SELECT value FROM meta WHERE key='poll_marker'")[0]?.value??'null'))>=deliveredMarker&&rows("SELECT (SELECT count(*) FROM inbox WHERE status='PENDING')+(SELECT count(*) FROM outbox WHERE status IN ('PENDING','SENDING')) n")[0]?.n===0);};
    const text=()=>messages.get(active)!.text;
    const say=async(value:string)=>{updates.push(reply(undefined,Date.now(),value,ACTOR,`setup-input-${++seq}`));await drain();};
    const click=async(label:string)=>{
      if(!messages.has(active))throw Error('SIMULATED_SCREEN_MISSING: '+label+' / '+output.slice(-1500)+' / '+JSON.stringify(rows("SELECT status,count(*) n FROM outbox GROUP BY status")));
      const buttons:Button[]=messages.get(active)!.attachments?.flatMap(a=>a.payload.buttons.flat())??[];
      const b=buttons.find(b=>b.text===label);assert(b?.type==='callback',label+': '+text()+' / '+JSON.stringify(rows('SELECT status,result FROM inbox ORDER BY rowid DESC LIMIT 3')));
      const raw=callback('',`setup-callback-${++seq}`,ACTOR,Date.now());raw.callback.payload=b.payload;raw.message.body.mid=active;updates.push(raw);await drain();
      const latest=rows('SELECT result,payload FROM inbox ORDER BY rowid DESC LIMIT 1')[0];
      if(latest?.result==='FLOW_ACTION_EXPIRED_OR_FOREIGN')throw Error('SIMULATED_CALLBACK: '+JSON.stringify({event:JSON.parse(latest.payload),screen:rows('SELECT * FROM flow_screens'),state:rows('SELECT actor,revision,event_ts,updated_at FROM flow_states'),actions:rows('SELECT * FROM flow_actions')}));
    };
    if(realCatalog){
      launch('start-polling.js',[],env);await until(()=>output.includes('polling_started'));
      await say('/start');await click('Подобрать');await say('Екатеринбург');
      for(const label of ['Любая дата','Любое время','Продолжить','Без лимита','Любая тема','Показать результаты'])await click(label);
      await click('Подробнее 1');const state=JSON.parse(rows('SELECT data FROM flow_states')[0].data),card=state.cards.find((c:any)=>c.identity===state.selected);
      assert(card?.displayRef);assert(Catalog.load(config).permits([card.displayRef],Date.now(),true));
      await click('Сохранить');const saved=rows('SELECT * FROM bookmarks');assert.equal(saved.length,1);await stop();
      const cursor=rows("SELECT value FROM meta WHERE key='poll_marker'")[0].value,requestIndex=requests.length;
      launch('start-polling.js',[],env);await until(()=>output.includes('polling_started'));await until(()=>requests.slice(requestIndex).some(r=>r.path==='/updates'));
      assert.equal(requests.slice(requestIndex).find(r=>r.path==='/updates')!.marker,JSON.parse(cursor));
      await say('/saved');await click('Открыть 1');assert.match(text(),/Сохранено/);assert.deepEqual(rows('SELECT * FROM bookmarks'),saved);await stop();
      console.log(JSON.stringify({result:'PASS',check:'FRESH-01/PUBLIC-01/RESTART-01/BOOKMARK-01',dataset:'83664734f5fbb931cb19',events:858,eventId:card.eventId,transport:'SIMULATED_MAX',realMAXRequests:0}));return;
    }
    launch('start-polling.js',[],env);await until(()=>output.includes('polling_started'));
    await say('/start');let previous=active;await click('Подобрать');assert.equal(active,previous);
    await say('Казань');assert.notEqual(active,previous);assert.match(text(),/На какую дату/);
    await click('Другая дата');previous=active;const token=text().match(/[A-F0-9]{6}/)![0];
    await say(`${token} 2030-02-31`);assert.notEqual(active,previous);assert.match(text(),/Нужна дата/);
    previous=active;await click('Назад');assert.equal(active,previous);assert.match(text(),/На какую дату/);
    await say('/saved');assert.match(text(),/Закладок пока нет/);
    const duplicate=reply(undefined,Date.now(),'/start',ACTOR,`setup-duplicate-${++seq}`);const posts=requests.filter(r=>r.method==='POST'&&r.path==='/messages').length;
    updates.push(duplicate,duplicate);await drain();assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/messages').length,posts+1);
    await stop();
    const savedMarker=JSON.parse(rows("SELECT value FROM meta WHERE key='poll_marker'")[0].value),savedState=rows('SELECT * FROM flow_states');
    assert.equal(rows("SELECT * FROM meta WHERE key='poll_campaign'").length,0);
    const requestIndex=requests.length;launch('start-polling.js',[],env);await until(()=>output.includes('polling_started'));
    await until(()=>requests.slice(requestIndex).some(r=>r.path==='/updates'));
    assert.equal(requests.slice(requestIndex).find(r=>r.path==='/updates')!.marker,savedMarker);
    assert.deepEqual(rows('SELECT * FROM flow_states'),savedState);await stop();
    console.log(JSON.stringify({result:'PASS',check:'public-polling-entrypoint-text-callback-validation-dedup-cursor-restart',transport:'SIMULATED_MAX',requests:requests.length,realMAXRequests:0}));
  } finally {
    if(child?.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    await new Promise<void>(r=>server.close(()=>r()));
  }
}
const watchdog=setTimeout(()=>{console.error('SETUP_CHECK_WATCHDOG');process.exit(1);},150000);watchdog.unref();
main().catch(e=>{console.error(e instanceof Error?e.message:'SETUP_CHECK_FAILED');process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
