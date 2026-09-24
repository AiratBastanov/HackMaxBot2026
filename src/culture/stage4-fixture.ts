import { flowFixture, syntheticClock } from './fixture.js';
import { validateSnapshot } from '../data/contract.js';

// Новые вымышленные события; исторический fixture этапа 2/3 сохранён.
export function stage4Fixture(clock:Date=syntheticClock) {
  const s=flowFixture(clock),e=s.events[0]!,venue=s.venues[0]!;
  e.price={kind:'EXACT',amount:200,lowerBound:null,currency:'RUB',applicability:'SINGLE_ADULT',evidence:'200 рублей за взрослый билет на вымышленную выставку',conditions:['Один взрослый, одна выставка']};
  e.admission.registration='REQUIRED';e.admission.conditions=['Нужна предварительная запись на сайте примера'];
  e.occurrences[0]!.opening=Array.from({length:7},(_,weekday)=>({weekday,open:600,close:1080,lastEntry:1050}));
  venue.title='СИНТЕТИКА: тестовый зал';venue.address='Казань, Вымышленная улица, 17 (адрес для теста)';
  const theater=structuredClone(e);theater.id='synthetic:stage4:theater';theater.title='СИНТЕТИКА: театральная экспозиция';theater.categories=['theater'];
  theater.sourceUrl='https://example.org/synthetic-stage4-theater';theater.occurrences.forEach((o,i)=>{o.id=`${theater.id}:${i}`;});
  e.categories=['exhibition'];s.events.push(theater);s.stats.normalizedEvents=s.events.length;s.stats.occurrences=s.events.reduce((n,e)=>n+e.occurrences.length,0);
  return validateSnapshot(s);
}
