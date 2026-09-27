import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { backupDatabase, restoreDatabase, discardRestoredPersonalization } from '../src/recovery.js';
import { Storage } from '../src/storage.js';
import { flowDriver, chooseDefaults } from '../scripts/flow-driver.js';
import { ACTOR, lifecycle } from './fixtures.js';

const identity={mode:'local' as const,botId:'777'};
function dir(t:TestContext,close:()=>unknown=()=>{}) {
  const root=resolve('.tmp/stage4-recovery');mkdirSync(root,{recursive:true});const d=mkdtempSync(resolve(root,'case-'));
  t.after(async()=>{await close();assert(d.startsWith(root+sep));rmSync(d,{recursive:true});});return d;
}
test('Consistent backup с активным WAL: schema/identity/time/integrity, новый путь и карантин',async t=>{
  let store:Storage;
  const root=dir(t,()=>store?.close()),source=resolve(root,'source.sqlite'),backup=resolve(root,'backup.sqlite'),restored=resolve(root,'restored.sqlite');
  store=new Storage(source,identity);store.setMeta('sentinel','committed');
  const receipt=await backupDatabase(source,backup,identity);assert.equal(receipt.integrity,'ok');assert.equal(receipt.schema,4);assert.equal(receipt.identity,'local:777');assert(Number.isFinite(Date.parse(receipt.createdAt)));
  assert.equal(store.getMeta('recovery_state'),undefined);assert.equal(store.getMeta('sentinel'),'committed');
  await assert.rejects(backupDatabase(source,backup,identity),/DESTINATION_EXISTS/);
  assert.throws(()=>new Storage(backup,identity),/QUARANTINED/);
  await restoreDatabase(backup,restored,identity);assert.throws(()=>new Storage(restored,identity),/QUARANTINED/);
  const copy=new Database(restored,{readonly:true});assert.equal((copy.prepare("SELECT value FROM meta WHERE key='sentinel'").get() as any).value,'committed');copy.close();
  await assert.rejects(restoreDatabase(backup,restored,identity),/DESTINATION_EXISTS/);
  assert.throws(()=>discardRestoredPersonalization(source,identity,'DISCARD_RESTORED_PERSONALIZATION'),/NOT_QUARANTINED/);
});
test('Повреждение, другой бот/режим и неподдерживаемая schema отвергаются до публикации restore',async t=>{
  const root=dir(t),source=resolve(root,'source.sqlite'),backup=resolve(root,'backup.sqlite'),target=resolve(root,'restored.sqlite');
  const store=new Storage(source,identity);store.close();await backupDatabase(source,backup,identity);
  for(const wrong of [{mode:'live' as const,botId:'777'},{mode:'local' as const,botId:'778'}]) await assert.rejects(restoreDatabase(backup,target,wrong),/WRONG_IDENTITY/);
  let db=new Database(backup);db.pragma('user_version=999');db.close();await assert.rejects(restoreDatabase(backup,target,identity),/UNSUPPORTED_SCHEMA/);
  writeFileSync(backup,'CORRUPTED SYNTHETIC BACKUP');await assert.rejects(restoreDatabase(backup,target,identity));
});
test('Backup → удаление закладки/данных → loss: старое состояние недоступно, очередь подавлена, discard явный',async t=>{
  for(const erase of [false,true]) {
    let d:Awaited<ReturnType<typeof flowDriver>>,restored:Awaited<ReturnType<typeof flowDriver>>;
    const root=dir(t,async()=>{await restored?.close();await d?.close();}),source=resolve(root,'source.sqlite'),backup=resolve(root,'backup.sqlite'),target=resolve(root,'restored.sqlite');
    d=await flowDriver(source);await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');await d.click('Сохранить');
    const oldSave=d.payload('✅ Сохранено');
    d.runtime.store.enqueue('interrupted',ACTOR,null,'culture_screen',{method:'messages',recipient:ACTOR,body:{text:'старый личный экран'}},d.now,d.now+60000);
    d.runtime.store.db.prepare("UPDATE outbox SET status='SENDING' WHERE action_key='interrupted'").run();
    await backupDatabase(source,backup,identity);
    if(erase) {await d.say('/delete_data');await d.click('Да, удалить');}
    else {await d.click('Мои события');await d.click('Открыть 1');await d.click('Удалить закладку');await d.click('Да, удалить');}
    assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as any).n,0);
    await restoreDatabase(backup,target,identity);assert.throws(()=>new Storage(target,identity),/QUARANTINED/);
    const quarantined=new Database(target,{readonly:true});
    assert.equal((quarantined.prepare('SELECT count(*) n FROM bookmarks').get() as any).n,1);
    assert.equal((quarantined.prepare("SELECT count(*) n FROM outbox WHERE payload IS NOT NULL OR finished_at IS NULL OR status<>'RECOVERY_SUPPRESSED'").get() as any).n,0);
    for(const table of ['flow_actions','flow_screens','ui_messages']) assert.equal((quarantined.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n,0);quarantined.close();
    assert.throws(()=>discardRestoredPersonalization(target,identity,''),/CONFIRMATION/);
    discardRestoredPersonalization(target,identity,'DISCARD_RESTORED_PERSONALIZATION');
    restored=await flowDriver(target);await restored.enter();await restored.say('/saved');
    assert.match(restored.screen()!.body.text,/Закладок пока нет/);await restored.press(oldSave);assert.equal((restored.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as any).n,0);
    assert.equal(restored.operations.some(o=>o.method==='messages'&&o.body.text.includes('старый личный экран')),false);
    const before=restored.operations.length;
    await restored.post(lifecycle('bot_started',Number(restored.runtime.store.getMeta('recovery_cutoff'))-1));await restored.drain();
    assert.equal(restored.operations.length,before);assert(restored.runtime.store.db.prepare("SELECT 1 FROM inbox WHERE result='PRE_RECOVERY_EVENT' AND payload IS NULL").get());
  }
});
test('Обычный restart целого тома сохраняет данные; прерванный send не повторяется',t=>{
  const path=resolve(dir(t),'source.sqlite');let store=new Storage(path,identity);
  store.setMeta('sentinel','keep');store.db.prepare('INSERT INTO bookmarks(actor,identity,generation,saved_at,data) VALUES(?,?,?,?,?)').run(ACTOR,'synthetic:event','g',Date.now(),'{}');
  store.enqueue('send',ACTOR,null,'culture_answer',{method:'answers',callbackId:'synthetic',body:{notification:'Принято.'}},Date.now(),Date.now()+60000);
  store.db.prepare("UPDATE outbox SET status='SENDING'").run();store.close();store=new Storage(path,identity);
  assert.equal(store.getMeta('sentinel'),'keep');assert.equal((store.db.prepare('SELECT count(*) n FROM bookmarks').get() as any).n,1);
  const row=store.db.prepare('SELECT status,finished_at FROM outbox').get() as any;assert.equal(row.status,'UNKNOWN_RESULT');assert(row.finished_at);assert.equal(store.pendingOutbox(Date.now()),undefined);store.close();
});
