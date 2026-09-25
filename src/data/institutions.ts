import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { createHash } from 'node:crypto';
import { type NormalizedEvent, type Venue, type OpeningInterval, type Observation, type Snapshot, validateSnapshot } from './contract.js';
import { sources, type Institution } from './source-policy.js';
import { cities, cityDate, cityInstant, type CityKey } from './cities.js';

type Node = DefaultTreeAdapterMap['node'];
export type Page = {url:string;body:string;fetchedAt:string;hash:string;modified:string|null};
export const extractorVersion='institution-dom/3';
export const bodyHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function nodes(n:Node):Node[] {return [n,...('childNodes' in n?n.childNodes.flatMap(nodes):[])];}
export function attr(n:Node,key:string) {return 'attrs' in n?n.attrs.find(a=>a.name===key)?.value??'':'';}
export function tag(n:Node) {return 'tagName' in n?n.tagName:'';}
export function domText(n:Node):string {
  if(['script','style','svg','noscript','template'].includes(tag(n)))return '';
  if('value' in n)return n.value;
  return ('childNodes' in n?n.childNodes.map(domText).join(''):'')+(['br','p','div','li','tr','h1','h2','h3'].includes(tag(n))?'\n':'');
}
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const txt=(n:Node)=>clean(domText(n));
export const document=(p:Page)=>nodes(parse(p.body));
const cls=(n:Node,c:string)=>attr(n,'class').split(/\s+/).some(v=>v===c||v.includes(c));
const observation=(p:Page,fields:string[],method:'AUTOMATIC_HTML'|'PREPARED_REAL'='AUTOMATIC_HTML'):Observation=>({retrievedAt:p.fetchedAt,requestUrl:p.url,fields,conflicts:[],provenance:{extractor:extractorVersion,contentHash:p.hash,method}});
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const iso=(y:string,m:number,d:string)=>`${y}-${String(m).padStart(2,'0')}-${d.padStart(2,'0')}`;
export function period(s:string):{from:string;through:string}|null {
  const numeric=s.match(/(\d{2})[/.](\d{2})[/.](\d{4})\s*[—–−-]\s*(\d{2})[/.](\d{2})[/.](\d{4})/);
  if(numeric)return {from:iso(numeric[3]!,Number(numeric[2]),numeric[1]!),through:iso(numeric[6]!,Number(numeric[5]),numeric[4]!)};
  const pattern=new RegExp(`(\\d{1,2})\\s*(${months.join('|')})(?:\\s+(20\\d{2}))?\\s*[—–−-]\\s*(\\d{1,2})\\s*(${months.join('|')})\\s+(20\\d{2})`,'i');
  const m=s.toLowerCase().match(pattern);
  return m?{from:iso(m[3]??m[6]!,months.indexOf(m[2]!)+1,m[1]!),through:iso(m[6]!,months.indexOf(m[5]!)+1,m[4]!)}:null;
}
const weekdays:Record<string,number>={пн:1,понедельник:1,вт:2,вторник:2,ср:3,среда:3,чт:4,четверг:4,пт:5,пятница:5,сб:6,суббота:6,вс:0,воскресенье:0};
export function opening(text:string,scopeDate:string):OpeningInterval[]|null {
  // Календарь с явным месяцем нельзя переносить на другой сезон.
  const calendar=text.toLowerCase().match(/(?:в\s+|на\s+)?(январ[ьея]|феврал[ьея]|март[ае]?|апрел[ьея]|ма[йея]|июн[ьея]|июл[ьея]|август[ае]?|сентябр[ьея]|октябр[ьея]|ноябр[ьея]|декабр[ьея])\s+(20\d{2})/);
  if(calendar) {
    const index=months.findIndex(m=>m.slice(0,3)===calendar[1]!.slice(0,3));
    if(calendar[2]!==scopeDate.slice(0,4)||index+1!==Number(scopeDate.slice(5,7)))return null;
    // Даже текущий помесячный режим не подтверждает всё 30-дневное окно.
    return null;
  }
  const result:OpeningInterval[]=[];
  const cutoff=/касса[^\n.]*за\s+(?:30\s+минут|полчаса)/iu.test(text)?30:/касса[^\n.]*за\s+час/iu.test(text)?60:null;
  const re=/(Пн|Понедельник|Вт|Вторник|Ср|Среда|Чт|Четверг|Пт|Пятница|Сб|Суббота|Вс|Воскресенье)(?:\s*([,—–-])\s*(Пн|Понедельник|Вт|Вторник|Ср|Среда|Чт|Четверг|Пт|Пятница|Сб|Суббота|Вс|Воскресенье))?\s*:?\s*(\d{1,2})[.:](\d{2})\s*[—–−-]\s*(\d{1,2})[.:](\d{2})/giu;
  for(const m of text.matchAll(re)) {
    const first=weekdays[m[1]!.toLowerCase()]!,last=m[3]?weekdays[m[3].toLowerCase()]!:first;
    const days=m[2]&&m[2]!==','?Array.from({length:((last-first+7)%7)+1},(_,i)=>(first+i)%7):[...new Set([first,last])];
    const open=Number(m[4])*60+Number(m[5]),close=Number(m[6])*60+Number(m[7]);
    if(close<=open||close>1440)return null;
    for(const weekday of days)result.push({weekday,open,close,lastEntry:null,salesCutoff:cutoff===null?null:close-cutoff});
  }
  return result.length?result:null;
}
export function discover(p:Page,source:Institution):string[] {
  const result:string[]=[];
  for(const n of document(p).filter(n=>tag(n)==='a')) {
    let u:URL;try{u=new URL(attr(n,'href'),p.url);}catch{continue;}
    if(u.origin!==sources[source].origin||u.search||u.hash)continue;
    if(source==='kazan-kremlin'?/^\/(exhibitions|events)\/[^/]+$/.test(u.pathname)
      : /20\d{2}|постоянн.{0,8}экспозици/iu.test(txt(n))&&/^\/[a-z0-9_-]+$/.test(u.pathname))result.push(u.href);
  }
  return [...new Set(result)];
}
type TicketContext = 'INDIVIDUAL'|'GROUP'|'SERVICE'|'PACKAGE'|'CONCESSION'|'UNKNOWN';
function ticketContext(label:string):TicketContext {
  if(/экскурси|обслужив|услуг/iu.test(label))return 'SERVICE';
  if(/организован|групп/iu.test(label))return 'GROUP';
  if(/пакет|комплексн|единый|абонемент/iu.test(label))return 'PACKAGE';
  if(/льгот|школьник|студент|пенсионер/iu.test(label))return 'CONCESSION';
  return /индивидуальн|^Входной билет$|^Взросл(?:ый билет|ые)$/iu.test(label)?'INDIVIDUAL':'UNKNOWN';
}
// Контекст заголовка/секции проверяется до чисел; строка другой услуги не является fallback.
function individualTicketRows(dom:Node[]) {
  const result:string[][]=[];let heading:TicketContext='UNKNOWN',section:TicketContext='UNKNOWN';
  for(const n of dom) {
    if(['h1','h2','h3','h4'].includes(tag(n)))heading=ticketContext(txt(n));
    if(tag(n)==='table')section=heading;
    if(tag(n)==='caption')section=ticketContext(txt(n));
    if(tag(n)!=='tr'||!('childNodes'in n))continue;
    const row=n.childNodes.filter(c=>['td','th'].includes(tag(c))).map(txt);
    const own=ticketContext(row[0]??'');
    if(row.length===1){section=own;continue;}
    if(!['UNKNOWN','INDIVIDUAL'].includes(section))continue;
    if(own==='INDIVIDUAL'||own==='UNKNOWN'&&section==='INDIVIDUAL')result.push(row);
  }
  return result;
}
function individualAmount(value:string):NormalizedEvent['price'] {
  const price:NormalizedEvent['price']={kind:'UNKNOWN',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:[]};
  if(!value)return price;
  const text=clean(value),plain=text.replace(/\s*\(при индивидуальном посещении\)\s*$/iu,'');
  if(/^Бесплатно$/iu.test(plain))Object.assign(price,{kind:'FREE',amount:0,lowerBound:0,currency:'RUB',applicability:'SINGLE_ADULT',evidence:'Бесплатный индивидуальный вход.'});
  else if(/^\d+\s*(?:₽|руб(?:лей|ля|ль)?\.?)$/iu.test(plain)) {
    const amount=Number(plain.match(/\d+/)![0]);Object.assign(price,{kind:'EXACT',amount,lowerBound:amount,currency:'RUB',applicability:'SINGLE_ADULT',evidence:`Обычный входной билет: ${amount} ₽.`});
  }else if(/^от\s+\d+\s*(?:₽|руб(?:лей|ля|ль)?\.?)$/iu.test(plain))Object.assign(price,{kind:'FROM',lowerBound:Number(plain.match(/\d+/)![0]),currency:'RUB',evidence:text});
  else {
    const range=plain.match(/^(\d+)\s*[—–−-]\s*(\d+)\s*(?:₽|руб(?:лей|ля|ль)?\.?)$/iu);
    if(range&&Number(range[1])<=Number(range[2]))Object.assign(price,{kind:'RANGE',lowerBound:Number(range[1]),upperBound:Number(range[2]),currency:'RUB',evidence:text});
    else if(/\d+\s*(?:₽|руб)|бесплатно/iu.test(text))Object.assign(price,{kind:'CONDITIONAL',currency:'RUB',evidence:text,conditions:[text]});
  }
  return price;
}
export function extract(p:Page,source:Institution,scopeDate:string,venuePage?:Page) {
  if(new URL(p.url).origin!==sources[source].origin||bodyHash(p.body)!==p.hash)throw Error('PAGE_PROVENANCE');
  const dom=document(p),all=clean(domText(parse(p.body)));
  const titleNode=source==='kazan-kremlin'?dom.find(n=>tag(n)==='h1'):dom.find(n=>tag(n)==='title');
  let title=titleNode?txt(titleNode):'';
  if(source==='mie')title=title.replace(/\s*\(\d{1,2}\+\)\s*$/,'');
  if(!title||title.length>240)throw Error('TITLE_REVIEW');
  const timing=source==='kazan-kremlin'?dom.filter(n=>tag(n)==='span'&&cls(n,'__time')).map(txt).join(' ')
    :dom.filter(n=>cls(n,'t-cover__wrapper')).map(txt).join(' ');
  const dates=period(timing);
  const permanent=/постоянн.{0,8}экспозици/iu.test(timing+' '+title);
  if(!dates&&!permanent)throw Error('PERIOD_REVIEW');
  const scopeEnd=new Date(Date.parse(scopeDate+'T00:00Z')+30*86400000).toISOString().slice(0,10);
  if(dates&&(dates.through<scopeDate||dates.from>=scopeEnd))throw Error('OUTSIDE_SCOPE');
  const id=`${source}:${new URL(p.url).pathname.split('/').filter(Boolean).at(-1)}`;
  const columns=dom.filter(n=>tag(n)==='li'&&cls(n,'t822__col'));
  const place=columns.find(n=>txt(n).startsWith('Площадка'));
  const venueLink=source==='kazan-kremlin'?dom.find(n=>tag(n)==='a'&&attr(n,'href').startsWith('/museums/')&&nodes(n).some(v=>cls(v,'__museum'))):undefined;
  const info=dom.find(n=>cls(n,'AfishaDetailCard')&&cls(n,'__info'));
  const museum=info?nodes(info).find(n=>tag(n)==='a'&&attr(n,'href').startsWith('/museums/')):venueLink;
  const venueName=source==='mie'?(place?domText(place).split('\n').map(clean).filter(Boolean).find(s=>s!=='Площадка'&&!s.startsWith('ул.'))??null:null):museum?txt(museum):null;
  const address=source==='mie'?(place?txt(place).match(/(?:Вход с\s+)?(?:ул\.|пр\.|проспект|улица)\s*.+$/iu)?.[0]??null:null):null;
  const venueId=`${source}:venue:${source==='mie'?bodyHash((venueName??'')+'|'+(address??'')).slice(0,16):(museum?attr(museum,'href').split('/').at(-1):'unknown-'+bodyHash(p.url).slice(0,12))}`;
  const tables=dom.filter(n=>tag(n)==='tr').map(n=>('childNodes'in n?n.childNodes.filter(c=>['td','th'].includes(tag(c))).map(txt):[]));
  let hours=source==='mie'?columns.filter(n=>/^Время работы/.test(txt(n))).map(domText).join('\n'):tables.filter(t=>/^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)/.test(t[0]??'')).map(t=>t.join(' ')).join('\n');
  if(source==='kazan-kremlin')hours+='\n'+(all.match(/Касса закрывается за \d+ минут[^.]{0,80}/)?.[0]??'');
  let openingPage=p,open=opening(hours,scopeDate);
  const issues:string[]=[];
  if(!open&&venuePage&&source==='mie'&&venueName==='Дом Качки') {
    const venueText=domText(parse(venuePage.body));
    if(/площадка\s*["«]Дом Качки["»]/u.test(venueText)&&venueText.includes(address??'IMPOSSIBLE')) {
      open=opening(venueText.split('Режим работы:')[1]?.split('Билеты')[0]??'',scopeDate);openingPage=venuePage;
      issues.push('Часы страницы выставки не применимы к текущему окну; использован режим её площадки.');
    }
  }
  const price:NormalizedEvent['price']={kind:'UNKNOWN',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:[]};
  const tariffs:NonNullable<NormalizedEvent['tariffs']>=[];
  const admission:NormalizedEvent['admission']={registration:'UNKNOWN',conditions:[],ticketAvailability:'NOT_VERIFIED',requirements:{minimumAge:null,children:'UNKNOWN',accompaniedByAdult:'UNKNOWN'}};
  const applicable=individualTicketRows(dom);
  const priceText=source==='mie'?columns.filter(n=>/^(Касса|Стоимость билетов)/u.test(txt(n))).map(txt).join(' '):applicable.map(t=>t.join(': ')).join('; ');
  const individual=applicable.find(t=>/^Входной билет(?:\s*\(при индивидуальном посещении\))?$/.test(t[0]??''))?.[1]??'';
  if(source==='kazan-kremlin') {
    const adultRow=applicable.find(t=>/^Взросл(?:ые|ый билет)(?:\s*\(при индивидуальном посещении\))?$/.test(t[0]??''));
    const adultPart=individual.split(/[,;]/).find(s=>/^\s*Взрослые\s*[—–-]/u.test(s)&&ticketContext(s)==='UNKNOWN');
    const adultValue=adultRow?.[1]??adultPart?.replace(/^\s*Взрослые\s*[—–-]\s*/u,'');
    Object.assign(price,individualAmount(adultValue??individual));
    if(adultValue&&price.kind==='EXACT')price.evidence=`Взрослый билет: ${price.amount} ₽.`;
  }
  if(source==='mie'?/Вход на выставку свободный/iu.test(priceText):price.kind==='FREE') {
    Object.assign(price,{kind:'FREE',amount:0,lowerBound:0,currency:'RUB',applicability:'SINGLE_ADULT',evidence:'Бесплатный индивидуальный вход.'});
    price.conditions.push(source==='kazan-kremlin'?'Самостоятельное посещение; экскурсия и организованная группа оплачиваются отдельно.':'Указан свободный вход именно на эту выставку.');
    for(const audience of ['ADULT','CHILD'] as const)tariffs.push({audience,minAge:null,maxAge:null,kind:'FREE',amount:0,lowerBound:0,currency:'RUB',applicable:true,conditions:['Индивидуальное посещение.'],evidence:'Бесплатный индивидуальный вход.'});
  } else {
    const range=source==='mie'?priceText.match(/(?:Стоимость билетов:\s*)?(\d+)\s*[—–−-]\s*(\d+)\s*(?:руб|₽)/iu):null;
    if(range) {
      if(Number(range[1])>Number(range[2]))throw Error('PRICE_RANGE_REVIEW');
      Object.assign(price,{kind:'RANGE',lowerBound:Number(range[1]),upperBound:Number(range[2]),currency:'RUB',evidence:`${range[1]}–${range[2]} ₽; категории посетителей не сопоставлены.`,conditions:['Тариф для выбранного состава требует уточнения.']});
    }
  }
  if(source==='kazan-kremlin'&&tables.some(t=>/организованных групп/u.test(t.join(' '))))price.conditions.push('Семья самостоятельно не приравнивается к организованной группе.');
  if(source==='kazan-kremlin')for(const row of tables.filter(t=>/организованных групп|Экскурсионное обслуживание/u.test(t[0]??''))) {
    tariffs.push({audience:'GROUP',minAge:null,maxAge:null,kind:'CONDITIONAL',amount:null,lowerBound:null,currency:'RUB',applicable:false,conditions:[clean(row.join(': ')).slice(0,700)],evidence:'Отдельная услуга; не входит в расчёт самостоятельного посещения.'});
  }
  const childRow=applicable.find(t=>/^Дети до 18 лет \(при индивидуальном посещении\)$/.test(t[0]??''));
  const childPrice=individualAmount(childRow?.[1]??'');
  if(childRow&&['EXACT','FREE'].includes(childPrice.kind)) {
    tariffs.push({audience:'CHILD',minAge:0,maxAge:17,kind:childPrice.kind as 'EXACT'|'FREE',amount:childPrice.amount,lowerBound:childPrice.lowerBound,currency:'RUB',applicable:true,conditions:['Индивидуальное посещение.'],evidence:childPrice.kind==='FREE'?'Дети до 18 лет: бесплатно при индивидуальном посещении.':`Дети до 18 лет: ${childPrice.amount} ₽ при индивидуальном посещении.`});
    admission.requirements!.children='ALLOWED';
  }
  if(/предварительн.{0,12}запис|регистраци.{0,12}обязательн/iu.test(priceText))admission.registration='REQUIRED';
  const matchedVenuePage=source==='mie'&&venuePage&&venueName==='Дом Качки'&&address&&domText(parse(venuePage.body)).includes(address)?venuePage:null;
  const venue:Venue={id:venueId,title:venueName,city:sources[source].city,zone:null,address,sourceUrl:source==='mie'?matchedVenuePage?.url??p.url:museum?new URL(attr(museum,'href'),p.url).href:p.url,
    websiteUrl:null,closed:null,stub:false,physical:venueName?true:null,observations:[observation(p,['location','address','title']),observation(openingPage,['timetable'])],coordinates:null,timetable:null,opening:open};
  const event:NormalizedEvent={id,provider:source,title,city:sources[source].city,categories:['exhibition'],price,tariffs,
    providerAgeLabel:(source==='mie'?all:timing+' '+dom.filter(n=>cls(n,'__age')).map(txt).join(' ')).match(/\b\d{1,2}\+/)?.[0]??null,
    admission,sourceUrl:p.url,sourceLabel:sources[source].label,organizerUrl:null,ticketUrl:null,publicationAt:null,
    providerUpdatedAt:null,retrievedAt:p.fetchedAt,
    observations:[observation(p,['title','dates','location','categories','price','admission','providerAgeLabel']),observation(openingPage,['timetable'])],cancelled:null,
    verification:'EXTRACTED_FACTS',advertisingAssessment:'FACTS_ONLY',occurrences:[{id:id+':visit',venueId,kind:'FLEXIBLE_VISIT',timezone:cities[sources[source].city].timezone,
      start:null,end:null,durationMinutes:null,endBasis:'UNKNOWN',activeFrom:dates?.from??null,activeThrough:dates?.through??null,startless:permanent,endless:permanent,
      opening:open,scheduleBasis:open?'STRUCTURED':'UNKNOWN',metadata:{continuous:false,usePlaceSchedule:true,structuredSchedulePresent:false,equalEndpoints:false,placeholderEnd:false},issues}],issues};
  return {event,venue};
}
export function makeSnapshots(records:ReturnType<typeof extract>[],now:string,freshnessHours=72):Snapshot[] {
  const result:Snapshot[]=[];
  for(const city of ['kzn','ekb'] as CityKey[]) {
    const rows=records.filter(r=>r.event.city===city);if(!rows.length)continue;
    const timezone=cities[city].timezone,start=cityInstant(cityDate(now,timezone),'00:00',timezone),end=new Date(Date.parse(start)+30*86400000).toISOString();
    const events=rows.map(r=>r.event).sort((a,b)=>a.id.localeCompare(b.id)),venues=[...new Map(rows.map(r=>[r.venue.id,r.venue])).values()];
    const retrievedAt=rows.flatMap(r=>[r.event.retrievedAt,...r.event.observations.map(o=>o.retrievedAt),...r.venue.observations.map(o=>o.retrievedAt)]).filter((s):s is string=>s!==null).sort()[0]!;
    result.push(validateSnapshot({version:2,mode:'REAL_CATALOG',scope:{city,timezone,start,end,categories:['exhibition','culture'],zone:null},retrievedAt,freshnessHours,outcome:'PARTIAL',paginationComplete:false,venueCoverageComplete:false,enrichedAt:null,coverage:'PROVIDER_CATALOG_ONLY',publicDisplay:'NOT_CLEARED',issues:['Ограниченный каталог двух учреждений; наличие билетов и отмены не гарантируются.'],stats:{providerCount:null,retrievedRows:events.length,uniqueProviderIds:events.length,duplicateIds:0,pages:new Set(events.map(e=>e.sourceUrl)).size,normalizedEvents:events.length,occurrences:events.reduce((n,e)=>n+e.occurrences.length,0),venues:venues.length,omitted:{}},events,venues}));
  }
  return result;
}

// Только явно датированные сеансы внутри датированного недельного дайджеста.
// Ни часы открытия, ни слово «ежедневно» здесь не размножаются в сеансы.
export function extractKremlinNews(p:Page,now:string):ReturnType<typeof extract>[] {
  const dom=document(p),published=dom.find(n=>tag(n)==='h4'&&/^\d{2}\.\d{2}\.\d{4}$/.test(txt(n)));
  const heading=dom.find(n=>tag(n)==='h1'),week=heading&&txt(heading).match(/(\d{1,2})\s*[—–-]\s*(\d{1,2})\s+([а-я]+)/iu);
  if(!published||!week)throw Error('NEWS_DATE_REVIEW');
  const year=txt(published).slice(-4),month=months.indexOf(week[3]!.toLowerCase())+1;
  if(!month)throw Error('NEWS_DATE_REVIEW');
  let inPrograms=false,venueTitle='';const out:ReturnType<typeof extract>[]=[];
  for(const n of dom) {
    if(tag(n)==='h3'){inPrograms=txt(n)==='Программы в музеях';venueTitle='';}
    if(!inPrograms)continue;
    if(tag(n)==='strong'&&/^(Музей|Центр|Выставочные)/u.test(txt(n)))venueTitle=txt(n);
    if(tag(n)!=='li'||!cls(n,'ListItem')||!venueTitle)continue;
    const text=txt(n),split=text.match(/^(.+?)\s+[—–-]\s+(?=\d{1,2}(?:,|\s))/u);if(!split)continue;
    const title=split[1]!,venueId='kazan-kremlin:venue:'+bodyHash(venueTitle).slice(0,16),id='kazan-kremlin:program-'+bodyHash(venueTitle+'|'+title).slice(0,16);
    const occurrences:NormalizedEvent['occurrences']=[];
    const re=new RegExp(`(\\d{1,2}(?:,\\s*\\d{1,2})*)\\s+${week[3]}\\s+в\\s+(\\d{1,2}:\\d{2}(?:\\s+и\\s+\\d{1,2}:\\d{2})*)`,'giu');
    for(const m of text.slice(split[0].length).matchAll(re))for(const day of m[1]!.split(',').map(Number))for(const time of m[2]!.split(/\s+и\s+/)) {
      if(day<Number(week[1])||day>Number(week[2]))continue;
      const date=iso(year,month,String(day)),start=cityInstant(date,time.padStart(5,'0'),'Europe/Moscow');
      if(Date.parse(start)<Date.parse(now)||Date.parse(start)>=Date.parse(now)+30*86400000)continue;
      occurrences.push({id:id+':'+date.replaceAll('-','')+'T'+time.replace(':',''),venueId,kind:'TIMED_SESSION',timezone:'Europe/Moscow',start,end:null,durationMinutes:null,endBasis:'UNKNOWN',activeFrom:date,activeThrough:date,startless:false,endless:false,opening:null,scheduleBasis:'UNKNOWN',metadata:{continuous:false,usePlaceSchedule:false,structuredSchedulePresent:false,equalEndpoints:false,placeholderEnd:false},issues:['Окончание сеанса и длительность не опубликованы в выбранном источнике.']});
    }
    if(!occurrences.length)continue;
    const event:NormalizedEvent={id,provider:'kazan-kremlin',title,city:'kzn',categories:['culture'],price:{kind:'UNKNOWN',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:[]},providerAgeLabel:null,
      admission:{registration:'REQUIRED',conditions:['В дайджесте указана предварительная запись на программы музеев.'],ticketAvailability:'NOT_VERIFIED'},sourceUrl:p.url,sourceLabel:sources['kazan-kremlin'].label,organizerUrl:null,ticketUrl:null,publicationAt:cityInstant(txt(published).split('.').reverse().join('-'),'00:00','Europe/Moscow'),providerUpdatedAt:null,retrievedAt:p.fetchedAt,
      observations:[observation(p,['title','dates','timetable','location','categories','price','admission'])],cancelled:null,verification:'EXTRACTED_FACTS',advertisingAssessment:'FACTS_ONLY',occurrences,issues:[]};
    const venue:Venue={id:venueId,title:venueTitle,city:'kzn',zone:null,address:null,sourceUrl:p.url,websiteUrl:null,closed:null,stub:false,physical:true,observations:[observation(p,['title','location','address'])],coordinates:null,timetable:null,opening:null};
    out.push({event,venue});
  }
  return out;
}
