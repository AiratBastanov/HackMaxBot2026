import { stage4Fixture } from './stage4-fixture.js';
import { syntheticClock } from './fixture.js';
import { cities, cityDate, cityWindow, type CityKey } from '../data/cities.js';
import { validateSnapshot } from '../data/contract.js';

// Только вымышленные локальные примеры. Это не расширение provider coverage.
export function compactFixture(clock:Date=syntheticClock) {
  return {snapshots:(['kzn','ekb'] as CityKey[]).map(city=>{
    const s=stage4Fixture(clock),zone=cities[city].timezone;
    s.scope={...s.scope,city,timezone:zone,...cityWindow(clock,city)};
    for(const v of s.venues) {const old=v.id;v.id=`synthetic:${city}:${old.replace(/:/g,'_')}`;v.city=city;
      v.title='Зал света';v.address=`${cities[city].name}, Вымышленная улица, 17`;
      for(const e of s.events) for(const o of e.occurrences) if(o.venueId===old)o.venueId=v.id;
    }
    for(const [i,e] of s.events.entries()) {
      e.id=`synthetic:${city}:compact:${i}`;e.city=city;e.title=e.title.replace(/^СИНТЕТИКА: /,'');
      for(const [j,o] of e.occurrences.entries()) {o.id=`${e.id}:${j}`;o.timezone=zone;o.activeFrom=cityDate(s.scope.start,zone);o.activeThrough=cityDate(new Date(Date.parse(s.scope.end)-1).toISOString(),zone);}
      e.admission.requirements={minimumAge:0,children:'ALLOWED',accompaniedByAdult:'REQUIRED'};
      if(i===0||i===3) e.tariffs=[
        {audience:'ADULT',minAge:null,maxAge:null,kind:'EXACT',amount:200,lowerBound:null,currency:'RUB',applicable:true,conditions:[],evidence:'Взрослый билет 200 ₽'},
        {audience:'CHILD',minAge:0,maxAge:17,kind:'EXACT',amount:100,lowerBound:null,currency:'RUB',applicable:true,conditions:[],evidence:'Детский билет 100 ₽'}];
      if(i===1){e.price={kind:'EXACT',amount:200,lowerBound:null,currency:'RUB',applicability:'SINGLE_ADULT',conditions:[],evidence:'Взрослый билет 200 ₽'};e.admission.requirements.minimumAge=6;}
    }
    return validateSnapshot(s);
  })};
}
