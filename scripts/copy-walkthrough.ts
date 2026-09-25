import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Catalog, digest } from '../src/culture/catalog.js';
import { getState } from '../src/culture/flow.js';
import { flowDriver } from './flow-driver.js';
import { ACTOR } from '../tests/fixtures.js';

// Только офлайн: архивные реальные факты, фиксированные часы, вымышленные actor и SQLite.
// Тексты берутся после HTTP → worker → SQLite → настоящий renderer → simulated MAX.
const clock = Date.parse('2026-09-25T12:00:00Z');
const snapshotPath = resolve('catalog/real/536829346bd0a60d3b35.json');
type Frame = { id:string; clock:string; text:string; buttons:string[][]; links:{label:string;url:string}[];
  characters:number; lines:number; nonemptyLines:number; draft:unknown; dates:{label:string;date:string}[] };
export async function copyWalkthrough(phase:string, output=resolve('docs/evidence/concise-copy')) {
  assert(['before','after'].includes(phase));
  assert(phase!=='before'||!existsSync(resolve(output,'before.json')),'Исходный transcript уже существует; для воспроизведения baseline используйте отдельный output.');
  const catalog=Catalog.load({flowDataMode:'real',snapshotPath,reviewPath:snapshotPath.replace('.json','.review.json')} as any);
  const facts={snapshots:catalog.availableCities.map(city=>catalog.forCity(city))};
  mkdirSync('.tmp/concise-copy',{recursive:true});
  const dir=mkdtempSync(resolve('.tmp/concise-copy/render-'));
  const d=await flowDriver(resolve(dir,'disposable.sqlite'),facts,clock,true,catalog.review);
  const frames:Frame[]=[];
  const state=()=>JSON.parse(getState(d.runtime.store,ACTOR)!.data);
  const action=async(purpose:string,data?:string)=>{
    const b=d.buttons().find(b=>{
      if(b.type!=='callback')return false;
      const row=d.runtime.store.db.prepare('SELECT purpose,data FROM flow_actions WHERE id=?').get(b.payload.slice(3)) as {purpose:string;data:string}|undefined;
      return row?.purpose===purpose&&(data===undefined||JSON.parse(row.data)===data);
    });
    assert(b?.type==='callback',`Нет действия ${purpose} ${data??''}`);
    await d.press(b.payload);
  };
  const capture=(id:string)=>{
    const op=d.screen()!,text=op.body.text;
    frames.push({id,clock:new Date(d.now).toISOString(),text,
      buttons:op.body.attachments!.flatMap(a=>a.payload.buttons.map(row=>row.map(b=>b.text))),
      links:d.buttons().flatMap(b=>b.type==='link'?[{label:b.text,url:b.url}]:[]),
      characters:[...text].length,lines:text.split('\n').length,nonemptyLines:text.split('\n').filter(s=>s.trim()).length,
      draft:state().draft,dates:d.buttons().flatMap(b=>{
        if(b.type!=='callback')return [];
        const a=d.runtime.store.db.prepare('SELECT purpose,data FROM flow_actions WHERE id=?').get(b.payload.slice(3)) as {purpose:string;data:string};
        return a.purpose==='date'?[{label:b.text,date:JSON.parse(a.data)}]:[];
      })});
  };
  try {
    await d.enter();capture('home');await action('about');capture('about');await action('home');await action('pick');capture('city');
    for(const city of ['kzn','ekb']) {
      if(city==='ekb'){await action('home');await action('pick');}
      await action('city',city);capture(city+'-date');
      await action('date','2026-09-25');capture(city+'-today-time');
      await action('home');await action('pick');await action('city',city);await action('date','2026-09-26');capture(city+'-tomorrow-time');
      await action('custom','time');capture(city+'-custom-time');await action('inputBack');capture(city+'-back-time');
    }
    await action('home');await action('pick');await action('city','kzn');await action('date','2026-09-26');await action('time','12:00-18:00');capture('party');
    await action('partyDone');capture('budget');await action('custom','budget');capture('custom-budget');
    await d.say(state().input.token+' -5');capture('invalid-budget');await action('inputBack');await action('budget','500');capture('interest');
    await action('interest','exhibition');capture('summary');await action('edit','interest');await action('interest','');capture('summary-any-topic');
    await action('results');capture('results');await action('detail');capture('adult-card');
    await action('conditions');capture('adult-conditions');await action('conditionOverview');await action('save');capture('save-confirmed');
    await action('saved');capture('saved-list');await action('bookmark');capture('saved-open');
    await action('conditions');capture('saved-conditions');await action('remove');capture('delete-confirm');await action('cancel');capture('delete-cancel');
    await d.say('/delete_data');capture('erase-confirm');await action('cancel');capture('erase-cancel');
    await action('home');await action('pick');await action('city','kzn');await action('date','2026-09-26');await action('time','12:00-18:00');
    await action('partyAdjust','children:1');capture('party-family');await action('partyDone');capture('ages');
    await action('custom','ages');capture('custom-ages');await action('inputBack');await action('agesUnknown');await action('budget','1000');await action('interest','');capture('family-summary');
    await action('results');capture('family-no-strict');await action('uncertain');capture('family-results');
    const family=state().cards.find((c:any)=>c.kind==='UNCERTAIN'&&c.visit.partyPrice.total===null);
    assert(family,'Нужен кандидат с неизвестной полной ценой');
    await action('detail',family.identity);capture('family-card');await action('conditions');capture('family-conditions');
    await action('results');await action('edit','date');await action('custom','date');capture('custom-date');await action('inputBack');capture('back-date');
    await action('date','2026-09-26');capture('edited-date-summary');
    d.advance(4*86400000);await d.say('/saved');capture('unavailable-list');await action('bookmark');capture('unavailable-source');
    await action('remove');capture('unavailable-delete');await action('cancel');capture('unavailable-cancel');
    await d.say('/delete_data');await action('confirmErase');capture('erased');
    mkdirSync(output,{recursive:true});
    const result={mode:'OFFLINE_ARCHIVED_REAL_FIXTURE',baseline:'de7ce2d2a7c83428f2d6bd79f61e8f74f921c4c6',phase,
      clock:new Date(clock).toISOString(),inputHash:digest({facts,review:catalog.review,clock}),
      LOCAL_INTEGRATION_SMOKE:'PASS',REAL_APPLICATION_SMOKE:'REQUIRED',frames};
    writeFileSync(resolve(output,phase+'.json'),JSON.stringify(result,null,2)+'\n');
    if(phase==='after') {
      const before=JSON.parse(readFileSync(resolve(output,'before.json'),'utf8')) as typeof result;
      assert.equal(before.inputHash,result.inputHash);assert.equal(before.frames.length,frames.length);
      const pairs=frames.map((after,i)=>{
        const old=before.frames[i]!;assert.equal(old.id,after.id);assert.equal(old.clock,after.clock);assert.deepEqual(old.draft,after.draft);
        const block=(f:Frame)=>'```text\n'+f.text+'\n```\n\nКнопки: '+f.buttons.map(r=>r.join(' / ')).join(' · ')+'\n';
        return `## ${after.id}\n\nСимволы: ${old.characters} → ${after.characters}; строки: ${old.lines} → ${after.lines} (непустые ${old.nonemptyLines} → ${after.nonemptyLines}).\n\nДо:\n\n${block(old)}\nПосле:\n\n${block(after)}`;
      });
      writeFileSync(resolve(output,'screens.md'),'# Полные сообщения до и после\n\nOFFLINE_ARCHIVED_REAL_FIXTURE. Архивные реальные факты и часы 25.09.2026; это не live MAX. Текст и клавиатуры получены приложением, вручную не редактировались. Символы — Unicode code points, строки — явные переводы строк; переносы на телефоне зависят от клиента. В подсчёт входят заголовки, уведомления и контекст; подписи кнопок указаны отдельно. Случайные коды форм — одноразовые локальные значения.\n\n'+pairs.join('\n'));
    }
    console.log(JSON.stringify({phase,frames:frames.length,inputHash:result.inputHash,output}));
  }finally{await d.close();}
}
if(process.argv[1]?.endsWith('copy-walkthrough.js'))copyWalkthrough(process.argv[2]??'after',process.argv[3]).catch(e=>{console.error(e);process.exitCode=1;});
