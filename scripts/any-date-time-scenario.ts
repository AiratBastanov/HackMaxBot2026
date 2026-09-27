import assert from 'node:assert/strict';
import {variantsFixture,state,savedRows,type Driver} from './bookmark-scenario.js';
import {cities,cityInstant,type CityKey} from '../src/data/cities.js';
import {validateSnapshot} from '../src/data/contract.js';
import {validateOperation} from '../src/max.js';

// Вымышленные расписания. Ни источники, ни текущая дата не передатируются.
export function anyFixture(city:CityKey='kzn') {
  const s=variantsFixture(),zone=cities[city].timezone;
  s.scope={...s.scope,city,timezone:zone,start:cityInstant('2030-04-05','00:00',zone),end:cityInstant('2030-04-12','00:00',zone)};
  s.venues.forEach(v=>v.city=city);
  for(const e of s.events) {e.city=city;for(const o of e.occurrences)o.timezone=zone;}
  const [flex,morning,future]=s.events;
  flex!.title='СИНТЕТИКА: Свет в музее';flex!.occurrences[0]!.activeFrom='2030-04-06';flex!.occurrences[0]!.activeThrough='2030-04-11';
  morning!.title='СИНТЕТИКА: Утренний концерт';
  for(const [i,o] of morning!.occurrences.entries()) {
    const day=i?'2030-04-08':'2030-04-06';o.start=cityInstant(day,i?'21:00':'08:00',zone);o.end=cityInstant(day,i?'22:00':'09:00',zone);
  }
  future!.title='СИНТЕТИКА: Спектакль через три дня';future!.occurrences[0]!.start=cityInstant('2030-04-08','13:00',zone);future!.occurrences[0]!.end=cityInstant('2030-04-08','14:00',zone);
  return validateSnapshot(s);
}
export type Frame={title:string;text:string;buttons:string[]};
export async function combinedJourney(d:Driver) {
  const frames:Frame[]=[],capture=(title:string)=>frames.push({title,text:d.screen()!.body.text,buttons:d.buttons().map(b=>b.text)});
  await d.enter();await d.click('Подобрать');await d.click('Казань');capture('1. Дата: конкретная, без ограничения или ручной ввод');
  await d.click('Любая дата');capture('2. Время для любой даты: лишней кнопки даты нет');
  assert(!d.buttons().some(b=>b.text==='Другая дата'));assert.match(d.screen()!.body.text,/📅 Любая дата · Казань/);
  await d.click('Любое время');await d.click('Продолжить');await d.click('До 500 ₽');await d.click('Выставки');capture('3. Сводка двух независимых предпочтений');
  assert.match(d.screen()!.body.text,/Дата: любая\nВремя: любое/);
  await d.click('Показать результаты');capture('4. Результаты: одна выставка и реальные сеансы');
  assert.equal(state(d).cards.filter((c:any)=>c.occurrence.kind==='FLEXIBLE_VISIT').length,1);
  await d.click('Подробнее 1');const choice=structuredClone(state(d).cards[0]);capture('5. Конкретное предложенное посещение выставки');
  assert.match(d.screen()!.body.text,/6 апреля 2030 г\. · предложенное посещение 10:00–20:00/);
  await d.click('Условия посещения');assert.match(d.screen()!.body.text,/предложенное посещение 10:00–20:00/);
  await d.click('К карточке');await d.click('Сохранить');const saved=savedRows(d)[0]!;
  assert.deepEqual(JSON.parse(saved.data).visit,choice.visit);
  await d.click('Мои события');capture('6. Закладка с конкретным посещением и ценой');
  await d.restart();await d.say('/saved');await d.click('Открыть 1');capture('7. Та же закладка после перезапуска');
  assert.deepEqual(savedRows(d),[saved]);assert.match(d.screen()!.body.text,/Выбрано: 6 апреля 2030 г\. · 10:00–20:00/);
  // Второй поиск через настоящие кнопки: конкретный день сохраняется при ANY_TIME.
  await d.click('Главная');await d.click('Подобрать');await d.click('Казань');await d.click(d.dateLabel('Завтра'));
  await d.click('Любое время');await d.click('Продолжить');await d.click('До 500 ₽');await d.click('Любая тема');capture('8. Конкретная дата и любое время');
  await d.click('Показать результаты');await d.click('Подробнее 1');capture('9. Утренний сеанс вне прежнего окна 12–18');
  assert.match(d.screen()!.body.text,/Сеанс: 08:00–09:00/);
  for(const op of d.attempts)validateOperation(op);
  return frames;
}
