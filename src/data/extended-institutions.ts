import { type Page, document, nodes, tag, attr, domText, bodyHash, opening } from './institutions.js';
import { InstitutionClient } from './institution-http.js';
import { sources, type Institution } from './source-policy.js';
import { cityDate, cityInstant, cities } from './cities.js';
import { type NormalizedEvent, type Venue, type Observation, type Occurrence, normalizedEventSchema, venueSchema } from './contract.js';

export const text=(n:ReturnType<typeof document>[number]|undefined)=>n?domText(n).replace(/\s+/g,' ').trim():'';
export const hasClass=(n:ReturnType<typeof document>[number],c:string)=>attr(n,'class').split(/\s+/).includes(c);
export const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export function russianDate(value:string,year?:string) {
  const m=value.toLowerCase().match(/(\d{1,2})\s+([а-я]+)(?:\s+(20\d{2}))?/u);
  if(!m||!months.includes(m[2]!)||!(m[3]??year))return null;
  return `${m[3]??year}-${String(months.indexOf(m[2]!)+1).padStart(2,'0')}-${m[1]!.padStart(2,'0')}`;
}
export const listingUrls={kamal:'https://kamalteatr.ru/poster/',uralopera:'https://uralopera.ru/',sgaf:'https://sgaf.ru/',tatmuseum:'https://tatmuseum.ru/events/'} as const;
export function extendedLinks(p:Page,source:Institution,now:string,horizonDays=30) {
  const dom=document(p),today=cityDate(now,source==='uralopera'||source==='sgaf'?'Asia/Yekaterinburg':'Europe/Moscow');
  const end=new Date(Date.parse(today+'T00:00Z')+horizonDays*86400000).toISOString().slice(0,10);
  const result:string[]=[];
  for(const n of dom) {
    if(source==='kamal'&&hasClass(n,'afisha-card__content')) {
      const d=nodes(n),date=russianDate(text(d.find(n=>hasClass(n,'afisha-card__date'))),today.slice(0,4));
      if(!date||date<today||date>=end)continue;
      const link=d.find(n=>tag(n)==='a'&&hasClass(n,'afisha-card__left-infoblock'));
      if(link)result.push(new URL(attr(link,'href'),p.url).href);
    }
    if(source==='uralopera'&&hasClass(n,'event-calendar__event')) {
      const d=nodes(n),date=attr(d.find(n=>tag(n)==='time')!,'datetime').slice(0,10);
      if(!date||date<today||date>=end)continue;
      const link=d.find(n=>tag(n)==='a'&&hasClass(n,'event-calendar__event-link'));
      if(link)result.push(new URL(attr(link,'href'),p.url).href);
    }
    if(source==='sgaf'&&tag(n)==='a') {const u=new URL(attr(n,'href'),p.url);if(u.origin===sources.sgaf.origin&&/^\/afisha\/\d+$/.test(u.pathname))result.push(u.href);}
    if(source==='tatmuseum'&&tag(n)==='a') {const u=new URL(attr(n,'href'),p.url);if(u.origin===sources.tatmuseum.origin&&/^\/events\/[^/]+\/$/.test(u.pathname)&&/Выставка|Фестиваль|События|Постоянная экспозиция/.test(text(n)))result.push(u.href);}
  }
  return [...new Set(result)];
}
export async function collectExtended(client:InstitutionClient,now:string) {
  const status:Record<string,string>={};
  for(const [source,url] of Object.entries(listingUrls))try {
    if(source==='kamal'){status[source]='EXCLUDED_TERMS_11_2';continue;}
    await client.get(sources[source as Institution].origin+'/robots.txt');
    const listing=await client.get(url),links=extendedLinks(listing,source as Institution,now);
    let failed=0;
    // Only published navigation links; no guessed endpoints or form/API replay.
    const supporting=source==='uralopera'?['/contacts']:source==='sgaf'?['/contacts','/festivals','/terms/purchase','/terms/concertrules']:['/visitors/','/visitors/tickets/','/events/exhibitions/','/events/events/'];
    const frontier=[listing];
    for(const path of supporting) {
      const from=frontier.find(p=>document(p).some(n=>tag(n)==='a'&&new URL(attr(n,'href'),p.url).href===sources[source as Institution].origin+path));
      if(from)try{const p=await client.get(sources[source as Institution].origin+path);frontier.push(p);links.push(...extendedLinks(p,source as Institution,now));}catch{failed++;}
    }
    for(const link of [...new Set(links)].slice(0,70))try{frontier.push(await client.get(link));}catch{failed++;}
    if(source==='sgaf') {
      const festivals=[...new Set(frontier.flatMap(p=>document(p).filter(n=>tag(n)==='a').map(n=>new URL(attr(n,'href'),p.url)).filter(u=>u.origin===sources.sgaf.origin&&/^\/festivals\/\d+$/.test(u.pathname)).map(u=>u.href)))].slice(0,6);
      for(const link of festivals)try{const p=await client.get(link);frontier.push(p);}catch{failed++;}
      const extra=[...new Set(frontier.flatMap(p=>extendedLinks(p,'sgaf',now)))].filter(u=>!links.includes(u)).slice(0,60);
      for(const link of extra)try{await client.get(link);}catch{failed++;}
    }
    status[source]=failed?'PARTIAL':'FETCHED_SELECTED_SCOPE';
  }catch(e){status[source]=e instanceof Error?e.message:'FAILED';}
  return status;
}

type Row={event:NormalizedEvent;venue:Venue};
const observation=(p:Page,fields:string[]):Observation=>({retrievedAt:p.fetchedAt,requestUrl:p.url,fields,conflicts:[],provenance:{extractor:'public-institution-dom/1',contentHash:p.hash,method:'AUTOMATIC_HTML'}});
const field=(dom:ReturnType<typeof document>,cls:string)=>text(dom.find(n=>hasClass(n,cls)));
function row(source:Institution,p:Page,title:string,id:string,venueTitle:string,address:string,categories:string[]):Row {
  const city=sources[source].city,venueId=`${source}:venue:${bodyHash(venueTitle+'|'+address).slice(0,16)}`;
  const event:NormalizedEvent={id:`${source}:${id}`,provider:source,title,city,categories,
    price:{kind:'UNKNOWN',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:[]},tariffs:[],providerAgeLabel:null,
    admission:{registration:'UNKNOWN',conditions:[],ticketAvailability:'NOT_VERIFIED',requirements:{minimumAge:null,children:'UNKNOWN',accompaniedByAdult:'UNKNOWN'}},
    sourceUrl:p.url,sourceLabel:sources[source].label,organizerUrl:null,ticketUrl:null,publicationAt:null,providerUpdatedAt:null,retrievedAt:p.fetchedAt,
    observations:[observation(p,['title','dates','timetable','location','categories','price','admission'])],cancelled:null,verification:'EXTRACTED_FACTS',advertisingAssessment:'FACTS_ONLY',occurrences:[],issues:[]};
  const venue:Venue={id:venueId,title:venueTitle,address,city,zone:null,sourceUrl:p.url,websiteUrl:null,closed:null,stub:false,physical:true,
    observations:[observation(p,['title','address','location'])],coordinates:null,timetable:null,opening:null};
  return {event,venue};
}
function timed(r:Row,p:Page,date:string,time:string,duration:number|null):Occurrence {
  const timezone=cities[r.event.city as 'kzn'|'ekb'].timezone,start=cityInstant(date,time,timezone);
  return {id:`${r.event.id}:${date.replaceAll('-','')}T${time.replace(':','')}`,venueId:r.venue.id,kind:'TIMED_SESSION',timezone,start,
    end:duration?new Date(Date.parse(start)+duration*60000).toISOString():null,durationMinutes:duration,endBasis:duration?'PUBLISHED_DURATION':'UNKNOWN',
    activeFrom:date,activeThrough:date,startless:false,endless:false,opening:null,scheduleBasis:'STRUCTURED',sourceUrl:p.url,
    metadata:{continuous:false,usePlaceSchedule:false,structuredSchedulePresent:true,equalEndpoints:false,placeholderEnd:false},issues:duration?[]:['Окончание сеанса не опубликовано.']};
}
function duration(value:string):number|null {
  const m=value.match(/(?:(\d+)\s*(?:час(?:а|ов)?|ч)\s*)?(?:(\d+)\s*мин(?:ут[аы]?)?)?/iu);
  if(!m||!m[0].trim())return null;
  const n=Number(m[1]??0)*60+Number(m[2]??0);return n>0&&n<=1440?n:null;
}
const inWindow=(date:string,now:string,source:Institution,horizonDays=30)=> {
  const today=cityDate(now,cities[sources[source].city].timezone);
  return date>=today&&date<new Date(Date.parse(today+'T00:00Z')+horizonDays*86400000).toISOString().slice(0,10);
};

export function parseOpera(listing:Page,pages:Page[],now:string,horizonDays=30):Row[] {
  const rows:Row[]=[];
  const contact=pages.find(p=>p.url==='https://uralopera.ru/contacts');
  if(!contact||!text(document(contact)[0]).includes('Екатеринбург, проспект Ленина, 46А'))throw Error('OPERA_VENUE_REVIEW');
  for(const item of document(listing).filter(n=>hasClass(n,'event-calendar__event'))) {
    const dom=nodes(item),when=dom.find(n=>tag(n)==='time'),stamp=when?attr(when,'datetime'):'';
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(stamp)||!inWindow(stamp.slice(0,10),now,'uralopera',horizonDays))continue;
    const a=dom.find(n=>hasClass(n,'event-calendar__event-link')),url=a?new URL(attr(a,'href'),listing.url).href:'';
    const title=field(dom,'event-calendar__event-title-text')||field(dom,'event-calendar__event-title');
    const type=field(dom,'event-calendar__event-type');
    // Talks in cafes/touring venues cannot inherit the theatre's postal address.
    if(!/Опера|Балет|Концерт/u.test(type)||/YOLO|гастрол/iu.test(title))continue;
    const detail=pages.find(p=>p.url===url);if(!detail)throw Error('OPERA_DETAIL_NOT_FETCHED');
    const d=document(detail);
    const id=new URL(url).pathname.split('/').filter(Boolean).at(-1)!;
    const r=row('uralopera',detail,title,id,'Урал Опера Балет','Екатеринбург, проспект Ленина, 46А',[/Концерт/u.test(type)?'concert':'theater']);
    r.event.providerAgeLabel=field(dom,'event-calendar__event-age')||null;
    r.event.observations.push(observation(listing,['dates','title','providerAgeLabel']),observation(contact,['location','address']));
    r.venue.observations=[observation(contact,['location','address'])];r.venue.sourceUrl=contact.url;
    const minutes=duration(field(d,'event-cover__duration'));
    const o=timed(r,detail,stamp.slice(0,10),stamp.slice(11,16),minutes);
    const ticket=dom.find(n=>hasClass(n,'event-calendar__tickets-link'));if(ticket)o.ticketUrl=new URL(attr(ticket,'href'),listing.url).href;
    r.event.occurrences.push(o);r.event.admission.conditions.push('Нужен билет; доступность мест проверяется на сайте театра.');
    rows.push(r);
  }
  return rows;
}

export function parsePhilharmonic(listing:Page,pages:Page[],now:string,horizonDays=30):Row[] {
  const rows:Row[]=[];const main=document(listing);
  const monthYears=[...new Set(main.map(n=>attr(n,'data-date')).filter(v=>/^\d{2}\.20\d{2}$/.test(v)))];
  for(const p of pages.filter(p=>/^https:\/\/sgaf.ru\/afisha\/\d+$/.test(p.url))) {
    const d=document(p),body=d.find(n=>tag(n)==='main'),full=text(body??d[0]);
    const contact=pages.find(p=>p.url==='https://sgaf.ru/contacts');
    const workshop=pages.find(p=>p.url.startsWith('https://sgaf.ru/festivals/87')&&/г\. Екатеринбург, ул\. Первомайская, д\. 24в/iu.test(text(document(p)[0])));
    const blocks=d.filter(n=>hasClass(n,'event-information__item'));
    const venueBlock=blocks.find(n=>/Екатеринбург/u.test(field(nodes(n),'event-information__value')))
      ??(contact&&/Екатеринбург.{0,100}Карла Либкнехта,?\s*38[\s-]*[аa]/iu.test(text(document(contact)[0]))?blocks.find(n=>/^(?:Филармония )?ул\. К\. Либкнехта, 38\s*-?а$/iu.test(field(nodes(n),'event-information__value'))):undefined)
      ??(workshop?blocks.find(n=>/^ул\. Первомайская, 24в$/iu.test(field(nodes(n),'event-information__value'))):undefined);
    if(!venueBlock)continue; // Venue city, never publisher city.
    if(/Билеты\*? можно получить только при покупке|закрытый концерт/iu.test(full))continue;
    const title=text(d.find(n=>tag(n)==='h1')),venueTitle=field(nodes(venueBlock),'event-information__title'),address=field(nodes(venueBlock),'event-information__value');
    const match=full.match(/(\d{1,2})\s+([а-я]+),\s*(\d{2}:\d{2})/iu);if(!match)throw Error('SGAF_DATE_REVIEW');
    const month=String(months.indexOf(match[2]!.toLowerCase())+1).padStart(2,'0');
    const year=monthYears.filter(v=>v.startsWith(month+'.'));
    if(year.length!==1)throw Error('SGAF_YEAR_REVIEW');
    const date=russianDate(match[0],year[0]!.slice(3));if(!date||!inWindow(date,now,'sgaf',horizonDays))continue;
    // Group repeated performances of the same published programme; keep each exact occurrence URL.
    const program=full.split('Программа ')[1]?.split('Участники')[0]??title;
    const id='program-'+bodyHash(title+'|'+venueTitle+'|'+program).slice(0,20);
    const r=row('sgaf',p,title,id,venueTitle,address,[/Экскурсия/u.test(title)?'tour':/Струнные|воркшоп/iu.test(title)?'workshop':'concert']);
    if(contact&&!address.includes('Екатеринбург'))r.venue.observations.push(observation(contact,['location','address']));
    if(workshop&&address.includes('Первомайская'))r.venue.observations=[observation(workshop,['location','address'])];
    const age=full.match(/^(\d{1,2}\+)\s/);r.event.providerAgeLabel=age?.[1]??null;
    const durationBlock=d.filter(n=>hasClass(n,'event-information__item')).find(n=>field(nodes(n),'event-information__value')==='Продолжительность');
    const minutes=duration(durationBlock?field(nodes(durationBlock),'event-information__title'):full.match(/продолжительностью\s+([^.;]{1,35})/iu)?.[1]??'');
    const price=field(d,'event-buy__price'),from=price.match(/^от\s+([\d\s]+)\s*₽$/u);
    if(from)r.event.price={kind:'FROM',amount:null,lowerBound:Number(from[1]!.replace(/\s/g,'')),currency:'RUB',applicability:'UNRESOLVED',evidence:price,conditions:[]};
    if(/1 билет рассчитан на посещение 1 ребенка в сопровождении взрослого/iu.test(full)) {
      r.event.price.kind='CONDITIONAL';r.event.price.conditions.push('Один билет: один ребёнок в сопровождении взрослого. Стоимость для другого состава не вычислена.');
      r.event.admission.conditions.push('Музыкальный воркшоп для детей с сопровождающим взрослым; возрастную группу уточните на странице занятия.');
      r.event.categories=['workshop'];
    }
    r.event.observations.push(observation(listing,['dates']));r.event.occurrences.push(timed(r,p,date,match[3]!,minutes));
    r.event.admission.conditions.push('Покупка билета отдельно; абонемент не считается ценой одного посещения.');
    if(/детей и их родителей/iu.test(full))r.event.issues.push('В программе указана семейная аудитория; детская стоимость требует уточнения.');
    rows.push(r);
  }
  return rows;
}

export function parseTatmuseum(p:Page,pages:Page[],now:string,horizonDays=30):Row|null {
  const d=document(p),title=text(d.find(n=>tag(n)==='h1')),dateText=field(d,'info__date');
  const published=d.filter(n=>hasClass(n,'info__date-small')).map(text).join(' ').match(/20\d{2}/)?.[0];
  const all=text(d[0]),permanent=/Постоянная экспозиция/u.test(dateText);
  if(!/Выставка|Постоянная экспозиция/u.test(dateText))return null;
  const parts=dateText.split(/[—–-]/);const from=russianDate(parts[0]??'',published),through=russianDate(parts[1]??'',published);
  if(!permanent&&(!from||!through))throw Error('TATMUSEUM_YEAR_OR_PERIOD_REVIEW');
  const today=cityDate(now,'Europe/Moscow');
  if(from&&through&&(through<today||from>=new Date(Date.parse(today+'T00:00Z')+horizonDays*86400000).toISOString().slice(0,10)))return null;
  const included=permanent||/по (?:входному )?билету в музей/iu.test(all);
  if(!included&&!/Национальн.{0,12}музе[йя] (?:Республики Татарстан|РТ)/iu.test(all))return null;
  const contact=pages.find(p=>p.url==='https://tatmuseum.ru/visitors/'),tariff=pages.find(p=>p.url==='https://tatmuseum.ru/visitors/tickets/');
  if(!contact||!tariff)throw Error('TATMUSEUM_VENUE_TARIFF_NOT_FETCHED');
  const ct=text(document(contact)[0]),address=ct.match(/Казань, ул\. Кремлевская, 2/)?.[0];if(!address)throw Error('TATMUSEUM_VENUE_REVIEW');
  const r=row('tatmuseum',p,title,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,'Национальный музей Республики Татарстан',address,['exhibition']);
  const hours=ct.split('Режим работы ').at(-1)?.split('Обращения и прием')[0]??'';
  const open=opening(hours,today);
  const tt=text(document(tariff)[0]),primary=tt.split('Национальный музей РТ Входной билет')[1]?.split('Дом-музей')[0]??'';
  if(included&&/600 рублей взрослые/.test(primary)&&/300 рублей c 10.00 до 12.00/.test(primary)&&/500 рублей c 12.00 до 15.00/.test(primary)) {
    r.event.price={kind:'CONDITIONAL',amount:null,lowerBound:300,currency:'RUB',applicability:'UNRESOLVED',evidence:'Взрослый вход: 600 ₽; в рабочие дни 300 ₽ с 10 до 12, 500 ₽ с 12 до 15. Итог для выбранного посещения не вычислен.',conditions:['Скидки зависят от дня и времени входа. Детский тариф не подтверждён.']};
  }
  const age=d.find(n=>hasClass(n,'background-section__age'));r.event.providerAgeLabel=age?text(age):null;
  r.event.observations.push(observation(contact,['location','opening']),observation(tariff,['price','conditions']));
  r.venue.observations=[observation(contact,['location','opening'])];r.venue.sourceUrl=contact.url;r.venue.opening=open;
  const closed=/30 сентября санитарный день/iu.test(all)?[today.slice(0,4)+'-09-30']:[];
  r.event.occurrences=[{id:r.event.id+':visit',venueId:r.venue.id,kind:'FLEXIBLE_VISIT',timezone:'Europe/Moscow',start:null,end:null,durationMinutes:null,endBasis:'UNKNOWN',
    activeFrom:from,activeThrough:through,startless:permanent,endless:permanent,opening:open,scheduleBasis:open?'STRUCTURED':'UNKNOWN',closedDates:closed,
    metadata:{continuous:false,usePlaceSchedule:true,structuredSchedulePresent:false,equalEndpoints:false,placeholderEnd:false},issues:closed.length?['30 сентября музей закрыт на санитарный день по объявлению на сайте.']:[]}];
  return r;
}

export function parseHermitageProgramme(p:Page,now:string,horizonDays=30):Row[] {
  const d=document(p),heading=text(d.find(n=>tag(n)==='h1')),year=heading.match(/Дни Эрмитажа[—–-](20\d{2})/)?.[1];
  if(!year)return [];
  const full=text(d[0]);
  if(!full.includes('Адрес: Музей-заповедник «Казанский Кремль», Центр «Эрмитаж-Казань»'))throw Error('HERMITAGE_PROGRAMME_VENUE');
  const content=full.slice(full.indexOf('23 октября 11:00')).split('Адрес:')[0]!,rows:Row[]=[];
  let date='';
  const tokens=content.matchAll(/(\d{1,2}\s+октября)|((\d{2}:\d{2})\s*[-—–]\s*(.*?))(?=\d{2}:\d{2}\s*[-—–]|\d{1,2}\s+октября|$)/gu);
  for(const m of tokens){if(m[1]){date=russianDate(m[1],year)??'';continue;}
    if(!date||!inWindow(date,now,'kazan-kremlin',horizonDays))continue;
    const description=m[4]!,lecture=description.startsWith('лекция'),family=description.startsWith('премьера программы'),curator=description.startsWith('кураторская');
    const named=description.match(/«([^»]+)»/)?.[1];if(!named)throw Error('HERMITAGE_PROGRAMME_TITLE');
    const title=lecture?`Лекция «${named}»`:family?`Программа для детей и родителей: «${named}»`:`${curator?'Кураторская экскурсия':'Экскурсия'}: «${named}»`;
    const r=row('kazan-kremlin',p,title,'programme-'+bodyHash(title).slice(0,20),'Центр «Эрмитаж-Казань»','Казань, Музей-заповедник «Казанский Кремль», Центр «Эрмитаж-Казань»',[lecture?'education':family?'workshop':'tour']);
    r.event.occurrences.push(timed(r,p,date,m[3]!,null));
    r.event.admission.registration=family?'REQUIRED':'UNKNOWN';
    r.event.admission.conditions=[family?'Участие по регистрации.':lecture?'Лекционный билет или абонемент; отдельная цена не опубликована.':'По входному билету на выставку.'];
    r.event.issues=['В анонсе билеты ещё не были в продаже; наличие не проверено.'];rows.push(r);
  }
  return rows;
}

export function parseExtended(pages:Page[],now:string,horizonDays=30) {
  const rows:Row[]=[],queue:{url:string;reason:string}[]=[];
  for(const p of pages.filter(p=>/^https:\/\/kazan-kremlin.ru\/news\/dni-ermitazha-20\d{2}$/.test(p.url)))try{rows.push(...parseHermitageProgramme(p,now,horizonDays));}catch(e){queue.push({url:p.url,reason:e instanceof Error?e.message:'PARSER_FAILED'});}
  for(const source of ['uralopera','sgaf'] as const) {
    const listing=pages.find(p=>p.url===listingUrls[source]);if(!listing)continue;
    try{rows.push(...(source==='uralopera'?parseOpera(listing,pages,now,horizonDays):parsePhilharmonic(listing,pages,now,horizonDays)));}
    catch(e){queue.push({url:listing.url,reason:e instanceof Error?e.message:'PARSER_FAILED'});}
  }
  for(const p of pages.filter(p=>/^https:\/\/tatmuseum.ru\/events\/[^/]+\/$/.test(p.url)))try{
    const r=parseTatmuseum(p,pages,now,horizonDays);if(r)rows.push(r);
  }catch(e){queue.push({url:p.url,reason:e instanceof Error?e.message:'PARSER_FAILED'});}
  const grouped=new Map<string,Row>();
  for(const r of rows) {
    r.event.occurrences=r.event.occurrences.filter(o=>o.kind!=='TIMED_SESSION'||!!o.start&&Date.parse(o.start)>=Date.parse(now));
    if(!r.event.occurrences.length)continue;
    normalizedEventSchema.parse(r.event);venueSchema.parse(r.venue);
    const old=grouped.get(r.event.id);
    if(!old){grouped.set(r.event.id,r);continue;}
    for(const o of r.event.occurrences)if(!old.event.occurrences.some(v=>v.id===o.id))old.event.occurrences.push(o);
    for(const o of r.event.observations)if(!old.event.observations.some(v=>v.requestUrl===o.requestUrl))old.event.observations.push(o);
    if(JSON.stringify(old.event.price)!==JSON.stringify(r.event.price))old.event.price={kind:'CONFLICT',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:['Стоимость разных показов различается; уточните цену выбранного сеанса.']};
  }
  return {rows:[...grouped.values()],queue};
}
