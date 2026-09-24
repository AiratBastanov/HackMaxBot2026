import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { ACTOR, SECRET, encode, lifecycle, callback } from '../tests/fixtures.js';
import type { MaxOperation } from '../src/max.js';
import type { Card } from '../src/culture/flow.js';
import { writeFileSync } from 'node:fs';

async function main() {
  if (process.env.APP_MODE !== 'local' || process.env.FLOW_DATA_MODE !== 'synthetic-test') throw Error('Только local synthetic-test');
  const db = new Database(process.env.DATABASE_PATH!,{readonly:true});
  const transcript: string[]=[];
  const clock = () => Math.max(Date.parse(process.env.FLOW_TEST_CLOCK!)+1000,
    ((db.prepare('SELECT event_ts FROM flow_states WHERE actor=?').get(ACTOR) as {event_ts:number}|undefined)?.event_ts ?? 0)+1);
  const post = async (v: unknown) => { const r=await fetch('http://127.0.0.1:3000/webhooks/max',{method:'POST',headers:{'content-type':'application/json','x-max-bot-api-secret':SECRET},body:encode(v),signal:AbortSignal.timeout(5000)}); if(!r.ok) throw Error(`HTTP_${r.status}`); };
  const latest = () => db.prepare("SELECT id,payload FROM outbox WHERE actor=? AND purpose='culture_screen' AND status='SIMULATED' ORDER BY id DESC LIMIT 1").get(ACTOR) as {id:number;payload:string}|undefined;
  const wait = async (previous: number) => { const end=Date.now()+10000; while(Date.now()<end) { const row=latest(); if(row && row.id>previous) {const op=JSON.parse(row.payload) as Extract<MaxOperation,{method:'messages'}>;transcript.push(`Бот: ${op.body.text}`);return op;} await new Promise(r=>setTimeout(r,150)); } throw Error('SCREEN_TIMEOUT'); };
  let screen: Extract<MaxOperation,{method:'messages'}>;
  const click = async (text: string) => {
    const b=screen.body.attachments?.flatMap(a=>a.payload.buttons.flat()).find(b=>b.text===text); if(!b||b.type!=='callback')throw Error(`BUTTON_${text}`);
    transcript.push(`Пользователь: ${text}`); const previous=latest()?.id??0;const v=callback('',randomUUID(),ACTOR,clock());v.callback.payload=b.payload;await post(v);screen=await wait(previous);
  };
  try {
    if (process.argv.includes('--verify-restart')) {
      const row=db.prepare('SELECT data FROM bookmarks WHERE actor=?').get(ACTOR) as {data:string}|undefined;
      if (!row || (JSON.parse(row.data) as Card).kind !== 'UNCERTAIN') throw Error('BOOKMARK_NOT_DURABLE');
      const previous=latest()?.id??0;const v=lifecycle('bot_started',clock(),ACTOR);delete (v as {payload?:string}).payload;await post(v);screen=await wait(previous);
      await click('Мои события');await click('Открыть 1');if(!screen.body.text.includes('Нужно уточнить'))throw Error('UNCERTAINTY_LOST');await click('Удалить закладку');await click('Да, удалить');
    } else {
      const previous=latest()?.id??0;const v=lifecycle('bot_started',clock(),ACTOR);delete (v as {payload?:string}).payload;await post(v);screen=await wait(previous);
      for (const label of ['Подобрать','Завтра','12:00–18:00','До 500 ₽','Любой','Показать результаты','Показать варианты для проверки','Подробнее 2','Сохранить','Мои события']) await click(label);
      if (!db.prepare('SELECT 1 FROM bookmarks WHERE actor=?').get(ACTOR)) throw Error('SAVE_FAILED');
    }
    writeFileSync(`/app/runtime/${process.argv.includes('--verify-restart')?'restart':'walkthrough'}-synthetic.txt`,transcript.join('\n\n'));
    console.log(JSON.stringify({result:'PASS',mode:'SYNTHETIC',http:true,automaticWorker:true,sqlite:true,restart:process.argv.includes('--verify-restart'),realMax:false,screens:transcript.filter(v=>v.startsWith('Бот:')).length}));
  } finally {db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
