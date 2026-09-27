import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {flowDriver} from './flow-driver.js';
import {variantsFixture,search,savedRows,state} from './bookmark-scenario.js';
import {MaxError,validateOperation} from '../src/max.js';

// Только одноразовая SQLite и вымышленные события; путь не может указывать на live БД.
const root=resolve(process.argv[2]??'.review/flow-corrections/walkthrough');mkdirSync(root,{recursive:true});
const run=mkdtempSync(resolve(root,'case-')),fixture=variantsFixture();
fixture.events[2]!.title='СИНТЕТИКА: По залам вымышленного музея';fixture.events[2]!.categories=['tour'];
let fail=false;
const d=await flowDriver(resolve(run,'disposable.sqlite'),fixture,undefined,false,null,true,async(op,local)=>{
  if(fail&&op.method==='edit'){fail=false;throw new MaxError('INVALID_REQUEST',400);}return local.execute(op);
});
const frames:{title:string;text:string;buttons:string[]}[]=[];
const capture=(title:string)=>frames.push({title,text:d.screen()!.body.text,buttons:d.buttons().map(b=>b.text)});
try {
  await search(d,{category:'Экскурсии'});await d.click('Бюджет');await d.click('До 1000 ₽');
  assert.match(d.screen()!.body.text,/Тема: Экскурсии/);capture('1. Выбрана экскурсия: сводка сохраняет тему');
  await d.click('Время');await d.click('Другое время');await d.say(state(d).input.token+' 11:47-18:13');
  const committed=structuredClone(state(d).draft);await d.click('Время');await d.click('Другое время');await d.click('Назад');await d.click('Назад');
  assert.deepEqual(state(d).draft,committed);capture('2. Произвольные минуты приняты; Back отменяет незавершённое редактирование');
  await d.click('Показать результаты');await d.click('Подробнее 1');await d.click('Мои события');
  capture('3. Уход с открытой карточки: явное сохранение перед переходом');
  const action=d.payload('Сохранить и перейти');await d.click('Сохранить и перейти');await d.press(action);assert.equal(savedRows(d).length,1);
  const excursion=savedRows(d)[0]!;capture('4. Сохранено один раз; список показывает применимую цену');
  await d.click('Назад');await d.click('Подробнее 1');assert(d.buttons().some(b=>b.text==='✅ Сохранено'));capture('5. Повторный выбор открывает уже сохранённую запись');
  await d.click('К результатам');await d.click('Тема');await d.click('Выставки');await d.click('Показать результаты');await d.click('Подробнее 1');await d.click('Сохранить');
  const retained=savedRows(d)[0]!;await d.click('Мои события');await d.click('Удалить 2');capture('6. Точное удаление экскурсии: два действия');
  fail=true;await d.click('Да, удалить');assert.deepEqual(savedRows(d),[retained]);assert.notEqual(retained.identity,excursion.identity);
  const failure=d.reports.find(r=>'errorClass' in r&&r.errorClass==='INVALID_REQUEST');assert(failure);
  await d.say('/saved');capture('7. Синтетический HTTP 400 после commit; новый ввод возвращает оставшуюся запись');
  assert.equal(d.screen()!.method,'messages');assert.deepEqual(savedRows(d),[retained]);
  await d.restart();assert.deepEqual(savedRows(d),[retained]);
  for(const op of d.attempts)validateOperation(op);
  const md='# Локальный walkthrough исправлений\n\nТолько вымышленные события и участник. Настоящие HTTP decoder/admission, worker, SQLite, renderer и outbox; MAX симулирован. Это не наблюдение мобильного или веб-клиента.\n'+
    frames.map(f=>'\n## '+f.title+'\n\n```text\n'+f.text+'\n```\n\nКнопки: '+f.buttons.join(' · ')+'\n').join('')+
    '\nОтказ `PUT /messages`, HTTP 400 / INVALID_REQUEST, внедрён локально после удаления. Запись удалена до сети; одинаковый POST не отправлен, контакт доступен. Причина исторического HTTP 400 этим опытом не установлена.\n';
  writeFileSync(resolve(root,'walkthrough.md'),md);
  const receipt={result:'PASS',transport:'SIMULATED_MAX',fixture:true,frames:frames.length,bookmarksBeforeDeletion:2,bookmarksAfterDeletion:1,
    retainedRecordUnchanged:true,restartPreservesRecord:true,deleteCommittedBeforeFailedResponse:true,contactAvailable:true,historicalCause:'NOT_ESTABLISHED',failure};
  writeFileSync(resolve(root,'walkthrough.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await d.close();}
