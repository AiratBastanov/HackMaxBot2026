import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { flowDriver, chooseDefaults } from '../scripts/flow-driver.js';
import { stage4Fixture } from '../src/culture/stage4-fixture.js';
import { syntheticClock } from '../src/culture/fixture.js';
import { getState, makeQuery } from '../src/culture/flow.js';
import { cardOverview, cardPages, projectCard } from '../src/culture/card.js';
import { Catalog } from '../src/culture/catalog.js';
import { validateSnapshot } from '../src/data/contract.js';
import { select } from '../src/data/select.js';
import { ACTOR } from './fixtures.js';

async function setup(t: TestContext, input = stage4Fixture()) {
  const root=resolve('.tmp/readiness-flow');mkdirSync(root,{recursive:true});
  const dir=mkdtempSync(resolve(root,'case-')),d=await flowDriver(resolve(dir,'flow.sqlite'),input);
  t.after(async()=>{await d.close();assert(dir.startsWith(root+sep));rmSync(dir,{recursive:true});});return d;
}
const query=()=>makeQuery({date:'2030-04-06',from:'12:00',until:'18:00',budget:500,category:null});
const projection=()=>{const s=stage4Fixture();return projectCard(new Catalog('synthetic-test',s),query(),select(s,query(),syntheticClock,true).recommendations[0]!);};

test('R10-A: группы разделены, opt-in и identity кнопки кандидата сохраняются после смены заголовков',async t=>{
  const d=await setup(t);await d.enter();await chooseDefaults(d);
  assert.match(d.screen()!.body.text,/Совпадает по известным условиям/);
  assert.doesNotMatch(d.screen()!.body.text,/Варианты, где нужно уточнение|мастерская цвета/);
  await d.click('Показать варианты для проверки');const text=d.screen()!.body.text;
  assert(text.indexOf('Совпадает по известным условиям')<text.indexOf('Варианты, где нужно уточнение'));
  assert(text.indexOf('Варианты, где нужно уточнение')<text.indexOf('3. мастерская цвета'));
  const cards=JSON.parse(getState(d.runtime.store,ACTOR)!.data).cards;
  await d.click('Подробнее 3');assert.equal(JSON.parse(getState(d.runtime.store,ACTOR)!.data).selected,cards[2].identity);
  assert.match(d.screen()!.body.text,/Нужно уточнить условия/);
  await d.click('К результатам');await d.click('Бюджет');await d.click('До 500 ₽');await d.click('Показать результаты');
  assert.doesNotMatch(d.screen()!.body.text,/Варианты, где нужно уточнение|мастерская цвета/);
});

test('R10-B: обзор компактен, существенные условия и русская дата видимы без повторов предупреждений',()=>{
  const c=projection(),text=cardOverview(c);
  for(const re of [/тестовый зал/,/Вымышленная улица/,/10:00.*18:00/,/12:00.*18:00/,/Последний вход:.*17:30/,/200 ₽/,/Регистрация: обязательна/,/предварительная запись/,/6 апреля 2030/,/Москва, UTC\+3/,/Вымышленный набор/]) assert.match(text,re);
  assert.equal(text.match(/17:30/g)?.length,1);
  assert.doesNotMatch(text,/Наличие билета/);
  assert.equal(text.match(/Вымышленный набор/g)?.length,1);
  assert.doesNotMatch(text,/2030-04-05T/);
  assert(text.length<1900);
});

test('R10-B: provenance объединяет только одну сущность, время, URL и конфликты; поля и неизвестные сохранены',()=>{
  const c=projection(),v=c.visit!,url='https://example.org/observation-a';
  const row={retrievedAt:'2030-04-05T06:00:00.000Z',requestUrl:url,fields:['address'],conflicts:[] as string[]};
  v.venueObservations=[row,{...row,fields:['timetable']},{...row,fields:['title']},row,
    {...row,conflicts:['address']},{...row,retrievedAt:'2030-04-05T06:00:00.123Z'},{...row,retrievedAt:null}];
  v.eventObservations=[{...row,fields:['dates']}];v.providerUpdatedAt='2030-04-04T06:00:00Z';
  v.warnings.push('Вход с отдельного двора.','Вход с отдельного двора.','Вход с другой улицы.');
  const before=JSON.stringify(c),text=cardPages(c).join('\n');
  assert.doesNotMatch(text,/URL получения|Поля:|09:00:00\.123|example.org\/observation-a/);
  assert.match(text,/расходятся сведения: адрес/);
  assert.equal(text.match(/Вход с отдельного двора/g)?.length,1);assert.match(text,/Вход с другой улицы/);
  assert.equal(JSON.stringify(c),before); // grouping не переписывает точные machine timestamps/наблюдения
});

test('R10-C: fixed/current fixtures показывают только явно примерные ссылки; provider URL contract остаётся строгим',async t=>{
  for(const clock of [syntheticClock,new Date('2026-09-24T06:00:00Z')]) {
    const s=stage4Fixture(clock),d=await setup(t,s);
    // Драйверу fixed-clock нужен запрос внутри scope; ссылки проверяем в самой проекции для обеих дат.
    const q=makeQuery({date:clock.toISOString().slice(0,10),from:'12:00',until:'18:00',budget:500,category:null});
    const result=select(s,q,clock,true),c=projectCard(d.catalog,q,result.recommendations[0]!);
    for(const link of [c.source,...c.visit!.links]) {assert(['example.org','example.com'].includes(new URL(link.url).hostname));assert.match(link.label,/пример|синтетик/i);}
    assert.doesNotMatch(cardPages(c).join('\n'),/kudago\.com|museum\.example\.invalid/);
    const provider=structuredClone(s);provider.mode='LIVE_PUBLIC';const e=provider.events[0]!;
    e.provider='kudago';e.id='kudago:990001';e.verification='API_FACTS_ONLY';e.sourceLabel='Источник: KudaGo';
    e.occurrences.forEach((o,i)=>{o.id=`${e.id}:${i}`;});provider.events=[e];provider.stats.normalizedEvents=1;provider.stats.occurrences=e.occurrences.length;
    assert.throws(()=>validateSnapshot(provider),/source_host/);
  }
});

test('R10-D: evaluator time=MATCH при price=UNKNOWN сохраняется в карточке/закладке после restart',async t=>{
  const s=stage4Fixture(),result=select(s,query(),syntheticClock,true,true),candidate=result.uncertain[0]!;
  assert.equal(candidate.predicates.find(p=>p.name==='time')!.state,'MATCH');
  assert.equal(candidate.predicates.find(p=>p.name==='price')!.state,'UNKNOWN');
  const d=await setup(t,s);await d.enter();await chooseDefaults(d);await d.click('Показать варианты для проверки');await d.click('Подробнее 3');
  const check=()=>{const text=d.screen()!.body.text;assert.match(text,/Нужно уточнить условия/);assert.match(text,/📅.*12:00.*18:00/);assert.match(text,/Взросл.*тариф.*не установлен|итоговую цену/);assert.doesNotMatch(text,/Пересечение с запросом: не подтверждено/);};
  check();await d.click('Сохранить');await d.restart();await d.say('/saved');await d.click('Открыть 1');check();
});

test('R10-D: известные часы не скрывают UNKNOWN границ периода или отсутствующего расписания',()=>{
  for(const missing of ['period','opening']) {
    const s=stage4Fixture(),e=s.events[1]!,o=e.occurrences[0]!;
    if(missing==='period') {o.activeFrom=null;o.startless=false;} else {o.opening=null;o.scheduleBasis='UNKNOWN';}
    const r=select(s,query(),syntheticClock,true,true),candidate=r.uncertain.find(c=>c.eventId===e.id)!;
    assert.equal(candidate.predicates.find(p=>p.name==='time')!.state,'UNKNOWN');
    const c=projectCard(new Catalog('synthetic-test',s),query(),candidate),text=cardPages(c).join('\n');
    assert.equal(c.kind,'UNCERTAIN');assert.match(text,missing==='period'?/границы периода/:/расписания на этот день/);
  }
});
