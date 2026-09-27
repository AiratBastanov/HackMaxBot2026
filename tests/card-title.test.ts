import test from 'node:test';
import assert from 'node:assert/strict';
import {eventType,presentationTitle,projectCard,displayInterval,cardPages,type Card} from '../src/culture/card.js';
import {Catalog} from '../src/culture/catalog.js';
import {select} from '../src/data/select.js';
import {makeQuery} from '../src/culture/flow.js';
import {syntheticClock} from '../src/culture/fixture.js';
import {variantsFixture} from '../scripts/bookmark-scenario.js';
import {overlappingChoice,selectedInterval,equivalentChoice} from '../src/culture/bookmark.js';

function card() {
  const catalog=new Catalog('synthetic-test',variantsFixture()),q=makeQuery({date:'2030-04-06',from:'12:00',until:'18:00',budget:null,category:null});
  return projectCard(catalog,q,select(catalog.snapshot,q,syntheticClock,true).recommendations.find(r=>r.eventId==='synthetic:flow:1')!);
}
test('Единый тип из фактов, общие категории уступают конкретным; education не становится лекцией',()=>{
  const labels={concert:'Концерт',theater:'Театр',exhibition:'Выставка',tour:'Экскурсия',workshop:'Мастер-класс',education:'Образовательное событие',culture:'Культурное событие'};
  for(const [key,label] of Object.entries(labels))assert.equal(eventType({categories:[key]}),label);
  assert.equal(eventType({categories:['culture','education','workshop']}),'Мастер-класс');
  assert.equal(eventType({categories:['unknown']}),'Тип не указан');assert.equal(eventType({}),'Тип не указан');
  const c=card();c.categories=['concert'];c.title='Программа (вечер) — 演出 🎭';c.query.preferences.categories=['theater'];c.visit!.venue.title='Театр';
  const before=JSON.stringify(c),title=presentationTitle(c);
  assert.equal(title,'Программа (вечер) — 演出 🎭 (Концерт)');assert.equal(presentationTitle(c),title);assert.equal(JSON.stringify(c),before);
  c.title='Программа (Концерт)';assert.equal(presentationTitle(c),c.title);
  c.title='Длинная программа '+ '🎭'.repeat(200);const short=presentationTitle(c,160);
  assert(short.length<=160);assert(short.endsWith(' (Концерт)'));assert.doesNotMatch(short,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
});
test('Пересечения — только известные интервалы в UTC; соседние, неизвестные и весь выставочный период не конфликт',()=>{
  const a=card(),b=structuredClone(a);
  assert(selectedInterval(a));assert(overlappingChoice(a,b));assert(equivalentChoice(a,b));
  b.query.start='2030-04-06T12:00:00+03:00';b.query.end='2030-04-06T18:00:00+03:00';assert(equivalentChoice(a,b));
  b.visit!.from='2030-04-06T14:00:00+05:00';b.visit!.until='2030-04-06T16:00:00+05:00';assert(overlappingChoice(a,b));
  b.visit!.from=a.visit!.until;b.visit!.until='2030-04-06T17:00:00Z';b.query.end=b.visit!.until;assert(!overlappingChoice(a,b));
  b.visit!.until=null;assert.equal(selectedInterval(b),null);assert(!overlappingChoice(a,b));
  b.visit!.from='2030-04-01T00:00:00Z';b.visit!.until='2030-06-30T00:00:00Z';
  b.query.start='2030-04-07T09:00:00Z';b.query.end='2030-04-07T15:00:00Z';
  assert.deepEqual(selectedInterval(b),[Date.parse(b.query.start),Date.parse(b.query.end)]);assert(!overlappingChoice(a,b));
  b.visit!.timeAssessment={name:'time',state:'UNKNOWN',detail:'Неизвестно'};assert.equal(selectedInterval(b),null);
  const timed:Card={...a,occurrence:{kind:'TIMED_SESSION',start:a.visit!.from,end:null},visit:{...a.visit!,until:null}};
  assert.equal(selectedInterval(timed),null);
  assert.match(displayInterval(a.query.start,a.query.end,'Europe/Moscow'),/12:00–18:00/);
});
test('Полное длинное название не разрезает суффикс типа на границе страниц и сохраняет условия',()=>{
  const c=structuredClone(card());c.title='Программа '+'🎭'.repeat(100);
  for(let length=1845;length<1880;length++){
    const condition='Ограничение: '+'Я'.repeat(length);c.visit!.admission.conditions=[condition];
    const pages=cardPages(c,syntheticClock.getTime());
    assert(pages.every(p=>p.length<=2401));assert(pages.join('').includes(condition));
    assert(pages.join('').includes('Полное название: '+presentationTitle(c,Infinity)));
    for(const page of pages)assert.doesNotMatch(page,/\((?:В|Вы|Выс|Выст|Выста|Выстав|Выставк|Выставка)?$/u);
  }
});
