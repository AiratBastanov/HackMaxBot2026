import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {loadConfig} from '../src/config.js';
import {lifecycle,callback,encode} from '../tests/fixtures.js';
import type {Button,MaxOperation} from '../src/max.js';

// Только loopback, local и синтетика. Никогда не вызывает MAX API.
const c=loadConfig(process.env);
assert(c.mode==='local'&&c.flowDataMode==='synthetic-test'&&c.admissionMode==='PUBLIC');
const marker=c.databasePath+'.selfcheck.json',restart=process.argv.includes('--restart');
const actor=restart?JSON.parse(readFileSync(marker,'utf8')).actor as string:String(9007199254741901n+BigInt(Date.now()));
const origin=`http://127.0.0.1:${c.port}`,db=new Database(c.databasePath,{readonly:true});
const wait=async<T>(fn:()=>T|undefined)=>{const until=Date.now()+20000;while(Date.now()<until){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('DEMO_TIMEOUT');};
type Row={id:number;payload:string};
const screen=()=>db.prepare("SELECT id,payload FROM outbox WHERE actor=? AND status='SIMULATED' AND purpose='culture_screen' ORDER BY id DESC LIMIT 1").get(actor) as Row|undefined;
const post=async(v:unknown,secret=c.webhookSecret!)=>fetch(origin+'/webhooks/max',{method:'POST',headers:{'content-type':'application/json','x-max-bot-api-secret':secret},body:encode(v),signal:AbortSignal.timeout(5000)});
const now=()=>((db.prepare('SELECT updated_at FROM flow_states WHERE actor=?').get(actor) as {updated_at:number}|undefined)?.updated_at??Date.parse(c.flowTestClock!))+1;
let current:Row|undefined;
const click=async(label:string)=>{
 const op=JSON.parse(current!.payload) as Extract<MaxOperation,{method:'messages'|'edit'}>;
 const buttons=op.body.attachments?.flatMap(a=>a.payload.buttons.flat())??[];
 const b=buttons.find(b=>b.text===label||label==='Завтра'&&b.text.startsWith('Завтра · '));assert(b?.type==='callback',`Нет кнопки: ${label}`);
 const v=callback('',randomUUID(),actor,now());v.callback.payload=b.payload;
 v.message.body.mid=(db.prepare('SELECT mid FROM flow_screens WHERE actor=?').get(actor) as {mid:string}).mid;
 const previous=current!.id;assert.equal((await post(v)).status,200);
 current=await wait(()=>{const r=screen();return r&&r.id>previous?r:undefined;});
};
try {
 assert.equal((await fetch(origin+'/healthz')).status,200);
 if(restart) {
  assert.equal((db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(actor) as {n:number}).n,1);
  console.log(JSON.stringify({result:'PASS',check:'restart-bookmark-persistence',transport:'SIMULATED_MAX'}));
 }else {
  const v=lifecycle('bot_started',now(),actor);delete (v as any).payload;
  assert.equal((await post(v,'invalid')).status,401);
  const previous=screen()?.id??0;assert.equal((await post(v)).status,200);
  assert.equal((await (await post(v)).json() as {status:string}).status,'duplicate');
  current=await wait(()=>{const r=screen();return r&&r.id>previous?r:undefined;});
  for(const label of ['Подобрать','Казань','Завтра','12:00–18:00','Продолжить','До 500 ₽','Любая тема','Показать результаты','Подробнее 1','Сохранить','Мои события','Открыть 1'])await click(label);
  assert.equal((db.prepare('SELECT count(*) n FROM bookmarks WHERE actor=?').get(actor) as {n:number}).n,1);
  assert.equal((db.prepare('SELECT count(*) n FROM probes').get() as {n:number}).n,0);
  writeFileSync(marker,JSON.stringify({actor,synthetic:true})+'\n');
  console.log(JSON.stringify({result:'PASS',check:'public-start-selection-save-reopen-secret-dedup',transport:'SIMULATED_MAX',actor:'SYNTHETIC'}));
 }
}finally{db.close();}
