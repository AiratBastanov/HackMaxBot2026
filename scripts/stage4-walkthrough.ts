import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flowDriver } from './flow-driver.js';
import { stage4Fixture } from '../src/culture/stage4-fixture.js';
import { getState } from '../src/culture/flow.js';
import { ACTOR } from '../tests/fixtures.js';

async function main() {
  const root=resolve('.review/stage4');mkdirSync(root,{recursive:true});const run=mkdtempSync(resolve(root,'journey-'));
  const d=await flowDriver(resolve(run,'synthetic.sqlite'),stage4Fixture());
  try {
    await d.enter();
    for(const label of ['Подобрать','Другая дата','Назад','Завтра','Другое время','Назад','12:00–18:00','Другая сумма','Назад','До 500 ₽','Театр','Показать результаты']) await d.click(label);
    const cards=JSON.parse(getState(d.runtime.store,ACTOR)!.data).cards;
    assert.equal(cards.length,2);assert.equal(cards[0].eventId,'synthetic:stage4:theater');
    await d.click('Подробнее 1');for(const re of [/17:30/,/200 ₽/,/Регистрация: обязательна/,/Вымышленная улица/]) assert.match(d.screen()!.body.text,re);
    await d.click('Все условия');await d.click('К карточке');await d.click('Сохранить');await d.restart();await d.say('/saved');await d.click('Открыть 1');assert.match(d.screen()!.body.text,/17:30/);
    await d.click('Удалить закладку');await d.click('Да, удалить');assert.match(d.screen()!.body.text,/Закладок пока нет/);
    await d.click('Главная');for(const label of ['Подобрать','Завтра','12:00–18:00','До 500 ₽','Любой','Показать результаты','Показать варианты для проверки','Подробнее 3','Сохранить']) await d.click(label);
    await d.say('/delete_data');await d.click('Да, удалить мои данные');await d.restart();await d.say('/saved');assert.match(d.screen()!.body.text,/Закладок пока нет/);
    const text='СИНТЕТИЧЕСКИЙ HTTP/SQLite ПРОГОН; MAX симулирован; часы 2030-04-05.\n\n'+d.transcript.join('\n\n').replace(/[A-F0-9]{6}(?= (?:ГГГГ|ЧЧ|СУММА))/g,'<код формы>');
    writeFileSync(resolve(root,'synthetic-journey.txt'),text);
    console.log(JSON.stringify({result:'PASS',http:true,sqlite:true,backPaths:3,interestPreference:true,essentialConditions:true,saveRestartRemove:true,erasureRestart:true,operations:d.operations.length,realMax:false}));
  } finally {await d.close();}
}
main().catch(()=>{console.error('STAGE4_JOURNEY_FAILED');process.exitCode=1;});
