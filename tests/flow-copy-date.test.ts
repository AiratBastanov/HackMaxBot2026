import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {flowDriver,chooseDefaults} from '../scripts/flow-driver.js';
import {compactFixture} from '../src/culture/compact-fixture.js';
import {getState,makeQuery} from '../src/culture/flow.js';
import {cities,type CityKey} from '../src/data/cities.js';
import {ACTOR} from './fixtures.js';
import {validateOperation} from '../src/max.js';

// Даты и дополнительные ограничения ниже — только офлайн synthetic fixtures.
async function setup(t:TestContext,iso='2030-04-05T06:00:00Z',input=compactFixture(new Date(iso))) {
  const root=resolve('.tmp/copy-date-tests');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(resolve(root,'case-')),d=await flowDriver(resolve(dir,'disposable.sqlite'),input,Date.parse(iso));
  t.after(async()=>{await d.close();assert(dir.startsWith(root+sep));rmSync(dir,{recursive:true});});return d;
}
type Driver=Awaited<ReturnType<typeof setup>>;
const state=(d:Driver)=>JSON.parse(getState(d.runtime.store,ACTOR)!.data);
const text=(d:Driver)=>d.screen()!.body.text;
function dateAction(d:Driver,relative:'Сегодня'|'Завтра') {
  const label=d.dateLabel(relative),payload=d.payload(label);
  const row=d.runtime.store.db.prepare('SELECT purpose,data FROM flow_actions WHERE id=?').get(payload.slice(3)) as {purpose:string;data:string};
  assert.equal(row.purpose,'date');return {label,payload,date:JSON.parse(row.data) as string};
}
async function toDates(d:Driver,city:CityKey) {await d.enter();await d.click('Подобрать');await d.say(cities[city].name);}

test('R20 даты: реальные action-аргументы, обе зоны, разные местные дни, смена месяца и года → экран → summary → query',async t=>{
  const cases=[
    {clock:'2026-09-25T20:00:00Z',kzn:['2026-09-25','2026-09-26'],ekb:['2026-09-26','2026-09-27']},
    {clock:'2026-09-30T18:00:00Z',kzn:['2026-09-30','2026-10-01'],ekb:['2026-09-30','2026-10-01']},
    {clock:'2026-12-31T18:00:00Z',kzn:['2026-12-31','2027-01-01'],ekb:['2026-12-31','2027-01-01']},
  ];
  for(const row of cases)for(const city of ['kzn','ekb'] as const)for(const [index,relative] of (['Сегодня','Завтра'] as const).entries()) {
    const d=await setup(t,row.clock);await toDates(d,city);
    const action=dateAction(d,relative),expected=row[city][index]!;
    assert.equal(action.date,expected);assert.equal(action.label,relative+' · '+expected.slice(8)+'.'+expected.slice(5,7));
    await d.press(action.payload);assert.equal(state(d).draft.date,expected);
    const natural=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(expected+'T12:00:00Z'));
    assert(text(d).includes(natural));assert(text(d).includes(cities[city].name));assert.match(text(d),city==='kzn'?/UTC\+3/:/UTC\+5/);
    const from=relative==='Сегодня'?'23:30':'12:00',until=relative==='Сегодня'?'23:59':'18:00';
    if(relative==='Сегодня'){await d.click('Другое время');await d.say(state(d).input.token+' '+from+'-'+until);}
    else await d.click('12:00–18:00');
    await d.click('Продолжить');await d.click('До 500 ₽');await d.click('Любая тема');
    assert(text(d).includes(natural));assert.equal(state(d).stage,'summary');
    await d.click('Показать результаты');const q=makeQuery(state(d).draft),offset=city==='kzn'?'+03:00':'+05:00';
    assert.equal(q.start,new Date(expected+'T'+from+':00'+offset).toISOString());
    assert.equal(q.end,new Date(expected+'T'+until+':00'+offset).toISOString());
    assert.equal(q.city,city);assert.equal(q.timezone,cities[city].timezone);
  }
});

test('R20 полночь: отложенное «Завтра» сохраняет дату; вчерашнее «Сегодня» отклоняется внутри TTL',async t=>{
  for(const city of ['kzn','ekb'] as const)for(const relative of ['Сегодня','Завтра'] as const) {
    const clock=city==='kzn'?'2026-12-31T20:59:40Z':'2026-12-31T18:59:40Z';
    const d=await setup(t,clock);await toDates(d,city);const a=dateAction(d,relative),before=state(d).draft;
    d.advance(45000);await d.press(a.payload);
    if(relative==='Завтра') {
      assert.equal(state(d).stage,'time');assert.equal(state(d).draft.date,'2027-01-01');
      assert.match(text(d),/1 января, пт/); // прежняя кнопка не превращается во 2 января.
    } else {
      assert.equal(state(d).stage,'date');assert.deepEqual(state(d).draft,before);
      assert.match(text(d),/дата уже недоступна.*Выберите/);assert.equal(dateAction(d,'Сегодня').date,'2027-01-01');
    }
  }
});

test('R20 Back и edit: дата остаётся на custom-time, возврат не пропускает состав, прошедшее время не принимается',async t=>{
  const d=await setup(t);await toDates(d,'ekb');await d.click(d.dateLabel('Завтра'));
  await d.click('Другое время');assert.match(text(d),/6 апреля, сб.*Екатеринбург/);assert.match(text(d),/UTC\+5/);
  await d.click('Назад');assert.match(text(d),/6 апреля, сб/);
  await d.click('Другая дата');assert.match(text(d),/Выбрано: 6 апреля 2030/);await d.click(d.dateLabel('Завтра'));assert.equal(state(d).editing,false);assert.equal(state(d).stage,'time');
  await d.click('12:00–18:00');assert.equal(state(d).stage,'party');await d.click('Продолжить');await d.click('До 500 ₽');await d.click('Любая тема');
  await d.click('Время');await d.click('Другое время');assert.match(text(d),/6 апреля, сб/);await d.click('Назад');await d.click('18:00–22:00');
  assert.equal(state(d).stage,'summary');assert.equal(makeQuery(state(d).draft).start,'2030-04-06T13:00:00.000Z');
  await d.click('Дата');assert.match(text(d),/Выбрано: 6 апреля 2030/);await d.click('Другая дата');await d.click('Назад');assert.match(text(d),/Выбрано: 6 апреля 2030/);await d.click(d.dateLabel('Сегодня'));await d.click('Время');await d.click('Другое время');
  await d.say(state(d).input.token+' 00:00-01:00');assert.equal(state(d).stage,'input');assert.match(text(d),/ещё не закончившийся интервал/);
});

test('R20 полный renderer: применимость тарифов, различные ограничения, конфликты и страницы без потери фактов',async t=>{
  const fixture=compactFixture(),e=fixture.snapshots[0]!.events[0]!;
  e.tariffs!.push({audience:'GROUP',minAge:null,maxAge:null,kind:'CONDITIONAL',amount:null,lowerBound:null,currency:'RUB',applicable:false,conditions:['Экскурсия для группы 9900 ₽'],evidence:'Отдельная услуга.'});
  e.tariffs!.find(t=>t.audience==='ADULT')!.conditions=['Билет на одну выставку.'];
  e.tariffs!.find(t=>t.audience==='CHILD')!.conditions=['Детский билет при предъявлении документа.'];
  e.admission.conditions.push('Вход с отдельного двора.','Вход с другой улицы.');
  e.observations[0]!.conflicts.push('price');
  const long='Дополнительное ограничение: '+'А'.repeat(3900)+' УСЛОВИЕ_ЦЕЛИКОМ';e.admission.conditions.push(long);
  const facts=JSON.stringify(fixture),d=await setup(t,undefined,fixture);
  await d.enter();await chooseDefaults(d);await d.click('Подробнее 1');
  assert.equal((text(d).match(/200 ₽/g)??[]).length,1);assert.doesNotMatch(text(d),/9900|Детский билет/);assert.match(text(d),/противоречие/);
  assert.match(text(d),/Регистрация: обязательна/);assert.match(text(d),/Последний вход: 17:30/);assert.match(text(d),/Часы работы: 10:00–18:00/);
  const readPages=async()=>{await d.click('Условия посещения');let result=text(d);while(d.buttons().some(b=>b.text==='Далее условия')){await d.click('Далее условия');result+=text(d);}return result;};
  const pages=await readPages();for(const s of ['Билет на одну выставку.','Вход с отдельного двора.','Вход с другой улицы.','УСЛОВИЕ_ЦЕЛИКОМ','расходятся сведения: цена'])assert(pages.includes(s));
  assert.doesNotMatch(pages,/9900|Детский билет/);assert.equal(JSON.stringify(fixture),facts);
  await d.click('К карточке');await d.click('Сохранить');assert(text(d).startsWith('✅ СОХРАНЕНО'));assert(d.buttons().some(b=>b.text==='✅ Сохранено'));
  const saved=d.runtime.store.db.prepare('SELECT * FROM bookmarks').get();await d.click('Мои события');await d.click('Открыть 1');await readPages();
  await d.click('Удалить закладку');assert.deepEqual(d.buttons().map(b=>b.text),['Да, удалить','Отмена']);await d.click('Отмена');assert.match(text(d),/Условия посещения/);
  assert.deepEqual(d.runtime.store.db.prepare('SELECT * FROM bookmarks').get(),saved);
  for(const op of d.operations)if(op.method==='messages'||op.method==='edit'){validateOperation(op);assert(op.body.text.length<=3950);assert.doesNotMatch(op.body.text,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);}
  // R20-UX02: платный вход не означает обязательную регистрацию; касса, последний вход и часы — разные факты.
  const unknown=compactFixture(),paid=unknown.snapshots[0]!.events[0]!;
  paid.admission.registration='UNKNOWN';paid.admission.conditions=[];
  for(const hours of paid.occurrences[0]!.opening!)hours.salesCutoff=16*60+45;
  const u=await setup(t,undefined,unknown);await u.enter();await chooseDefaults(u);await u.click('Подробнее 1');
  assert.match(text(u),/200 ₽ за всех/);assert.match(text(u),/Нужна ли предварительная регистрация — уточните у организатора/);assert.doesNotMatch(text(u),/Регистрация: обязательна/);
  for(const value of ['посещение 12:00–18:00','Часы работы: 10:00–18:00','Последний вход: 17:30.','Касса закрывается в 16:45.'])assert(text(u).includes(value));
  await u.click('Условия посещения');assert.match(text(u),/Последний вход: 17:30.*Касса закрывается в 16:45/);assert.doesNotMatch(text(u),/Наличие билетов уточняйте|Дорога и длительность/);
});
