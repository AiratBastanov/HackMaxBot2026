import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {Catalog} from '../src/culture/catalog.js';
import {flowDriver,chooseDefaults} from './flow-driver.js';
import {deliveryAllowed} from '../src/max.js';
import {snapshotDigest} from '../src/data/source-policy.js';

// Реальные факты двух версий; все actor/DB/сообщения MAX — только локальная симуляция.
export async function refreshWalkthrough(output=resolve('docs/evidence/real-refresh')) {
  const oldPath=resolve('catalog/real/6b96474106ae4a2018b5.json'),oldReview=oldPath.replace('.json','.review.json');
  const activePath=resolve('catalog/real/active.json'),now=Date.now();
  const old=Catalog.load({flowDataMode:'real',snapshotPath:oldPath,reviewPath:oldReview} as any),next=Catalog.load({flowDataMode:'real',snapshotPath:activePath} as any);
  assert.equal(old.usableCities(now).length,2,'Исходные факты должны ещё допускать сохранение: не менять их часы.');
  assert.equal(next.usableCities(now).length,2);
  mkdirSync('.review/real-catalog/r18',{recursive:true});const run=mkdtempSync(resolve('.review/real-catalog/r18/journey-'));
  const d=await flowDriver(resolve(run,'disposable.sqlite'),{snapshots:old.availableCities.map(c=>old.forCity(c))},now,true,old.review);
  const frames:{stage:string;text:string;links:string[]}[]=[];
  const capture=(stage:string)=>frames.push({stage,text:d.screen()!.body.text,links:d.buttons().flatMap(b=>b.type==='link'?[b.url]:[])});
  try {
    await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');capture('Исходная реальная карточка');
    await d.click('Условия посещения');capture('Условия и источник');await d.click('К карточке');await d.click('Сохранить');
    const before=d.runtime.store.db.prepare('SELECT * FROM bookmarks').all();
    const stored=JSON.parse((before[0] as {data:string}).data);
    await d.reloadCatalog(activePath);await d.say('/saved');await d.click('Открыть 1');capture('Та же закладка после смены снимка и restart');
    assert(deliveryAllowed(d.screen()!,d.config,d.catalog,d.now));
    assert(d.screen()!.body.text.includes('Сохранённый выбор · текущие условия'));
    assert.notEqual(d.screen()!.displayRefs![0]!.snapshotHash,stored.displayRef.snapshotHash);
    assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').all(),before);
    await d.click('Условия посещения');capture('Текущие условия');await d.click('К карточке');
    await d.click('Удалить закладку');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);capture('Две кнопки подтверждения');
    await d.click('Отмена');capture('Отмена возвращает к текущему просмотру');assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').all(),before);
    await d.click('Удалить закладку');await d.click('Да, удалить');assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
    mkdirSync(output,{recursive:true});
    const result={at:new Date(now).toISOString(),LOCAL_INTEGRATION_SMOKE:'PASS',BOOKMARK_REFRESH:'PASS',REAL_APPLICATION_SMOKE:'REQUIRED',simulatedMAX:true,originalSnapshots:old.availableCities.map(c=>snapshotDigest(old.forCity(c))),currentSnapshots:next.availableCities.map(c=>snapshotDigest(next.forCity(c))),storedBookmarkUnchangedBeforeExplicitDelete:true,identity:stored.identity,currentPermission:true,cancelDestination:'bookmark',deletedOnlyAfterConfirmation:true,frames};
    writeFileSync(resolve(output,'bookmark-walkthrough.json'),JSON.stringify(result,null,2)+'\n');
    writeFileSync(resolve(output,'bookmark-cards.md'),'# Реальная закладка после обновления\n\nЛокальный HTTP и simulated MAX; одноразовые actor/SQLite.\n'+frames.map(f=>'\n## '+f.stage+'\n\n```text\n'+f.text+'\n```\n\n'+f.links.map(u=>'[Источник]('+u+')').join(' · ')+'\n').join(''));
    console.log(JSON.stringify({...result,frames:frames.length}));
  }finally{await d.close();}
}
if(process.argv[1]?.endsWith('real-refresh-walkthrough.js'))refreshWalkthrough(process.argv[2]).catch(e=>{console.error(e.message);process.exitCode=1;});
