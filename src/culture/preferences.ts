import { cities, cityDate, cityInstant, type CityKey } from '../data/cities.js';

// Единственный словарь предлагаемых тем. Тип события берётся отдельно из фактов.
export const themeLabels = {exhibition:'Выставки',theater:'Театр',concert:'Концерты',workshop:'Занятия',tour:'Экскурсии'} as const;
export const themeLabel=(category:string|null)=>category===null?'Любая тема':themeLabels[category as keyof typeof themeLabels]??'Неизвестная тема';
export function calendarDate(value:string) {
  const n=Date.parse(value+'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;
}
export const nextDate=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().split('T')[0]!;
export function dateProblem(value:string,now:number,city:CityKey):string|null {
  if(!calendarDate(value))return 'Такой календарной даты нет. Формат: ГГГГ-ММ-ДД.';
  if(value<cityDate(new Date(now).toISOString(),cities[city].timezone))return 'Эта дата уже недоступна: дата прошла. Выберите сегодня или будущую дату. Сохранённые прошлые посещения доступны в «Мои события».';
  return null;
}
export function visitWindow(d:{date:string;from:string;until:string;city?:CityKey}) {
  const timezone=cities[d.city??'kzn'].timezone,endDate=d.until<d.from?nextDate(d.date):d.date;
  return {start:cityInstant(d.date,d.from,timezone),end:cityInstant(endDate,d.until,timezone),endDate};
}
export function timeProblem(value:string,date:string,now:number,city:CityKey):string|null {
  if(!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(value)||value.slice(0,5)===value.slice(6))
    return 'Нужен интервал ЧЧ:ММ-ЧЧ:ММ с разными началом и концом. Минуты: 00–59, часы: 00–23.';
  const problem=dateProblem(date,now,city);if(problem)return problem;
  const [from,until]=value.split('-') as [string,string];
  if(until<from&&!calendarDate(nextDate(date)))return 'Дата окончания выходит за формат ГГГГ-ММ-ДД. Выберите окончание в пределах выбранной даты.';
  if(Date.parse(visitWindow({date,from,until,city}).end)<=now)return 'Нужен ещё не закончившийся интервал. Выберите другое время или дату.';
  return null;
}
