import assert from 'node:assert/strict';
import {flowDriver} from './flow-driver.js';
import {flowFixture} from '../src/culture/fixture.js';
import {getState} from '../src/culture/flow.js';
import {presentationTitle,displayInterval,type Card} from '../src/culture/card.js';
import {bookmarkContext} from '../src/culture/bookmark.js';
import {ACTOR,OTHER} from '../tests/fixtures.js';

export type Driver=Awaited<ReturnType<typeof flowDriver>>;
export type SavedRow={actor:string;identity:string;generation:string;saved_at:number;data:string;save_action:string|null};
export const savedRows=(d:Driver,actor=ACTOR)=>d.runtime.store.db.prepare('SELECT * FROM bookmarks WHERE actor=? ORDER BY saved_at DESC,identity').all(actor) as SavedRow[];
export const state=(d:Driver,actor=ACTOR)=>JSON.parse(getState(d.runtime.store,actor)!.data);
export function variantsFixture() {
  const s=flowFixture(),a=structuredClone(s.events[0]!);
  a.title='СИНТЕТИКА: Свет (экспозиция)';a.categories=['culture','exhibition'];
  a.occurrences[0]!.activeFrom='2030-04-01';a.occurrences[0]!.activeThrough='2030-06-30';
  a.occurrences[0]!.opening=Array.from({length:7},(_,weekday)=>({weekday,open:600,close:1200,lastEntry:1170}));
  a.admission.requirements={minimumAge:0,children:'ALLOWED',accompaniedByAdult:'REQUIRED'};
  a.tariffs=[{audience:'ADULT',minAge:null,maxAge:null,kind:'EXACT',amount:200,lowerBound:null,currency:'RUB',applicable:true,evidence:'Вымышленный взрослый тариф',conditions:[]},
    {audience:'CHILD',minAge:0,maxAge:17,kind:'FREE',amount:0,lowerBound:null,currency:'RUB',applicable:true,evidence:'Вымышленный детский тариф',conditions:[]}];
  const session=(id:string,category:string)=>{
    const e=structuredClone(a);e.id=id;e.title='СИНТЕТИКА: Вечер света';e.categories=[category,'culture'];e.sourceUrl='https://example.org/'+category;
    const o=e.occurrences[0]!;o.id=id+':session-1';o.kind='TIMED_SESSION';o.start='2030-04-06T09:00:00Z';o.end='2030-04-06T11:00:00Z';
    o.endBasis='PUBLISHED';o.activeFrom=null;o.activeThrough=null;o.opening=null;o.scheduleBasis='UNKNOWN';return e;
  };
  const b=session('synthetic:variant:concert','concert'),c=session('synthetic:variant:theater','theater');
  b.occurrences.push({...structuredClone(b.occurrences[0]!),id:b.id+':session-2',start:'2030-04-06T12:00:00Z',end:'2030-04-06T14:00:00Z'});
  s.events=[a,b,c];s.stats.normalizedEvents=3;s.stats.occurrences=4;return s;
}
// Все выборы и действия проходят через HTTP, worker и обычные кнопки приложения.
export async function search(d:Driver,options:{category?:string;date?:string;time?:string;adults?:number;childAge?:number;actor?:string}={}) {
  const actor=options.actor??ACTOR,click=(s:string)=>d.click(s,actor);
  await d.enter(actor);await click('Подобрать');await click('Казань');
  if(options.date){await click('Другая дата');await d.say(state(d,actor).input.token+' '+options.date,actor);}
  else await click(d.dateLabel('Завтра',actor));
  if(options.time){await click('Другое время');await d.say(state(d,actor).input.token+' '+options.time,actor);}
  else await click('12:00–18:00');
  for(let i=1;i<(options.adults??1);i++)await click('Взрослые +');
  if(options.childAge!==undefined)await click('Дети +');
  await click('Продолжить');
  if(options.childAge!==undefined){await click('Указать возраст');await d.say(state(d,actor).input.token+' '+options.childAge,actor);}
  await click('Без лимита');await click(options.category??'Выставки');await click('Показать результаты');
}
export async function openRow(d:Driver,row:SavedRow) {
  await d.say('/saved',row.actor);
  for(let page=0;page<10;page++) {
    for(const button of d.buttons(row.actor))if(button.type==='callback'&&button.text.startsWith('Открыть ')) {
      const action=d.runtime.store.db.prepare('SELECT data FROM flow_actions WHERE id=?').get(button.payload.slice(3)) as {data:string};
      const ref=JSON.parse(JSON.parse(action.data));
      if(ref.identity===row.identity&&ref.generation===row.generation){await d.click(button.text,row.actor);return;}
    }
    if(!d.buttons(row.actor).some(b=>b.text==='Следующие'))break;
    await d.click('Следующие',row.actor);
    const numbers=d.buttons(row.actor).filter(b=>b.text.startsWith('Открыть ')).map(b=>Number(b.text.split(' ')[1]));
    for(const number of numbers)assert(d.screen(row.actor)!.body.text.includes('\n'+number+'. '));
  }
  throw Error('BOOKMARK_NOT_LISTED');
}
export async function bookmarkScenario(path:string) {
  const d=await flowDriver(path,variantsFixture());
  try {
    await search(d);assert.equal(state(d).cards[0].eventId,'synthetic:flow:1');
    await d.click('Подробнее 1');const save=d.payload('Сохранить');
    await d.press(save,ACTOR,'save-one',d.now+1,false);await d.press(save,ACTOR,'save-double',d.now+2,false);await d.drain();
    assert.equal(savedRows(d).length,1);assert.equal((await d.press(save,ACTOR,'save-one')).status,'duplicate');
    await d.press(save);assert.equal(savedRows(d).length,1);
    const original=savedRows(d)[0]!;
    for(const category of ['Концерты','Театр']){
      await search(d,{category});assert.equal(state(d).cards[0].categories[0],category==='Концерты'?'concert':'theater');
      await d.click('Подробнее 1');await d.click('Сохранить');assert.match(d.screen()!.body.text,/На это время у вас уже есть другое событие/);
    }
    await search(d,{date:'2030-04-07'});await d.click('Подробнее 1');await d.click('Сохранить');
    await search(d,{time:'14:00-16:00'});await d.click('Подробнее 1');await d.click('Сохранить');
    await search(d,{adults:2,childAge:7});await d.click('Подробнее 1');await d.click('Сохранить');
    await d.click('✅ Сохранено');assert.equal(savedRows(d).length,6);
    await search(d,{time:'13:00-17:00'});await d.click('Подробнее 1');await d.click('Сохранить');assert.equal(savedRows(d).length,7);
    await search(d,{category:'Концерты',time:'15:00-18:00'});await d.click('Подробнее 1');await d.click('Сохранить');
    assert.equal(JSON.parse(savedRows(d)[0]!.data).occurrenceId,'synthetic:variant:concert:session-2');
    await search(d,{actor:OTHER});await d.click('Подробнее 1',OTHER);await d.click('Сохранить',OTHER);
    const all=savedRows(d),other=savedRows(d,OTHER);assert.equal(all.length,8);assert.equal(other.length,1);
    assert.deepEqual(all.find(r=>r.identity===original.identity),original);
    await d.restart();assert.deepEqual(savedRows(d),all);
    for(const row of all){
      await openRow(d,row);const c=JSON.parse(row.data) as Card;
      assert.deepEqual(state(d).bookmark,{identity:row.identity,generation:row.generation});
      assert(d.screen()!.body.text.includes(presentationTitle(c)));
      assert(d.screen()!.body.text.includes('Выбрано: '+displayInterval(c.visit!.from!,c.visit!.until!,c.query.timezone!)));
      assert(d.screen()!.body.text.includes(`${c.query.party!.adults} взр., ${c.query.party!.childAges.length} дет.`));
      assert.deepEqual(savedRows(d),all);
    }
    const screensBefore=d.operations.filter(o=>o.method==='messages').length;
    await d.say('/saved');await d.say('/saved');assert(d.operations.filter(o=>o.method==='messages').length>screensBefore);
    assert(d.operations.some(o=>o.method==='delete'));assert.deepEqual(savedRows(d),all);
    await openRow(d,original);await d.click('Удалить закладку');
    assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);assert(d.screen()!.body.text.includes(bookmarkContext(JSON.parse(original.data))));
    await d.click('Отмена');assert.equal(state(d).bookmark.identity,original.identity);assert.deepEqual(savedRows(d),all);
    await d.click('Удалить закладку');const oldDelete=d.payload('Да, удалить');await d.click('Да, удалить');
    const retained=all.filter(r=>r.identity!==original.identity);assert.deepEqual(savedRows(d),retained);assert.deepEqual(savedRows(d,OTHER),other);
    await d.press(oldDelete);await d.press(save);assert.deepEqual(savedRows(d),retained);
    await d.restart();assert.deepEqual(savedRows(d),retained);
    return {transport:'SIMULATED_MAX',schema:d.runtime.store.db.pragma('user_version',{simple:true}),before:{actor:8,other:1,total:9},after:{actor:7,other:1,total:8},
      deleted:original.identity,rows:all.map((b,i)=>({alias:'A'+(i+1),identity:b.identity,generation:b.generation,title:presentationTitle(JSON.parse(b.data)),context:bookmarkContext(JSON.parse(b.data)),retained:b.identity!==original.identity})),
      checks:['ordinary_save_open_cancel_delete','same_first_result','same_title_same_time','two_dates','time_and_party_variants','already_saved_opens_existing','same_action_twice','pagination_numbers','restart','cleanup_preserves_rows','other_actor_unchanged']};
  }finally{await d.close();}
}
