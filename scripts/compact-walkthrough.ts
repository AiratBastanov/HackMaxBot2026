import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {flowDriver} from './flow-driver.js';
import {compactFixture} from '../src/culture/compact-fixture.js';
import {getState} from '../src/culture/flow.js';
import {activeScreen} from '../src/screens.js';
import {ACTOR} from '../tests/fixtures.js';

async function main() {
  const root=resolve('.review/compact-ux');mkdirSync(root,{recursive:true});
  const run=mkdtempSync(resolve(root,'smoke-')),d=await flowDriver(resolve(run,'synthetic.sqlite'),compactFixture());
  const frames:{title:string;text:string;buttons:string[]}[]=[];
  const capture=(title:string)=>frames.push({title,text:d.screen()!.body.text,buttons:d.buttons().map(b=>b.text)});
  const state=()=>JSON.parse(getState(d.runtime.store,ACTOR)!.data);
  try {
    assert.equal((await fetch(d.origin+'/healthz')).status,200);
    await d.enter();const firstMid=activeScreen(d.runtime.store,ACTOR)!.mid;
    await d.click('Подобрать');capture('Город: кнопки и прямой текст');await d.say('  КАЗАНЬ  ');
    for(const label of ['Завтра','12:00–18:00','Взрослые +','Дети +','Продолжить','Указать возраст'])await d.click(label);
    await d.say(state().input.token+' 7');await d.click('До 500 ₽');await d.click('Любой');capture('Запрос: два взрослых и ребёнок семи лет');
    await d.click('Показать результаты');await d.click('Подробнее 1');capture('Карточка: известная сумма на всех');
    assert.match(d.screen()!.body.text,/500 ₽ за всех/);assert.equal(activeScreen(d.runtime.store,ACTOR)!.mid,firstMid);
    await d.click('Условия посещения');capture('Отдельные условия посещения');await d.click('К карточке');await d.click('Сохранить');
    await d.click('К результатам');await d.click('Показать варианты для проверки');await d.click('Подробнее 3');capture('Кандидат: детская цена неизвестна');assert.match(d.screen()!.body.text,/Известная часть: 400 ₽/);
    await d.click('Мои события');await d.click('Открыть 1');await d.click('Удалить закладку');capture('Удаление: ровно два действия');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);
    await d.click('Отмена');assert.equal(state().stage,'bookmark');capture('Отмена: сохранённая карточка');
    await d.click('Главная');await d.click('Подобрать');await d.click('Екатеринбург');
    for(const label of ['Завтра','12:00–18:00','Продолжить','До 500 ₽','Любой'])await d.click(label);capture('Второй город: местное время UTC+5');
    await d.click('Показать результаты');assert(state().cards.every((c:{eventId:string})=>c.eventId.includes(':ekb:')));
    await d.restart();await d.say('/saved');await d.click('Открыть 1');assert.match(d.screen()!.body.text,/Казань · 2 взр., 1 дет/);
    await d.click('Удалить закладку');await d.click('Да, удалить');assert.equal((d.runtime.store.db.prepare('SELECT count(*) n FROM bookmarks').get() as {n:number}).n,0);
    await d.say('/delete_data');capture('Стирание параметров: явная область и два действия');await d.click('Да, удалить');
    assert(d.operations.some(o=>o.method==='delete'));assert(d.operations.some(o=>o.method==='edit'));
    const beforePath=resolve(root,'before.json');
    const before=existsSync(beforePath)?JSON.parse(readFileSync(beforePath,'utf8')) as {baseline:string;overview:string}:null;
    const file=resolve('docs/evidence/compact-ux/walkthrough.md');mkdirSync(resolve(file,'..'),{recursive:true});
    const intro='# Компактный UX: transcript из реального renderer\n\nТолько вымышленные данные и участники. Настоящие HTTP admission, worker, SQLite, restart и renderer; MAX — LocalMax с изменением и удалением сообщений. Это AUTOMATED evidence, не наблюдение mobile/web.\n';
    const md=intro+(before?'\n## До\n\nRenderer baseline `'+before.baseline+'`, сохранён до редактирования кода.\n\n```text\n'+before.overview+'\n```\n':'')+
      '\n## После\n'+frames.map(f=>'\n### '+f.title+'\n\n```text\n'+f.text+'\nКнопки: '+f.buttons.join(' · ')+'\n```\n').join('');
    writeFileSync(file,md);
    const result={result:'PASS',realApplicationSmoke:'PASS',http:true,admission:true,worker:true,sqlite:true,renderer:true,restart:true,simulatedMax:true,realMax:false,
      sameActiveMessage:true,cityCount:2,timezones:['Europe/Moscow','Asia/Yekaterinburg'],exactPartyTotal:true,unknownChildTotal:true,twoButtonConfirmations:true,
      operations:Object.fromEntries(['messages','edit','read','delete','answers'].map(m=>[m,d.operations.filter(o=>o.method===m).length]))};
    writeFileSync(resolve(root,'smoke.json'),JSON.stringify(result,null,2)+'\n');
    writeFileSync(resolve(run,'transcript.txt'),d.transcript.join('\n\n').replace(/[A-F0-9]{6}(?= (?:ГГГГ|ЧЧ|СУММА|ЧИСЛО|\?))/g,'<код формы>'));
    console.log(JSON.stringify(result));
  } finally {await d.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
