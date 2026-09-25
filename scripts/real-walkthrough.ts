import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Catalog } from '../src/culture/catalog.js';
import { select } from '../src/data/select.js';
import { cities, cityDate, cityInstant, type CityKey } from '../src/data/cities.js';
import type { Query } from '../src/data/contract.js';
import { flowDriver } from './flow-driver.js';
import { getState } from '../src/culture/flow.js';
import { ACTOR } from '../tests/fixtures.js';

export async function realWalkthrough(snapshotPath=resolve('catalog/real/active.json'),output=resolve('docs/evidence/real-catalog')) {
  const now=new Date(),catalog=Catalog.load({flowDataMode:'real',snapshotPath} as any);
  assert.equal(catalog.usableCities(now.getTime()).length,2,'Нужен текущий проверенный реальный снимок двух городов.');
  const snapshots=catalog.availableCities.map(c=>catalog.forCity(c)!);
  // Запросы объявлены заранее: ближайшая суббота, день 12–18; вечер сегодня 18–21; no-match завтра 02–03.
  const queries=[];
  for(const city of ['kzn','ekb'] as CityKey[]) {
    const zone=cities[city].timezone,today=cityDate(now.toISOString(),zone),weekday=new Date(today+'T12:00Z').getUTCDay();
    const saturday=new Date(Date.parse(today+'T12:00Z')+((6-weekday+7)%7)*86400000).toISOString().slice(0,10);
    const tomorrow=cityDate(new Date(now.getTime()+86400000).toISOString(),zone);
    const examples=[
      {name:'Один взрослый, ближайшая суббота днём, до 500 ₽',date:saturday,from:'12:00',until:'18:00',budget:500,party:{adults:1,childAges:[]}},
      {name:'Два взрослых и ребёнок 7 лет, суббота днём, до 1500 ₽ за всех',date:saturday,from:'12:00',until:'18:00',budget:1500,party:{adults:2,childAges:[7]}},
      {name:'Бесплатно, один взрослый, суббота днём',date:saturday,from:'12:00',until:'18:00',budget:0,party:{adults:1,childAges:[]}},
      {name:'Вечером сегодня 18–21, один взрослый, без лимита цены',date:today,from:'18:00',until:'21:00',budget:null,party:{adults:1,childAges:[]}},
      {name:'Намеренно без совпадений: завтра 02–03, бесплатно',date:tomorrow,from:'02:00',until:'03:00',budget:0,party:{adults:1,childAges:[]}},
    ];
    for(const x of examples) {
      const query:Query={version:2,city,timezone:zone,party:x.party,budgetBasis:'PARTY_TOTAL',start:cityInstant(x.date,x.from,zone),end:cityInstant(x.date,x.until,zone),budgetRub:x.budget,category:null,zone:null,kind:'ANY',preferences:{categories:[]}};
      const result=select(catalog.forCity(city),query,now,false,true);
      queries.push({name:x.name,query,strict:result.strictTotal,candidates:result.uncertainTotal,
        shownStrict:result.recommendations.map(r=>({title:r.title,from:r.from,until:r.until,price:r.partyPrice.total,source:r.source})),
        shownCandidates:result.uncertain.map(r=>({title:r.title,reasons:r.reasons,source:r.source})),excluded:result.excluded});
      if(x.name.startsWith('Намеренно'))assert.equal(result.strictTotal+result.uncertainTotal,0);
    }
  }
  const privateRoot=resolve('.review/real-catalog');mkdirSync(privateRoot,{recursive:true});
  const run=mkdtempSync(resolve(privateRoot,'journey-'));
  const d=await flowDriver(resolve(run,'disposable.sqlite'),{snapshots},now.getTime(),true,catalog.review);
  const frames:{title:string;text:string;links:string[]}[]=[];
  const capture=(title:string)=>frames.push({title,text:d.screen()!.body.text,links:d.buttons().flatMap(b=>b.type==='link'?[b.url]:[])});
  try {
    for(const city of ['Казань','Екатеринбург']) {
      await d.enter();for(const label of ['Подобрать',city,'Завтра','12:00–18:00','Продолжить','До 500 ₽','Любой','Показать результаты','Подробнее 1'])await d.click(label);
      assert(d.catalog.permits(d.screen()!.displayRefs,d.now));assert(!d.screen()!.body.text.includes('Демо'));capture(city+': реальная карточка');
      assert(frames.at(-1)!.links.some(u=>u.startsWith(city==='Казань'?'https://kazan-kremlin.ru/':'https://m-i-e.ru/')));
      await d.click('Условия посещения');capture(city+': условия');await d.click('К карточке');await d.click('Сохранить');
      const before=d.runtime.store.db.prepare('SELECT data FROM bookmarks ORDER BY identity').all();
      await d.restart();await d.say('/saved');await d.click('Открыть 1');capture(city+': после restart');
      assert.deepEqual(d.runtime.store.db.prepare('SELECT data FROM bookmarks ORDER BY identity').all(),before);
    }
    await d.click('Удалить закладку');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);await d.click('Отмена');
    const state=JSON.parse(getState(d.runtime.store,ACTOR)!.data);assert.equal(state.stage,'bookmark');
    mkdirSync(output,{recursive:true});
    const counts={records:snapshots.reduce((n,s)=>n+s.events.length,0),occurrences:snapshots.reduce((n,s)=>n+s.stats.occurrences,0),
      timedSessions:snapshots.flatMap(s=>s.events).flatMap(e=>e.occurrences).filter(o=>o.kind==='TIMED_SESSION').length,
      flexibleVisits:snapshots.flatMap(s=>s.events).flatMap(e=>e.occurrences).filter(o=>o.kind==='FLEXIBLE_VISIT').length,
      venueRecords:snapshots.reduce((n,s)=>n+s.venues.length,0),identifiedVenueRecords:snapshots.flatMap(s=>s.venues).filter(v=>v.title).length,
      identifiedVenues:new Set(snapshots.flatMap(s=>s.venues).filter(v=>v.title).map(v=>v.city+'|'+v.title)).size,cities:snapshots.length};
    const result={verdict:'MAXBOT_REAL_CATALOG_LOCAL_PASS',at:now.toISOString(),counts,LOCAL_INTEGRATION_SMOKE:'PASS',REAL_APPLICATION_SMOKE:'REQUIRED',REAL_MAX_MOBILE:'NOT_RUN',REAL_MAX_WEB:'NOT_RUN',simulatedMAX:true,queries,frames,operations:Object.fromEntries(['messages','edit','answers','delete'].map(m=>[m,d.operations.filter(o=>o.method===m).length]))};
    writeFileSync(resolve(output,'walkthrough.json'),JSON.stringify(result,null,2)+'\n');
    writeFileSync(resolve(output,'cards.md'),'# Реальные карточки из локального приложения\n\nHTTP → admission → worker → SQLite → renderer; MAX симулирован. Участники одноразовые.\n'+frames.map(f=>'\n## '+f.title+'\n\n```text\n'+f.text+'\n```\n\n'+f.links.map(u=>'[Источник]('+u+')').join(' · ')+'\n').join(''));
    console.log(JSON.stringify({result:'LOCAL_INTEGRATION_SMOKE_PASS',counts,queries:queries.map(q=>({name:q.name,city:q.query.city,strict:q.strict,candidates:q.candidates})),operations:result.operations}));
    return result;
  }finally{await d.close();}
}
if(process.argv[1]?.endsWith('real-walkthrough.js'))realWalkthrough(process.argv[2],process.argv[3]).catch(e=>{console.error(e.message);process.exitCode=1;});
