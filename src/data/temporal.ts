import { z } from 'zod';
import { querySchema, type Query, type Snapshot, type Occurrence } from './contract.js';
import { cities, cityDate, cityInstant } from './cities.js';

export const datePreferenceSchema = z.discriminatedUnion('mode', [
  z.object({mode:z.literal('ANY')}).strict(),
  z.object({mode:z.literal('SPECIFIC'),date:z.string().date()}).strict(),
]);
const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timePreferenceSchema = z.discriminatedUnion('mode', [
  z.object({mode:z.literal('ANY')}).strict(),
  z.object({mode:z.literal('SPECIFIC'),from:hhmm,until:hhmm}).strict().refine(t=>t.from!==t.until),
]);
export type DatePreference=z.infer<typeof datePreferenceSchema>;
export type TimePreference=z.infer<typeof timePreferenceSchema>;
const {start:_start,end:_end,timeMode:_mode,...context}=querySchema.shape;
export const searchQuerySchema=z.object({...context,date:datePreferenceSchema,time:timePreferenceSchema}).strict()
  .refine(q=>q.timezone===undefined||q.timezone===cities[q.city].timezone,'query_timezone')
  .refine(q=>q.version!==2||Boolean(q.party&&q.timezone&&q.budgetBasis==='PARTY_TOTAL'),'query_v2_context')
  .refine(q=>q.budgetBasis==='PARTY_TOTAL'||!q.party||q.party.adults===1&&!q.party.childAges.length,'legacy_budget_basis');
export type SearchQuery=z.infer<typeof searchQuerySchema>;
export const shiftDate=(date:string,days=1)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);

export function dayQuery(q:SearchQuery,date:string):Query {
  const {date:_,time,...base}=q,zone=q.timezone??cities[q.city].timezone;
  return {...base,start:cityInstant(date,time.mode==='ANY'?'00:00':time.from,zone),
    end:cityInstant(time.mode==='ANY'||time.until<time.from?shiftDate(date):date,time.mode==='ANY'?'00:00':time.until,zone),
    ...(time.mode==='ANY'?{timeMode:'ANY' as const}:{})};
}

export function outsideCoverage(q:SearchQuery,s:Snapshot) {
  if(q.date.mode==='ANY')return false;
  if(q.time.mode==='ANY') {
    const zone=q.timezone??cities[q.city].timezone;
    if(q.date.date<cityDate(s.scope.start,zone)||q.date.date>cityDate(new Date(Date.parse(s.scope.end)-1).toISOString(),zone))return true;
  }
  const window=dayQuery(q,q.date.date),start=Date.parse(window.start),end=Date.parse(window.end);
  return q.time.mode==='ANY'?end<=Date.parse(s.scope.start)||start>=Date.parse(s.scope.end)
    :start<Date.parse(s.scope.start)||end>Date.parse(s.scope.end);
}

// Только загруженный каталог. Не строим общий интервал между суточными окнами.
// Для недельного расписания достаточно пройти первый неполный цикл и исключения
// closedDates (в контракте <=40). Далёкий activeFrom перескакиваем сразу.
export function* plannedQueries(q:SearchQuery,s:Snapshot,o:Occurrence|undefined,clock:number):Generator<Query> {
  const zone=q.timezone??cities[q.city].timezone,local=(n:number)=>cityDate(new Date(n).toISOString(),zone);
  const lower=Math.max(clock,Date.parse(s.scope.start)),upper=Date.parse(s.scope.end);
  if(lower>=upper)return;
  const overnight=q.time.mode==='SPECIFIC'&&q.time.until<q.time.from;
  const clipped=(date:string)=>{
    const window=dayQuery(q,date);
    return {...window,start:new Date(Math.max(Date.parse(window.start),Date.parse(s.scope.start))).toISOString(),
      end:new Date(Math.min(Date.parse(window.end),upper)).toISOString()};
  };
  const usable=(date:string)=>{
    const window=clipped(date);
    return Date.parse(window.start)<Date.parse(window.end)&&Date.parse(window.end)>clock?window:null;
  };
  if(q.date.mode==='SPECIFIC') {const window=usable(q.date.date);if(window)yield window;return;}
  if(o?.kind==='TIMED_SESSION'&&o.start) {
    const date=cityDate(o.start,zone);
    for(const anchor of overnight?[shiftDate(date,-1),date]:[date]) {const window=usable(anchor);if(window)yield window;}
    return;
  }
  let first=local(lower);
  if(o?.activeFrom&&o.activeFrom>first)first=o.activeFrom;
  if(overnight)first=shiftDate(first,-1);
  const last=local(upper-1),limit=7*((o?.closedDates?.length??0)+2)+2;
  for(let date=first,i=0;i<limit&&date<=last;date=shiftDate(date),i++) {
    if(o?.activeThrough&&date>o.activeThrough)break;
    const window=usable(date);if(window)yield window;
  }
}
