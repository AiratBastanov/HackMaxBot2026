import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flowDriver, chooseDefaults } from './flow-driver.js';
import { stage4Fixture } from '../src/culture/stage4-fixture.js';
import { syntheticClock } from '../src/culture/fixture.js';
import { getState } from '../src/culture/flow.js';
import { ACTOR } from '../tests/fixtures.js';

async function main() {
  const root=resolve('.review/user-readiness');mkdirSync(root,{recursive:true});
  const run=mkdtempSync(resolve(root,'journey-')),d=await flowDriver(resolve(run,'synthetic.sqlite'),stage4Fixture());
  const text=()=>d.screen()!.body.text;
  const state=()=>JSON.parse(getState(d.runtime.store,ACTOR)!.data);
  const allConditions=async()=>{await d.click('Условия посещения');while(d.buttons().some(b=>b.text==='Далее условия')) await d.click('Далее условия');await d.click('К карточке');};
  try {
    await d.enter();
    for(const label of ['Подобрать','Казань','Другая дата','Назад','Завтра','Другое время','Назад','12:00–18:00','Продолжить','Другая сумма','Назад','До 500 ₽','Театр','Показать результаты']) await d.click(label);
    assert.equal(state().cards.length,2);assert.equal(state().cards[0].eventId,'synthetic:stage4:theater');
    assert.match(text(),/Совпадает по известным условиям/);assert.doesNotMatch(text(),/мастерская цвета/);
    await d.click('Подробнее 1');for(const re of [/17:30/,/200 ₽/,/Регистрация: обязательна/,/Вымышленная улица/]) assert.match(text(),re);
    await allConditions();await d.click('К результатам');await d.click('Показать варианты для проверки');
    assert.match(text(),/Варианты, где нужно уточнение:\n3\. мастерская цвета/);
    await d.click('Подробнее 3');assert.match(text(),/📅.*12:00.*18:00/);assert.match(text(),/Нужно уточнить условия/);
    await allConditions();await d.click('К результатам');
    for(const [field,custom,choice] of [['Дата','Другая дата','Завтра'],['Время','Другое время','12:00–18:00'],['Бюджет','Другая сумма','До 500 ₽']]) {
      await d.click(field!);await d.click(custom!);await d.click('Назад');await d.click(choice!);assert.equal(state().stage,'summary');assert.equal(state().optIn,false);
    }
    await d.click('Показать результаты');assert.doesNotMatch(text(),/мастерская цвета/);await d.click('Подробнее 1');
    await d.click('Сохранить');await d.restart();await d.say('/saved');await d.click('Открыть 1');assert.match(text(),/17:30/);
    const oldBookmark=d.runtime.store.db.prepare('SELECT identity,generation FROM bookmarks').get() as {identity:string;generation:string};
    await d.click('Удалить закладку');const oldDelete=d.payload('Да, удалить');await d.click('Да, удалить');assert.match(text(),/Закладок пока нет/);
    await d.click('Главная');await chooseDefaults(d);await d.click('Подробнее 2');await d.click('Сохранить');
    const newBookmark=d.runtime.store.db.prepare('SELECT identity,generation FROM bookmarks').get() as {identity:string;generation:string};
    assert.equal(newBookmark.identity,oldBookmark.identity);assert.notEqual(newBookmark.generation,oldBookmark.generation);
    await d.press(oldDelete);assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,1);
    d.catalog.replace(null);await d.say('/saved');await d.click('Открыть 1');assert.match(text(),/Текущий снимок недоступен/);assert.match(text(),/Регистрация: обязательна/);
    await d.click('Главная');await d.click('Подобрать');assert.match(text(),/Снимков сейчас нет/);
    await d.say('/delete_data');await d.click('Да, удалить');await d.restart();await d.say('/saved');assert.match(text(),/Закладок пока нет/);
    assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
    const transcript='# Текущий синтетический HTTP/SQLite transcript\n\nСгенерирован scripts/readiness-walkthrough.ts из renderer. MAX симулирован; это не mobile/web observation.\nФиксированные часы: '+syntheticClock.toISOString()+' (только локальный тест). Все события и адреса вымышлены.\nСсылки example.org иллюстративны; переход в клиенте и наличие страницы — отдельные проверки.\n\n```text\n'+d.transcript.join('\n\n').replace(/[A-F0-9]{6}(?= (?:ГГГГ|ЧЧ|СУММА))/g,'<код формы>')+'\n```\n';
    writeFileSync(resolve(root,'synthetic-transcript.md'),transcript);
    const result={result:'PASS',generatedAt:new Date().toISOString(),fixtureClock:syntheticClock.toISOString(),
      http:true,sqlite:true,worker:true,renderer:true,simulatedMax:true,strictOnly:true,explicitCandidates:true,knownCandidateTime:true,
      backPaths:3,summaryEditing:3,completeDetails:true,saveRestartRemoveResave:true,oldDeleteRejected:true,sourceUnavailable:true,erasureRestart:true,
      operations:d.operations.length,screens:d.operations.filter(o=>o.method==='messages').length,realMax:false};
    writeFileSync(resolve(root,'journey.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {await d.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
