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
    transcript.push(`Пользователь: ${text}`); const previous=latest()?.id??0;const v=callback('',randomUUID(),ACTOR,clock());v.callback.payload=b.payload;
    v.message.body.mid=(db.prepare('SELECT mid FROM flow_screens WHERE actor=?').get(ACTOR) as {mid:string}).mid;await post(v);screen=await wait(previous);
  };
  try {
    if (process.argv.includes('--verify-restart')) {
      const row=db.prepare('SELECT data FROM bookmarks WHERE actor=?').get(ACTOR) as {data:string}|undefined;
      if (!row || (JSON.parse(row.data) as Card).kind !== 'STRICT') throw Error('BOOKMARK_NOT_DURABLE');
      const previous=latest()?.id??0;const v=lifecycle('bot_started',clock(),ACTOR);delete (v as {payload?:string}).payload;await post(v);screen=await wait(previous);
      await click('Мои события');await click('Открыть 1');if(!screen.body.text.includes('17:30')||!screen.body.text.includes('Регистрация: обязательна'))throw Error('CONDITIONS_LOST');await click('Удалить закладку');await click('Да, удалить');
      if(db.prepare('SELECT 1 FROM bookmarks WHERE actor=?').get(ACTOR)) throw Error('REMOVE_FAILED');
    } else {
      const previous=latest()?.id??0;const v=lifecycle('bot_started',clock(),ACTOR);delete (v as {payload?:string}).payload;await post(v);screen=await wait(previous);
      for (const label of ['Подобрать','Казань','Другая дата','Назад','Завтра','Другое время','Назад','12:00–18:00','Продолжить','Другая сумма','Назад','До 500 ₽','Театр','Показать результаты']) await click(label);
      if(!screen.body.text.includes('выставка света')||!screen.body.text.includes('театральная экспозиция')||screen.body.text.indexOf('театральная экспозиция')>screen.body.text.indexOf('выставка света')) throw Error('INTEREST_NOT_PREFERENCE');
      if(!screen.body.text.includes('Совпадает по известным условиям')||screen.body.text.includes('Варианты, где нужно уточнение')) throw Error('STRICT_GROUP');
      await click('Показать варианты для проверки');
      if(!screen.body.text.includes('Варианты, где нужно уточнение:\n3. мастерская цвета')) throw Error('CANDIDATE_GROUP');
      await click('Подробнее 3');
      if(!screen.body.text.includes('Нужно уточнить')) throw Error('UNCERTAINTY_LOST');
      if(!/📅.*12:00.*18:00/.test(screen.body.text)) throw Error('KNOWN_TIME_LOST');
      if(screen.body.attachments?.flatMap(a=>a.payload.buttons.flat()).some(b=>b.type==='link'&&new URL(b.url).hostname!=='example.org')) throw Error('SYNTHETIC_LINK');
      for(const label of ['К результатам','Дата','Другая дата','Назад','Завтра','Показать результаты']) await click(label);
      if(screen.body.text.includes('мастерская цвета')) throw Error('OPT_IN_NOT_RESET');
      await click('Подробнее 1');if(!screen.body.text.includes('17:30')||!screen.body.text.includes('200 ₽')||!screen.body.text.includes('Регистрация: обязательна'))throw Error('CONDITIONS_LOST');
      for(const label of ['Условия посещения','К карточке','Сохранить','Мои события']) await click(label);
      if (!db.prepare('SELECT 1 FROM bookmarks WHERE actor=?').get(ACTOR)) throw Error('SAVE_FAILED');
    }
    writeFileSync(`/app/runtime/${process.argv.includes('--verify-restart')?'restart':'walkthrough'}-synthetic.txt`,transcript.join('\n\n'));
    console.log(JSON.stringify({result:'PASS',mode:'SYNTHETIC',http:true,automaticWorker:true,sqlite:true,restart:process.argv.includes('--verify-restart'),realMax:false,screens:transcript.filter(v=>v.startsWith('Бот:')).length}));
  } finally {db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
