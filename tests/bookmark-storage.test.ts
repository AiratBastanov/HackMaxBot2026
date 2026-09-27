import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {Storage} from '../src/storage.js';
import {flowDriver} from '../scripts/flow-driver.js';
import {variantsFixture,search,savedRows,state,openRow} from '../scripts/bookmark-scenario.js';
import {ACTOR,OTHER} from './fixtures.js';

function path(){mkdirSync('.tmp/bookmark-migration',{recursive:true});return resolve(mkdtempSync(resolve('.tmp/bookmark-migration/case-')),'legacy.sqlite');}
const toV3=(db:Database.Database)=>db.exec('DROP INDEX bookmarks_save_action; DROP INDEX bookmarks_order; ALTER TABLE bookmarks DROP COLUMN save_action; PRAGMA user_version=3');

test('v3 → v4: старые записи 1:1, исходные JSON/ID/время/владение и открытие/удаление legacy-кнопкой сохранены',async()=>{
  const p=path(),d=await flowDriver(p,variantsFixture());
  try {
    for(const actor of [ACTOR,OTHER]){await search(d,{actor});await d.click('Подробнее 1',actor);await d.click('Сохранить',actor);}
    // Реалистичные v3 записи, полученные обычным путём приложения: event key, без categories.
    for(const actor of [ACTOR,OTHER]){
      const b=savedRows(d,actor)[0]!,c=JSON.parse(b.data);delete c.categories;
      d.runtime.store.db.prepare('UPDATE bookmarks SET identity=?,data=? WHERE actor=?').run(c.identity,JSON.stringify(c),actor);
    }
    await d.say('/saved');const open=d.payload('Открыть 1');await d.click('Открыть 1');await d.click('Удалить закладку');
    const remove=d.payload('Да, удалить'),before=savedRows(d),other=savedRows(d,OTHER),generation=before[0]!.generation;
    const oldState=state(d);assert.equal(oldState.bookmark.identity,before[0]!.identity);
    await d.say('/saved',OTHER);const openOther=d.payload('Открыть 1',OTHER);
    await d.close();const legacy=new Database(p);toV3(legacy);
    // Старая кнопка save могла иметь надпись «✅ Сохранено»: смена смысла требует нового экрана.
    legacy.prepare('INSERT INTO flow_actions VALUES(?,?,?,?,?,?)').run('legacy-save',ACTOR,1,'save','""',d.now+600000);
    const snapshot=legacy.prepare('SELECT * FROM bookmarks ORDER BY actor').all();legacy.close();
    await d.restart();assert.equal(d.runtime.store.db.pragma('user_version',{simple:true}),4);
    assert.deepEqual(d.runtime.store.db.prepare('SELECT actor,identity,generation,saved_at,data FROM bookmarks ORDER BY actor').all(),snapshot);
    assert.equal(d.runtime.store.db.prepare('SELECT 1 FROM flow_actions WHERE id=?').get('legacy-save'),undefined);
    assert.equal(savedRows(d)[0]!.save_action,null);assert.equal(savedRows(d)[0]!.generation,generation);
    await d.press(openOther,OTHER);assert.match(d.screen(OTHER)!.body.text,/Тип не указан/);
    await d.restart();assert.equal(savedRows(d).length,1);await d.press(remove);assert.equal(savedRows(d).length,0);
    assert.deepEqual(savedRows(d,OTHER).map(({save_action,...b})=>b),other.map(({save_action,...b})=>b));
    await search(d);await d.click('Подробнее 1');await d.click('Сохранить');const copy=savedRows(d)[0]!;
    assert.notEqual(copy.identity,before[0]!.identity);assert.notEqual(copy.generation,generation);
    await d.press(remove);await d.press(open);await d.press('cp:legacy-save');assert.deepEqual(savedRows(d),[copy]);
    await openRow(d,savedRows(d,OTHER)[0]!);assert.match(d.screen(OTHER)!.body.text,/Тип не указан/);
    assert.equal(savedRows(d,OTHER)[0]!.data,other[0]!.data);
  }finally{await d.close();}
});
test('Миграция откатывается целиком при неверной identity; повторный startup безопасен',()=>{
  const p=path(),config={mode:'local' as const,botId:'777'};
  let store=new Storage(p,config);store.close();
  let db=new Database(p);toV3(db);
  const data=JSON.stringify({title:'Историческое название (без изменения)',query:{city:'kzn'},facts:['Исходные сведения']});
  db.prepare('INSERT INTO bookmarks VALUES(?,?,?,?,?)').run(ACTOR,'legacy-event','original-generation',123456789,data);db.close();
  assert.throws(()=>new Storage(p,{...config,botId:'778'}),/другому режиму/);
  db=new Database(p);assert.equal(db.pragma('user_version',{simple:true}),3);
  assert.equal((db.prepare('PRAGMA table_info(bookmarks)').all() as {name:string}[]).some(c=>c.name==='save_action'),false);db.close();
  store=new Storage(p,config);const first=store.db.prepare('SELECT * FROM bookmarks').all();store.close();
  store=new Storage(p,config);assert.deepEqual(store.db.prepare('SELECT * FROM bookmarks').all(),first);assert.equal(store.db.pragma('integrity_check',{simple:true}),'ok');store.close();
});
