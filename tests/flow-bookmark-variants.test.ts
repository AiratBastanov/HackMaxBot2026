import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {flowDriver} from '../scripts/flow-driver.js';
import {bookmarkScenario,variantsFixture,search,savedRows,state} from '../scripts/bookmark-scenario.js';
import {presentationTitle} from '../src/culture/card.js';
import {validateOperation} from '../src/max.js';
import {ACTOR} from './fixtures.js';

function path(){mkdirSync('.tmp/bookmark-variants',{recursive:true});return resolve(mkdtempSync(resolve('.tmp/bookmark-variants/case-')),'test.sqlite');}
test('Независимые варианты: восемь сохранений через приложение, обе страницы, перезапуск и точное удаление',async()=>{
  const result=await bookmarkScenario(path());assert.deepEqual(result.after,{actor:7,other:1,total:8});
});
test('Заголовок с типом един на результатах, карточке, условиях, сохранении, списке и подтверждении удаления',async()=>{
  const fixture=variantsFixture(),before=JSON.stringify(fixture),d=await flowDriver(path(),fixture);
  try {
    await search(d);const c=state(d).cards[0],title=presentationTitle(c);assert(d.screen()!.body.text.includes(title));
    for(const label of ['Подробнее 1','Условия посещения','К карточке','Сохранить','Мои события','Открыть 1','Условия посещения','Удалить закладку','Отмена']){
      await d.click(label);const screen=d.screen()!.body.text;assert(screen.includes(title));assert(!screen.includes('(Выставка) (Выставка)'));
    }
    assert.equal(JSON.stringify(fixture),before);assert.equal(JSON.parse(savedRows(d)[0]!.data).title,c.title);
    for(const op of d.operations){validateOperation(op);if(op.method==='messages'||op.method==='edit')assert(op.body.text.length<=3950);}
  }finally{await d.close();}
});
test('Ошибка после INSERT откатывает закладку, save_action и переход; повтор выполняется ровно один раз',async()=>{
  const d=await flowDriver(path(),variantsFixture());
  try {
    await search(d);await d.click('Подробнее 1');const action=d.payload('Сохранить');
    const before=d.operations.length;
    d.runtime.store.db.exec("CREATE TRIGGER fail_after_save BEFORE UPDATE ON flow_states BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    await d.press(action,ACTOR,'failed-save',d.now+1,false);await d.runtime.worker.tick();
    assert.equal(savedRows(d).length,0);assert.equal(d.payload('Сохранить'),action);assert.equal(d.operations.length,before);
    assert.equal(d.runtime.store.pendingInbox(1)[0]!.attempts,1);
    d.runtime.store.db.exec('DROP TRIGGER fail_after_save');await d.drain();assert.equal(savedRows(d).length,1);
    assert.equal(savedRows(d)[0]!.save_action,action.slice(3));await d.press(action);assert.equal(savedRows(d).length,1);
    const answer=d.operations.filter(o=>o.method==='answers').at(-1);assert(answer?.method==='answers');assert.match(answer.body.notification!,/уже обработано/);
  }finally{await d.close();}
});
test('50 независимых закладок: общий лимит объяснён, совпадающее время разрешено, вытеснения нет',async()=>{
  const d=await flowDriver(path(),variantsFixture());
  try {
    await search(d);await d.click('Подробнее 1');await d.click('Сохранить');
    const row=savedRows(d)[0]!;
    // Заполняем лимит fixture-данными, затем проверяем настоящее сохранение нового варианта.
    for(let i=1;i<50;i++)d.runtime.store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(ACTOR,'fixture-'+i,'fixture-'+i,d.now,JSON.stringify({...JSON.parse(row.data),eventId:'fixture:'+i}));
    const all=savedRows(d);assert.equal(all.length,50);
    await search(d,{time:'14:00-16:00'});await d.click('Подробнее 1');await d.click('Сохранить');
    assert.match(d.screen()!.body.text,/Лимит 50 закладок/);assert.deepEqual(savedRows(d),all);
    await d.click('Отменить выбор и перейти');assert.equal(state(d).stage,'results');assert.deepEqual(savedRows(d),all);
    await d.say('/delete_data');await d.click('Да, удалить');assert.equal(savedRows(d).length,0);
    assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks WHERE save_action IS NOT NULL').get() as {n:number}).n,0);
  }finally{await d.close();}
});
