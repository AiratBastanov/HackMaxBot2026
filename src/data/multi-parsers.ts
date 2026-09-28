import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { attr, tag, domText, bodyHash, period, opening, type Page } from './institutions.js';
import { cities,cityDate,cityInstant,type CityKey } from './cities.js';
import { sources,type Institution } from './source-registry.js';
import { type NormalizedEvent,type Venue,type Occurrence,type Price,type Observation,normalizedEventSchema,venueSchema } from './contract.js';

export type Node=DefaultTreeAdapterMap['node'];
export type Row={event:NormalizedEvent;venue:Venue};
export const walk=(n:Node):Node[]=>[n,...('childNodes'in n?n.childNodes.flatMap(walk):[]),...('content'in n?walk(n.content as Node):[])];
export const dom=(p:Page)=>walk(parse(p.body));
export const text=(n:Node|null|undefined)=>n?domText(n).replace(/\s+/g,' ').trim():'';
export const has=(n:Node,c:string)=>attr(n,'class').split(/\s+/).includes(c);
export const field=(d:Node[],c:string)=>text(d.find(n=>has(n,c)));
export const by=(d:Node[],c:string)=>d.filter(n=>has(n,c));
export const meta=(d:Node[],key:string)=>attr(d.find(n=>attr(n,'itemprop')===key||attr(n,'property')===key||attr(n,'name')===key)??d[0]!,'content');
export const absolute=(href:string,p:Page)=>new URL(href.trim(),p.url).href;
export const months=['январ','феврал','март','апрел','ма','июн','июл','август','сентябр','октябр','ноябр','декабр'];
export function ruDate(value:string,year?:string):string|null {const numeric=value.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|\d{2})\b/);if(numeric)return `${numeric[3]!.length===2?'20':''}${numeric[3]}-${numeric[2]!.padStart(2,'0')}-${numeric[1]!.padStart(2,'0')}`;
 const m=value.toLowerCase().match(/(\d{1,2})\s+([а-яё]+)(?:\s+(20\d{2}))?/u);if(!m)return null;const index=months.findIndex(v=>m[2]!.startsWith(v)),y=m[3]??year;if(index<0||!y)return null;return `${y}-${String(index+1).padStart(2,'0')}-${m[1]!.padStart(2,'0')}`;}
export function minutes(value:string):number|null {const m=value.match(/(\d+)\s*(?:час(?:а|ов)?|ч\.?)\s*(?:(\d+)\s*мин(?:ут[аы]?)?)?/iu),n=m?Number(m[1])*60+Number(m[2]??0):Number(value.match(/(\d+)\s*мин(?:ут[аы]?)?/iu)?.[1]??0);return n>0&&n<=1440?n:null;}
export const unknownPrice=():Price=>({kind:'UNKNOWN',amount:null,lowerBound:null,currency:null,applicability:'UNRESOLVED',evidence:null,conditions:[]});
// Входная строка должна быть отдельным полем тарифа, не всей страницей/абонементом.
export function factualPrice(value:string):Price {const t=value.replace(/\u00a0/g,' ').trim();if(!t)return unknownPrice();
 if(/абонемент|пакет|семейн|групп|экскурсионн|сопровожд/iu.test(t))return {...unknownPrice(),kind:'CONDITIONAL',evidence:t.slice(0,300),conditions:['Цена услуги или пакета; итог для выбранного состава не установлен.']};
 if(/^(?:вход|участие)?\s*(?:свободный|свободное|бесплатно|бесплатный)\.?$/iu.test(t))return {kind:'FREE',amount:0,lowerBound:0,currency:'RUB',applicability:'SINGLE_ADULT',evidence:t,conditions:[]};
 const m=t.match(/^(от\s+)?([\d ]+)(?:\s*[–—-]\s*([\d ]+))?\s*(?:₽|руб\.?|р\.)(?:\s|$)/iu);if(!m)return unknownPrice();const low=Number(m[2]!.replace(/\s/g,'')),high=m[3]?Number(m[3].replace(/\s/g,'')):null;if(!Number.isFinite(low)||low<0||high!==null&&high<low)return unknownPrice();
 return {kind:m[1]?'FROM':high!==null&&high!==low?'RANGE':'EXACT',amount:!m[1]&&(high===null||high===low)?low:null,lowerBound:low,...(high!==null?{upperBound:high}:{}),currency:'RUB',applicability:'SINGLE_ADULT',evidence:t.slice(0,200),conditions:[]};}
export const obs=(p:Page,fields=['title','dates','timetable','location','address','price','categories','admission']):Observation=>({retrievedAt:p.fetchedAt,requestUrl:p.url,fields,conflicts:[],provenance:{extractor:'multi-institution/1',contentHash:p.hash,method:'AUTOMATIC_HTML'}});
export function makeRow(source:Institution,p:Page,id:string,title:string,venueTitle:string,address:string|null,categories:string[]):Row {
 const city=sources[source].city,venueId=`${source}:venue:${bodyHash(venueTitle+'|'+address).slice(0,16)}`;
 return {event:{id:`${source}:${id}`,provider:source,title,city,categories,price:unknownPrice(),tariffs:[],providerAgeLabel:null,
  admission:{registration:'UNKNOWN',conditions:[],requirements:{minimumAge:null,children:'UNKNOWN',accompaniedByAdult:'UNKNOWN'},ticketAvailability:'NOT_VERIFIED'},
  sourceUrl:p.url,sourceLabel:sources[source].label,organizerUrl:null,ticketUrl:null,publicationAt:null,providerUpdatedAt:null,retrievedAt:p.fetchedAt,observations:[obs(p)],
  cancelled:null,verification:'EXTRACTED_FACTS',advertisingAssessment:'FACTS_ONLY',occurrences:[],issues:[]},
  venue:{id:venueId,title:venueTitle,city,zone:null,address,sourceUrl:p.url,websiteUrl:null,closed:null,stub:false,physical:true,observations:[obs(p,['title','location','address'])],coordinates:null,timetable:null,opening:null}};
}
export function session(r:Row,p:Page,date:string,time:string,duration:number|null,sourceId?:string):Occurrence {const timezone=cities[r.event.city as CityKey].timezone,start=cityInstant(date,time,timezone);return {id:r.event.id+':'+(sourceId??date.replaceAll('-','')+'T'+time.replace(':','')),venueId:r.venue.id,kind:'TIMED_SESSION',timezone,start,end:duration?new Date(Date.parse(start)+duration*60000).toISOString():null,durationMinutes:duration,endBasis:duration?'PUBLISHED_DURATION':'UNKNOWN',activeFrom:date,activeThrough:date,startless:false,endless:false,opening:null,scheduleBasis:'STRUCTURED',sourceUrl:p.url,
  metadata:{continuous:false,usePlaceSchedule:false,structuredSchedulePresent:true,equalEndpoints:false,placeholderEnd:false},issues:duration?[]:['Окончание сеанса не опубликовано.']};}
export function inScope(start:string,now:string,city:CityKey){const zone=cities[city].timezone,lower=Date.parse(now),upper=Date.parse(cityInstant(cityDate(now,zone),'00:00',zone))+60*86400000;return Date.parse(start)>=lower&&Date.parse(start)<upper;}
export function category(value:string):string[]{return /экскурс/iu.test(value)?['tour']:/лекци|дискус|чтени|клуб|встреч/iu.test(value)?['education']:/мастер|воркшоп/iu.test(value)?['workshop']:/выстав|экспозици/iu.test(value)?['exhibition']:/балет|опера|спектакль|оперетт/iu.test(value)?['theater']:['concert'];}
function contact(r:Row,p:Page,address:string,marker:string){if(!text(dom(p)[0]).includes(marker))throw Error('VENUE_EVIDENCE_CHANGED');r.venue.address=address;r.venue.sourceUrl=p.url;r.venue.observations.push(obs(p,['location','address']));}

export function parseNovat(p:Page):Row|null {
 const d=dom(p),scope=d.find(n=>attr(n,'itemtype').endsWith('/TheaterEvent'));if(!scope)return null;const s=walk(scope),name=s.filter(n=>attr(n,'itemprop')==='name').at(-1),title=name?attr(name,'content'):'';
 const start=meta(s,'startDate'),address=meta(s,'address'),hall=field(d,'text_room')||'НОВАТ';if(!title||!start||!address.includes('Новосибирск'))return null;
 // Кредиты постановки и её опубликованная премьера отличают одноимённые версии.
 const creators=field(d,'directors'),premiere=field(d,'desc_play__short'),identity=creators?bodyHash(title+'|'+hall+'|'+creators+'|'+premiere).slice(0,24):new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!;
 const r=makeRow('novat',p,'production-'+identity,title,hall,address,category(meta(d,'og:title')+' '+premiere+' '+field(d,'desc_play__information')));
 r.event.providerAgeLabel=field(d,'age-limit')||null;const duration=minutes(field(d,'desc_play__information'));
 const local=new Date(Date.parse(start)+7*3600000).toISOString();r.event.occurrences=[session(r,p,local.slice(0,10),local.slice(11,16),duration,new URL(p.url).pathname.split('/').filter(Boolean).at(-1))];
 r.event.admission.conditions=['Билет приобретается отдельно на сайте театра.'];return r;
}
export function parseSpbPhil(p:Page,pages:Map<string,Page>,seen=new Set<string>()):Row|null {
 if(seen.has(p.url))throw Error('TRANSFER_CYCLE');seen.add(p.url);const d=dom(p),transfer=d.find(n=>has(n,'afisha_element_transfer_to_info'));
 if(transfer){const target=pages.get(absolute(attr(transfer,'href'),p));if(!target)throw Error('TRANSFER_TARGET_NOT_FETCHED');const r=parseSpbPhil(target,pages,seen);if(r){r.event.observations.push(obs(p,['dates','admission']));r.event.admission.conditions.push(text(transfer));}return r;}
 const date=ruDate(field(d,'event_date')),dateBlock=d.find(n=>has(n,'event_date')),parent=dateBlock&&'parentNode'in dateBlock?dateBlock.parentNode:null,time=text(parent??undefined).match(/\b\d{2}:\d{2}\b/)?.[0]??'',titleBlock=d.find(n=>has(n,'afisha_element_title')),titleNode=titleBlock&&walk(titleBlock).find(n=>tag(n)==='h2'),title=text(titleNode).replace(/\s*\d{1,2}\+\s*$/,'');
 if(!date||!/^\d{2}:\d{2}$/.test(time)||!title)return null;const full=text(d[0]);
 const hall=/afisha_element_image_zal346/.test(p.body)?'Большой зал':/afisha_element_image_zal347/.test(p.body)?'Малый зал':/Музиторий/iu.test(field(d,'event_date'))?'Музиторий':null;if(!hall)return null;
 const r=makeRow('spb-philharmonia',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,title,hall,null,category(title));
 const address=pages.get('https://www.philharmonia.spb.ru/about/roadmap/');if(!address)throw Error('VENUE_NOT_FETCHED');contact(r,address,hall==='Малый зал'?'Санкт-Петербург, Невский проспект, 30':'Санкт-Петербург, Михайловская улица, 2',hall==='Малый зал'?'Невский пр., 30':'Михайловская ул., 2');
 r.event.price=factualPrice(field(d,'it-buy-prices'));r.event.providerAgeLabel=field(d,'afisha_element_age')||null;
 const programme=field(d,'ae_music'),performers=field(d,'ae_persons'),sourceId=new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!;
 if(programme&&performers||r.event.categories.includes('tour'))r.event.id='spb-philharmonia:programme-'+bodyHash(title+'|'+hall+'|'+programme+'|'+performers).slice(0,24);
 r.event.occurrences=[session(r,p,date,time,minutes(field(d,'afisha_element_duration')),sourceId)];
 if(/концерт отмен[её]н|мероприятие отменено/iu.test(full))r.event.cancelled=true;
 if(/Билеты проданы|билетов нет/iu.test(field(d,'it-buy'))){r.event.occurrences[0]!.availability='OBSERVED_SOLD_OUT';r.event.issues.push('В момент получения страницы билеты отсутствовали.');}return r;
}
export function parseKrasfil(p:Page,pages=new Map<string,Page>()):Row|null {const d=dom(p),items=by(d,'concert-info__item'),dateItem=items.find(n=>walk(n).some(a=>attr(a,'href').startsWith('/events?date='))),dateLink=dateItem&&walk(dateItem).find(a=>attr(a,'href').startsWith('/events?date='));
 const date=dateLink?new URL(attr(dateLink,'href'),p.url).searchParams.get('date'):null,time=text(dateItem).match(/\d{2}:\d{2}/)?.[0];
 const venue=text(items.find(n=>walk(n).some(a=>attr(a,'href').startsWith('/events?city'))));if(!date||!time||!venue.includes('Красноярск'))return null;
 const poster=d.find(n=>has(n,'card-poster')),primary=poster?walk(poster):[],image=primary.map(n=>attr(n,'src')).find(v=>/\/uploads\/afisha_show\/\d+\//.test(v)),showId=image?.match(/\/afisha_show\/(\d+)\//)?.[1],title=text(primary.find(n=>tag(n)==='h1'));
 if(!title)return null;const r=makeRow('krasfil',p,showId?'show-'+showId:'event-'+new URL(p.url).pathname.split('/').at(-1),title,venue,null,category(title));
 const venuePath=/Органный/iu.test(venue)?'/organnyj-zal':/Малый/iu.test(venue)?'/malyj-zal':/Камерный/iu.test(venue)?'/kamernyj-zal':/торжеств/iu.test(venue)?'/zal-torzestv':/Большой/iu.test(venue)?'/bolsoj-zal':null;
 const vp=venuePath?pages.get(sources.krasfil.origin+venuePath):null;if(vp){const content=text(dom(vp).find(n=>tag(n)==='main')),address=content.match(/((?:ул\.|пр\.)\s*(?:Мира|Декабристов),\s*\d+[А-Яа-яA-Za-z]?)/u)?.[1];if(address){r.venue.address='Красноярск, '+address;r.venue.observations.push(obs(vp,['address','location']));}}
 r.event.price=factualPrice(text(items.find(n=>/₽/u.test(text(n)))));r.event.providerAgeLabel=text(items.find(n=>/^\d{1,2}\+$/.test(text(n))))||null;
 const duration=minutes(text(items.find(n=>walk(n).some(a=>attr(a,'href').includes('icon-clock')))));r.event.occurrences=[session(r,p,date,time,duration,new URL(p.url).pathname.split('/').at(-1))];
 if(/Билетов нет/.test(field(d,'card-poster__body-btn'))){r.event.occurrences[0]!.availability='OBSERVED_SOLD_OUT';r.event.issues.push('В момент получения страницы билетов нет; доступность требует повторной проверки.');}return r;
}
export function parseBashopera(p:Page,pages:Map<string,Page>):Row[]{const d=dom(p),rows:Row[]=[],year=text(d[0]).match(/©\s*(20\d{2})\s+Башкирский/)?.[1];if(!year)return rows;
 for(const item of d.filter(n=>has(n,'item')&&has(n,'content'))){const ns=walk(item),link=by(ns,'name')[0],a=link&&walk(link).find(n=>tag(n)==='a'),url=a?absolute(attr(a,'href'),p):'',date=ruDate(field(ns,'date'),year),hall=field(ns,'hall'),time=hall.match(/\d{2}:\d{2}/)?.[0];if(!url||!date||!time||!/Большой зал|Малый зал/.test(hall))continue;
  const detail=pages.get(url);const r=makeRow('bashopera',detail??p,'production-'+new URL(url).pathname.split('/').filter(Boolean).at(-1),text(a),hall.split(',')[0]!,null,/\/(opera|ballet|operetta)\//.test(url)?['theater']:category(text(item)));r.event.sourceUrl=url;
  const address=pages.get('https://bashopera.ru/about/contacts/');if(!address)throw Error('VENUE_NOT_FETCHED');contact(r,address,'Уфа, улица Ленина, 5/1','г. Уфа, ул. Ленина, 5/1');
  r.event.providerAgeLabel=field(ns,'tags').match(/\d{1,2}\+/)?.[0]??null;r.event.observations.push(obs(p));const info=detail?text(dom(detail)[0]):'';const dm=info.match(/(?:Продолжительность|Длительность)\s*:?\s*([^.;]{1,65})/iu);
  r.event.occurrences=[session(r,p,date,time,minutes(dm?.[1]??''),attr(item,'id').split('_').at(-1))];r.event.occurrences[0]!.sourceUrl=url;rows.push(r);
 }return rows;}

export function parseSamaraOpera(p:Page,pages:Map<string,Page>):Row[]{const d=dom(p),rows:Row[]=[],years=new Map<string,string>();for(const a of d.filter(n=>tag(n)==='a')){const m=text(a).match(/^(\p{L}+)\s+(20\d{2})\s*\(/u);if(m)years.set(m[1]!.slice(0,3).toLowerCase(),m[2]!);}
 for(const node of d.filter(n=>has(n,'dateBox'))){const parent='parentNode'in node?node.parentNode:null;if(!parent)continue;const ns=walk(parent),dateText=field(ns,'date'),mon=dateText.match(/[а-я]+/iu)?.[0]?.slice(0,3).toLowerCase(),date=ruDate(dateText,years.get(mon??'')),time=field(ns,'time').match(/\d{2}:\d{2}/)?.[0];
  const nameNode=ns.find(n=>has(n,'name')),a=nameNode&&walk(nameNode).find(n=>tag(n)==='a')||ns.find(n=>tag(n)==='a'&&/\/(?:concert|ballet|opera)\d+\.html$/.test(attr(n,'href'))),url=a?absolute(attr(a,'href'),p):'';if(!date||!time||!url)continue;
  const title=text(nameNode).replace(/^(?:Малая сцена|Большая сцена)\s*/,'');if(!title)continue;const r=makeRow('samara-opera',pages.get(url)??p,new URL(url).pathname.replace(/[^a-zA-Z0-9]/g,'-'),title,field(ns,'small')||(/Малая сцена/.test(text(parent))?'Малая сцена':'Самарский театр оперы и балета'),null,category(url+' '+text(parent)));r.event.sourceUrl=url;
  const cp=pages.get('https://opera-samara.ru/Kontaktnaya_informatsiya/');if(!cp)throw Error('VENUE_NOT_FETCHED');contact(r,cp,'Самара, площадь Куйбышева, 1','площадь Куйбышева, д. 1');
  const times=text(parent).match(/\b\d{2}:\d{2}\b/g)??[],duration=times[1]?Number(times[1].slice(0,2))*60+Number(times[1].slice(3)):null;r.event.providerAgeLabel=text(parent).match(/\b\d{1,2}\+/)?.[0]??null;
  r.event.observations.push(obs(p));r.event.occurrences=[session(r,p,date,time,duration)];r.event.occurrences[0]!.sourceUrl=url;rows.push(r);
 }return rows;}

// Nuxt devalue: читаем JSON-ссылки; никаких eval, функций, HTML или внешних сущностей.
export function nuxtData(p:Page):any {const n=dom(p).find(n=>tag(n)==='script'&&attr(n,'type')==='application/json');if(!n||!('childNodes'in n))return null;const a=JSON.parse(n.childNodes.map(n=>'value'in n?n.value:'').join(''));if(!Array.isArray(a)||a.length>100000)throw Error('EMBEDDED_JSON_LIMIT');const cache=new Map<number,unknown>();
 function dec(i:number,depth=0):any {if(depth>150)throw Error('EMBEDDED_JSON_DEPTH');if(i<0)return null;if(cache.has(i))return cache.get(i);const v=a[i];if(!v||typeof v!=='object')return v;
  if(Array.isArray(v)&&typeof v[0]==='string'){if(!['ShallowReactive','Reactive','Ref','ShallowRef'].includes(v[0]))return null;return dec(v[1],depth+1);}
  const out:any=Array.isArray(v)?[]:Object.create(null);cache.set(i,out);for(const[k,n]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))continue;out[k]=dec(n as number,depth+1);}return out;}return dec(0);
}

export function operaData(p:Page):any {if(p.body.trimStart().startsWith('{'))return JSON.parse(p.body);const data=nuxtData(p);return Object.entries(data?.data??{}).find(([k])=>k.startsWith('page-'))?.[1];}
export function parseOperaNNFull(p:Page,pages:Map<string,Page>):Row[]{const value=operaData(p),entries=Array.isArray(value?.data)?value.data.flatMap((m:any)=>m.childs??[]):value?.data?.bundle==='performance_showbill'?[value.data]:[],rows:Row[]=[];
 for(const item of entries){const url=new URL(item.url,sources.operann.origin).href,detail=pages.get(url),e=detail?operaData(detail)?.data??item:item,stamp=e.date?.[0]?.value,hall=e.field_hall?.[0],address=hall?.field_address?.[0];if(!stamp||!address?.includes('Нижний Новгород')||!e.title)continue;
  const parent=e.field_parent_performance?.[0],id=parent?.id&&!parent.url?.includes('/festival/')?'production-'+parent.id:'showbill-'+e.id;const r=makeRow('operann',detail??p,id,e.title,hall.name,address,category(e.field_genre?.[0]?.markup??''));r.event.sourceUrl=url;
  if(detail)r.event.observations.push(obs(p));r.event.providerAgeLabel=e.field_age_category?.[0]?.markup??null;
  const local=new Date(Date.parse(stamp)+3*3600000).toISOString();r.event.occurrences=[session(r,detail??p,local.slice(0,10),local.slice(11,16),minutes(e.durtion?.[0]??''),e.id)];r.event.occurrences[0]!.sourceUrl=url;
  const card=dom(p).find(n=>tag(n)==='article'&&walk(n).some(a=>tag(a)==='a'&&attr(a,'href')===item.url));
  if(card&&text(card).includes('Билеты распроданы')){const missing=walk(card).some(n=>attr(n,'href').includes('/buy/undefined'));r.event.occurrences[0]!.availability=missing?'UNRESOLVED_SOURCE_STATUS':'OBSERVED_SOLD_OUT';r.event.admission.conditions.push(missing?'В исходном HTML: «Билеты распроданы» и незаполненная ссылка покупки. Статус не подтверждён.':'В исходной карточке билеты отмечены распроданными.');}
  r.event.admission.conditions.push('Покупка билета и его наличие проверяются отдельно у театра.');rows.push(r);
 }return rows;}

export function exhibition(r:Row,p:Page,from:string|null,through:string|null,hours:Venue['opening'],permanent=false):Occurrence {return {id:r.event.id+':visit',venueId:r.venue.id,kind:'FLEXIBLE_VISIT',timezone:cities[r.event.city as CityKey].timezone,start:null,end:null,durationMinutes:null,endBasis:'UNKNOWN',activeFrom:from,activeThrough:through,startless:permanent,endless:permanent,opening:hours,scheduleBasis:hours?'PLACE_TIMETABLE':'UNKNOWN',sourceUrl:p.url,metadata:{continuous:false,usePlaceSchedule:!!hours,structuredSchedulePresent:!!hours,equalEndpoints:false,placeholderEnd:false},issues:hours?[]:['Часы посещения не установлены.']};}

export function parseMeloman(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),block=d.find(n=>has(n,'article-season-detail'));if(!block)return null;const ns=walk(block),times=ns.filter(n=>tag(n)==='time'),t=times.find(n=>/^\d{2}\.\d{2}\.20\d{2}/.test(attr(n,'datetime'))),stamp=t?attr(t,'datetime'):'',date=ruDate(stamp),time=stamp.match(/\d{2}:\d{2}/)?.[0],hall=ns.find(n=>tag(n)==='a'&&attr(n,'href').trim().startsWith('/hall/'));
 if(!date||!time||!hall||!text(hall))return null;const title=text(d.find(n=>tag(n)==='h1'));if(!title)return null;
 const r=makeRow('meloman',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,title,text(hall),null,category(title));
 const venuePage=pages.get(absolute(attr(hall,'href'),p));if(venuePage){const vd=dom(venuePage),address=field(vd,'grid-hall-contacts').match(/^Адрес:\s*(.+?)\s+(?:Время работы|Ближайшие)/u)?.[1];if(address&&!/Виртуальн|кинотеатр/iu.test(text(hall))){r.venue.address='Москва, '+address;r.venue.observations.push(obs(venuePage,['address','location']));}}
 r.event.providerAgeLabel=text(ns.find(n=>/^\d{1,2}\+$/.test(text(n))))||null;r.event.occurrences=[session(r,p,date,time,minutes(field(ns,'article-season-detail__duration')))];
 r.event.issues.push('Цены отдельных билетов и детские тарифы на полученной странице не опубликованы.');return r;}

export function interfaceHTML(p:Page):Page {if(!p.body.trimStart().startsWith('{'))return p;const value=JSON.parse(p.body);const html=typeof value.data==='string'?value.data:typeof value.text==='string'?value.text:typeof value.content==='string'?value.content:typeof value.js?.html==='string'?value.js.html:null;return html===null?p:{...p,body:html};}
export function parseMelomanList(raw:Page,pages:Map<string,Page>):Row[]{const p=interfaceHTML(raw),rows:Row[]=[];
 const hallPages=new Map([...pages.values()].filter(q=>q.url.startsWith(sources.meloman.origin+'/hall/')).map(q=>[text(dom(q).find(n=>tag(n)==='h1')),q]));
 for(const card of by(dom(p),'article-ticket')){const ns=walk(card),link=ns.find(n=>tag(n)==='a'&&attr(n,'href').trim().startsWith('/concert/')&&text(n)),toolbar=ns.find(n=>has(n,'article-ticket__toolbar')),hallTitle=toolbar?field(walk(toolbar),'editor'):'',stamp=attr(ns.find(n=>tag(n)==='time')??card,'datetime'),date=ruDate(stamp),time=stamp.match(/\d{2}:\d{2}/)?.[0];if(!link||!hallTitle||!date||!time)continue;
  const vp=hallPages.get(hallTitle.replace(/^Ф2\.\s*/,''));if(!vp)continue;
  const url=absolute(attr(link,'href'),p),dateInUrl=url.match(/(20\d{2}-\d{2}-\d{2})/)?.[1];if(dateInUrl&&date!==dateInUrl)continue;
  const heading=walk(link).find(n=>['h2','h3','h4'].includes(tag(n))||tag(n)==='b'&&has(n,'uppercase'))??walk(link).find(n=>tag(n)==='p'),title=text(heading??link).split(' В программе:')[0]!.trim(),editor=text(link),identity=bodyHash(title+'|'+vp.url+'|'+editor).slice(0,24);
  const r=makeRow('meloman',raw,'programme-'+identity,title,hallTitle,null,category(title));r.event.sourceUrl=url;
  const address=field(dom(vp),'grid-hall-contacts').match(/^Адрес:\s*(.+?)\s+(?:Время работы|Ближайшие)/u)?.[1];if(address){r.venue.address='Москва, '+address;r.venue.observations.push(obs(vp,['address','location']));}
  if(/виртуальн|кинотеатр/iu.test(hallTitle))continue;
  const detail=pages.get(url),detailRow=detail?parseMeloman(detail,pages):null;
  r.event.providerAgeLabel=detailRow?.event.providerAgeLabel??null;r.event.occurrences=[session(r,raw,date,time,detailRow?.event.occurrences[0]?.durationMinutes??null,new URL(url).pathname.split('/').filter(Boolean).at(-1))];r.event.occurrences[0]!.sourceUrl=url;
  if(detail){r.event.observations.push(obs(detail));if(detailRow?.event.title)r.event.title=detailRow.event.title;}
  if(/Билеты проданы|Билетов нет/iu.test(field(ns,'article-ticket__controls')))r.event.occurrences[0]!.availability='OBSERVED_SOLD_OUT';
  rows.push(r);
 }return rows;}

export function parseNNArt(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),title=field(d,'nghm_content_block__title'),dateText=field(d,'nghm_content_block__date'),dates=period(dateText),permanent=/Постоянная экспозиция/iu.test(dateText+' '+field(d,'nghm_content_block__tag'));if(!title||!dates&&!permanent)return null;
 // Площадка берётся только из карточки с точной ссылкой на эту выставку.
 let card:Node|undefined;for(const q of [p,...[...pages.values()].filter(q=>q.url.startsWith(sources['nn-art'].origin))]){const dd=dom(q);card=dd.find(n=>has(n,'nghm_vm_block_item')&&walk(n).some(a=>tag(a)==='a'&&absolute(attr(a,'href')||'#',q)===p.url));if(card)break;}
 if(!card)return null;const c=walk(card),venue=field(c,'nghm_vm_block_item_location_name'),address=field(c,'nghm_vm_block_item_location').slice(venue.length).trim();if(!address)return null;
 const r=makeRow('nn-art',p,new URL(p.url).pathname.replace(/[^a-z0-9]/g,'-'),title,venue||'Нижегородский художественный музей','Нижний Новгород, '+address,['exhibition']);
 const full=text(d[0]),schedule=full.split('График работы НГХМ')[1]?.split('РУССКОЕ ИСКУССТВО')[0]??'',hours=opening(schedule.replace(/\s+(?:—\s*)?с\s+(?=\d{1,2}[.:]\d{2})/g,' ').replace(/(\d{2}[.:]\d{2})\s+до\s+/g,'$1–'),cityDate(p.fetchedAt,cities.nnv.timezone));r.venue.opening=hours;r.venue.observations.push(obs(p,['timetable']));r.event.providerAgeLabel=field(d,'nghm_content_block__age')||null;
 r.event.occurrences=[exhibition(r,p,dates?.from??null,dates?.through??null,hours,permanent)];return r;}

export function parseSpbLibrary(p:Page,confirmedDates:string[]):Row|null {const d=dom(p),title=text(d.find(n=>tag(n)==='h1')),full=text(d[0]),facts=full.match(/Информация\s+Адрес:\s*(.+?)\s+Дата:\s*(.+?)\s+Ограничение по возрасту:\s*(\d{1,2}\+)/u);if(!title||!facts||!confirmedDates.length)return null;
 const dateText=facts[2]!,times=dateText.match(/\d{1,2}:\d{2}/g)??[],clock=(v:string)=>Number(v.split(':')[0])*60+Number(v.split(':')[1]);if(!times.length)return null;
 const date=ruDate(dateText,confirmedDates[0]!.slice(0,4)),r=makeRow('spb-library',p,new URL(p.url).searchParams.get('ELEMENT_ID')!,title,'Библиотека имени В. В. Маяковского','Санкт-Петербург, '+facts[1],category(title));r.event.providerAgeLabel=facts[3]!;
 const description=full.slice(full.lastIndexOf(title,full.indexOf('Информация Адрес:'))+title.length,full.indexOf('Информация Адрес:'));
 if(/Вход\s+(?:свободный|бесплатный)/iu.test(description))r.event.price=factualPrice('Вход свободный');
 if(/(?:необходима|обязательна|по предварительной)\s+регистраци|Регистрация в группе/iu.test(full)){r.event.admission.registration='REQUIRED';r.event.admission.conditions.push('Требуется самостоятельная регистрация у библиотеки.');}
 if(!date)return null;
 if(/\d{1,2}\s+[а-я]+\s*[—–-]/iu.test(dateText)){const end=ruDate(dateText.replace(/^.*?[—–-]\s*/,''),confirmedDates.at(-1)!.slice(0,4));if(!end||times.length<2)return null;
  // Явный интервал выставки не превращаем в ежедневное время работы.
  r.event.occurrences=[exhibition(r,p,date,end,null)];
 }else {if(!confirmedDates.includes(date))return null;const duration=times[1]&&clock(times[1])>clock(times[0]!)?clock(times[1])-clock(times[0]!):null;r.event.occurrences=[session(r,p,date,times[0]!.padStart(5,'0'),duration)];}
 if(/клуб/iu.test(title)&&description.length>40){const sessionId=r.event.id.split(':')[1];r.event.id='spb-library:programme-'+bodyHash(title+'|'+facts[1]+'|'+description).slice(0,24);r.event.occurrences.forEach(o=>o.id=r.event.id+':'+sessionId);}
 return r;}

export function validateRows(rows:Row[],now:string){return rows.filter(r=>{const today=cityDate(now,cities[r.event.city as CityKey].timezone),end=new Date(Date.parse(today+'T00:00Z')+60*86400000).toISOString().slice(0,10);r.event.occurrences=r.event.occurrences.filter(o=>o.kind==='TIMED_SESSION'?o.start&&inScope(o.start,now,r.event.city as CityKey):(!o.activeThrough||o.activeThrough>=today)&&(!o.activeFrom||o.activeFrom<end));if(!r.event.occurrences.length)return false;normalizedEventSchema.parse(r.event);venueSchema.parse(r.venue);return true;});}

export function parseChelMuseum(p:Page,pages:Map<string,Page>):Row|null{const d=dom(p),block=d.find(n=>has(n,'exhibition-info'));if(!block)return null;const ns=walk(block),title=text(ns.find(n=>tag(n)==='h1')),values=by(ns,'small-info-title').map(n=>text('parentNode'in n?n.parentNode:undefined));
 const listing=pages.get('https://chelmuseum.ru/exhibitions/'),dateText=values.find(t=>t.startsWith('Даты'))??'',dates=period(dateText.replace(/\s+по\s+/u,' — ')),permanent=/Постоянн/iu.test(dateText)||Boolean(listing&&dom(listing).some(n=>tag(n)==='a'&&attr(n,'href')===p.url&&text(n).startsWith('Постоянная экспозиция'))),place=values.find(t=>t.startsWith('Расположение'))?.replace(/^Расположение\s*/,'');if(!title||!place||!dates&&!permanent)return null;
 const cp=pages.get('https://chelmuseum.ru/contacts/');if(!cp||!text(dom(cp)[0]).includes('г. Челябинск, ул. Труда, 100'))return null;
 const r=makeRow('chel-museum',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,title,place,/Труда,?\s*\d+/iu.test(place)?'Челябинск, '+place:null,['exhibition']);r.venue.observations.push(obs(cp,['location']));
 const prices=values.find(t=>t.startsWith('Стоимость билетов'))??'',adult=prices.match(/Взрослый:\s*([\d\s]+₽)/u),child=prices.match(/Детский:\s*([\d\s]+₽)/u);r.event.price=factualPrice(adult?.[1]??'');if(child){const price=factualPrice(child[1]!);r.event.tariffs!.push({audience:'CHILD',minAge:null,maxAge:null,kind:'CONDITIONAL',amount:price.amount,lowerBound:price.lowerBound,currency:'RUB',applicable:false,conditions:['Возрастная граница детского билета на странице выставки не указана.'],evidence:'Детский билет: '+child[1]});}
 r.event.providerAgeLabel=values.find(t=>t.startsWith('Возрастное ограничение'))?.match(/\d+\+/)?.[0]??null;
 if(permanent&&listing)r.event.observations.push(obs(listing,['dates']));
 for(const m of prices.matchAll(/Семейный билет\s*\(([^)]+)\):\s*(\d+)\s*₽/gu))r.event.tariffs!.push({audience:'GROUP',minAge:null,maxAge:null,kind:'PACKAGE',amount:Number(m[2]),lowerBound:Number(m[2]),currency:'RUB',applicable:false,conditions:[m[1]!],evidence:'Семейный пакет: '+m[2]+' ₽; '+m[1]});
 const mainBuilding=/Труда,?\s*100|Главное здание|Восточное крыло|Западное крыло|Восточная и Западная башни музея/iu.test(place);let hours:Venue['opening']=null;if(mainBuilding){r.venue.address='Челябинск, ул. Труда, 100; '+place;const ht=by(dom(cp),'small-info').map(text).find(t=>t.startsWith('Время работы'))??'';hours=opening(ht,cityDate(p.fetchedAt,cities.chl.timezone));if(hours){const cutoff=ht.match(/Продажа билетов заканчивается в (\d{2}):(\d{2})/);if(cutoff)hours.forEach(h=>h.salesCutoff=Number(cutoff[1])*60+Number(cutoff[2]));}r.venue.observations.push(obs(cp,['address','timetable']));r.venue.opening=hours;}
 r.event.occurrences=[exhibition(r,p,dates?.from??null,dates?.through??null,hours,permanent)];if(mainBuilding&&text(dom(cp)[0]).includes('последний понедельник месяца')){const today=cityDate(p.fetchedAt,cities.chl.timezone),closed:string[]=[];for(let i=0;i<60;i++){const day=new Date(Date.parse(today+'T00:00Z')+i*86400000);if(day.getUTCDay()===1&&new Date(day.getTime()+7*86400000).getUTCMonth()!==day.getUTCMonth())closed.push(day.toISOString().slice(0,10));}r.event.occurrences[0]!.closedDates=closed;}return r;}

export function parsePermMuseum(p:Page):Row|null {const d=dom(p),title=text(d.find(n=>tag(n)==='h1')),dateText=field(d,'event-info__date'),dates=period(dateText),place=field(d,'primary-place').replace(/\s*\([^)]*\)\s*$/,'').trim();if(!title||!dates||!place||/онлайн/iu.test(title))return null;
 const addressByPlace:Record<string,string>={'Дом Мешкова':'ул. Монастырская, 11','Музей пермских древностей':'г. Пермь, ул. Сибирская, 15','Детский музейный центр':'г. Пермь, ул. Советская, 1','Музей-диорама':'г. Пермь, ул. Огородникова, 2','Дом-музей Николая Славянова':'г. Пермь, ул. 1905 года, 37','Подпольная типография':'г. Пермь, ул. Монастырская, 142'};const address=addressByPlace[place];if(!address||!text(d[0]).includes(place+' '+address))return null;
 const r=makeRow('perm-museum',p,new URL(p.url).pathname.split('/').at(-1)!,title,place,'Пермь, '+address.replace(/^г\. Пермь, /,''),['exhibition']);r.event.occurrences=[exhibition(r,p,dates.from,dates.through,null)];return r;}

export function parseNskLibrary(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),title=text(d.find(n=>tag(n)==='h1')),content=field(d,'event-content'),full=text(d[0]),created=full.match(/Дата создания:\s*(20\d{2}-\d{2}-\d{2})/)?.[1],dateText=field(d,'event-date'),hall=field(d,'event-location');if(!title||!created||!hall)return null;
 const cp=pages.get('https://ngonb.ru/about/contacts/');if(!cp||!text(dom(cp)[0]).includes('Юридический и фактический адрес: 630007 г. Новосибирск, ул. Советская, 6'))return null;
 if(/онлайн|трансляци|дистанционн/iu.test(title+' '+hall))return null;
 const r=makeRow('nsk-library',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,title,'НГОНБ, '+hall,'Новосибирск, ул. Советская, 6; '+hall,category(title+' '+content.slice(0,150)));r.venue.observations.push(obs(cp,['address','location']));r.event.publicationAt=cityInstant(created,'00:00',cities.nsk.timezone);
 const dates=period(dateText),time=dateText.match(/\d{1,2}:\d{2}/)?.[0],date=ruDate(dateText,created.slice(0,4));
 if(dates)r.event.occurrences=[exhibition(r,p,dates.from,dates.through,null)];else if(date&&time){r.event.occurrences=[session(r,p,date,time.padStart(5,'0'),null)];}else return null;
 if(/Вход свободный|Вход бесплатный/iu.test(content))r.event.price=factualPrice('Вход свободный');r.event.providerAgeLabel=field(d,'event-tags').match(/\d+\+/)?.[0]??null;return r;}

export function parseSamaraLibrary(p:Page,pages:Map<string,Page>):Row[]{const rows:Row[]=[],d=dom(p);
 for(const a of d.filter(n=>tag(n)==='a'&&/^\/afisha\/num\/\d+$/.test(attr(n,'href')))){const ns=walk(a),url=absolute(attr(a,'href'),p),detail=pages.get(url);if(!detail)continue;const year=text(dom(detail)[0]).match(/\d{1,2}\s+[а-я]+\s+(20\d{2})\./iu)?.[1],date=ruDate(field(ns,'nnode_day')+' '+field(ns,'nnode_day2'),year),time=field(ns,'nnode_time').match(/\d{2}:\d{2}/)?.[0],title=field(ns,'newszgl'),hall=field(ns,'newslocation');if(!date||!time||!title||!hall)continue;
  if(!text(dom(detail)[0]).includes('443110 г. Самара, проспект Ленина, 14 А'))continue;const r=makeRow('samara-library',detail,new URL(url).pathname.split('/').at(-1)!,title,'СОУНБ, '+hall,'Самара, проспект Ленина, 14 А; '+hall,category(title));r.event.observations.push(obs(p));r.event.providerAgeLabel=field(ns,'vozrastznak')||null;r.event.occurrences=[session(r,p,date,time,null)];r.event.occurrences[0]!.sourceUrl=url;rows.push(r);
 }return rows;}

export function parsePermLibrary(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),h=d.find(n=>tag(n)==='h1'),title=text(h),block=h&&'parentNode'in h?h.parentNode:null,full=text(block);if(!title||!block)return null;
 const listing=[...pages.values()].filter(q=>q.url.startsWith(sources['perm-library'].origin)&&(new URL(q.url).pathname==='/'||/\/events\/(afisha|exhibitions)\//.test(q.url))).flatMap(q=>dom(q).filter(n=>tag(n)==='a'&&absolute(attr(n,'href')||'#',q)===p.url).map(n=>({page:q,text:text(n)}))).find(v=>/\d{2}\.\d{2}\.20\d{2}/.test(v.text));
 const year=listing?.text.match(/\d{2}\.\d{2}\.(20\d{2})/)?.[1];if(!year)return null;const dateText=full.match(/Дата:\s*(.+?)\s+Время:/u)?.[1],date=dateText?ruDate(dateText,year):null,time=full.match(/Время:\s*(\d{1,2}:\d{2})/u)?.[1],hall=full.match(/Место проведения:\s*(.+?)(?:\s+Вход|\s+Телефон|\s+Для\s)/u)?.[1];
 const cp=pages.get('https://www.gorkilib.ru/about/contacts/');if(!date||!time||!hall||!cp||!text(dom(cp)[0]).includes('г.Пермь, ул. Ленина, д. 70'))return null;
 const r=makeRow('perm-library',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,title,'Горьковка, '+hall,'Пермь, ул. Ленина, 70; '+hall,category(full));r.event.observations.push(obs(listing!.page,['dates']));r.venue.observations.push(obs(cp,['address','location']));r.event.occurrences=[session(r,p,date,time.padStart(5,'0'),null)];
 // Льготное бесплатное посещение не является общей ценой.
 if(/(?:^|[.!?])\s*Вход свободный(?:[.!?]|$)/iu.test(full))r.event.price=factualPrice('Вход свободный');return r;}

export function parseNNLibraryPlan(p:Page,pages:Map<string,Page>):Row[]{const d=dom(p),title=field(d,'entry-title'),m=title.match(/на\s+([а-я]+)\s+(20\d{2})/iu),content=d.find(n=>has(n,'entry-content')),rows:Row[]=[];if(!m||!content)return rows;const cp=pages.get('https://ngounb.ru/?page_id=84');if(!cp||!text(dom(cp)[0]).includes('Варварская'))return rows;
 for(const tr of walk(content).filter(n=>tag(n)==='tr')){const cells=('childNodes'in tr?tr.childNodes:[]).filter(n=>['td','th'].includes(tag(n))).map(text);if(cells.length<3)continue;const dateText=cells[0]!,name=cells[1]!,hall=cells[2]!,date=ruDate(dateText,m[2]),time=dateText.match(/\d{1,2}:\d{2}/)?.[0];if(!date||!time||!name||!hall||/онлайн|зум|zoom/iu.test(hall))continue;
  const r=makeRow('nn-library',p,'programme-'+bodyHash(new URL(p.url).search+'|'+name+'|'+hall).slice(0,24),name,'НГОУНБ, '+hall,null,category(name));r.venue.observations.push(obs(cp,['location']));r.event.occurrences=[session(r,p,date,time.padStart(5,'0'),null)];rows.push(r);
 }return rows;}

export function parseChelPhil(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),title=field(d,'detail-afisha-top__name'),day=field(d,'detail-afisha-top__date'),stamp=p.body.match(/"SERVER_TIME":(\d+)/)?.[1];if(!title||!stamp)return null;
 // Безгодовая карточка допустима только когда она связана с текущей афишей,
 // а календарный месяц попадает в её ближайшие 60 дней. Архив этим не датируется.
 const linked=[...pages.values()].find(q=>new URL(q.url).pathname==='/afisha/'&&q.url.startsWith(sources['chel-philharmonia'].origin)&&dom(q).some(n=>tag(n)==='a'&&absolute(attr(n,'href')||'#',q)===p.url));if(!linked)return null;
 const serverNow=new Date(Number(stamp)*1000).toISOString(),year=cityDate(serverNow,cities.chl.timezone).slice(0,4),date=ruDate(day,year),time=field(d,'detail-afisha-top__time').match(/\d{2}:\d{2}/)?.[0],hall=field(d,'detail-afisha-top__adres');if(!date||!time||!hall)return null;
 const cp=pages.get('https://philarmonia.ru/viewers/contacts/');if(!cp)throw Error('VENUE_NOT_FETCHED');const cs=dom(cp),marker=/Детск/iu.test(hall)?'ДЕТСКАЯ':/Родина/iu.test(hall)?'РОДИНА':/Прокофьев/iu.test(hall)?'ПРОКОФЬЕВА':null;if(!marker)return null;
 const section=by(cs,'contacts-top-hall').find(n=>text(n).includes(marker)),address=section?by(walk(section),'contacts-top-hall__text').map(text).find(t=>/ул\./.test(t)):null;if(!address)return null;
 const r=makeRow('chel-philharmonia',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!.split('-')[0]!,title,hall,'Челябинск, '+address,category(title));r.venue.observations.push(obs(cp,['location','address']));r.event.observations.push(obs(linked,['dates']));r.event.providerAgeLabel=field(d,'detail-afisha-top__age')||null;
 r.event.price=factualPrice(field(d,'place-price'));r.event.occurrences=[session(r,p,date,time,minutes(field(d,'detail-afisha-top__session')))];
 r.event.issues.push('Год безгодовой карточки установлен по текущей связанной афише и календарю сервера; онлайн-скидка в базовую цену не включена.');return r;}

export function parseSpbMuseum(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),title=text(d.find(n=>tag(n)==='h1')),block=d.find(n=>has(n,'news-detail'));if(!title||!block)return null;
 const listing=pages.get('https://www.spbmuseum.ru/exhibits_and_exhibitions/permanent_displays/'),ns=walk(block),full=text(block),dateText=field(ns,'event_date')||field(ns,'photo-album-date')||text(ns.find(n=>has(n,'news-date-time'))),dates=period(dateText.replace(/\s+по\s+/u,' — ')),permanent=new URL(p.url).pathname.includes('/permanent_displays/')&&Boolean(listing&&dom(listing).some(n=>tag(n)==='a'&&absolute(attr(n,'href')||'#',listing)===p.url));if(!dates&&!permanent)return null;
 const place=text(ns.find(n=>tag(n)==='span'&&/^Место проведения:/u.test(text(n)))).replace(/^Место проведения:\s*/u,'')||text(d.find(n=>attr(n,'title')==='Место проведения'));if(!place||/Орешек|Шлиссельбург|Выставки вне музея/iu.test(place))return null;
 const cp=pages.get('https://www.spbmuseum.ru/themuseum/kontakty.php');if(!cp)return null;
 const campus=place.startsWith('Петропавловская крепость')&&text(dom(cp)[0]).includes('Санкт-Петербург, Петропавловская крепость');
 if(!campus)return null;const r=makeRow('spb-museum',p,new URL(p.url).pathname.split('/').filter(Boolean).at(-1)!,title,place,'Санкт-Петербург, '+place,['exhibition']);r.venue.observations.push(obs(cp,['location']));
 if(permanent&&listing)r.event.observations.push(obs(listing,['dates']));
 const adult=full.match(/Стоимость билетов:\s*взрослый\s*[—–-]\s*(\d+)\s*руб/iu);if(adult)r.event.price=factualPrice(adult[1]+' руб.');
 r.event.occurrences=[exhibition(r,p,dates?.from??null,dates?.through??null,null,permanent)];return r;}

export function parsePermOpera(raw:Page,pages:Map<string,Page>):Row[]{const p=interfaceHTML(raw),rows:Row[]=[];
 for(const card of dom(p).filter(n=>attr(n,'data-element')==='event-card')){
  const ns=walk(card),element=(v:string)=>ns.find(n=>attr(n,'data-element')===v),stamp=attr(element('event-date')??card,'content'),link=element('event-link'),title=text(element('event-name'));
  const map=ns.map(n=>attr(n,'@click')).find(v=>/^\$store\.map\.show\(\{/.test(v));if(!map||!stamp||!title||!link)continue;
  const match=map.match(/^\$store\.map\.show\((\{.*\})\)$/s);if(!match)continue;const venue=JSON.parse(match[1]!);if(typeof venue.address!=='string'||!/^Пермь,/.test(venue.address)||typeof venue.name!=='string')continue;
  const url=absolute(attr(link,'href'),p),detail=pages.get(url),detailNodes=detail?dom(detail):[];
  const production=detailNodes.find(n=>tag(n)==='a'&&/\/playbills\/repertoire\/[^/]+\/$/.test(attr(n,'href'))&&text(n)===title);
  // Опубликованный адрес постановки или её неизменный slug + площадка, не заголовок.
  const identity=production?new URL(attr(production,'href'),url).pathname:new URL(url).pathname.replace(/\/20\d{2}-\d{2}-\d{2}-\d{4}-/,'/production-');
  const r=makeRow('permopera',raw,'production-'+bodyHash(identity+'|'+venue.name).slice(0,24),title,venue.name.replace(/\s+/g,' '),venue.address,category(text(card)));
  r.event.sourceUrl=url;const range=text(card).match(/(\d{2}:\d{2})[–—-](\d{2}:\d{2})/),clock=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3)),duration=range?clock(range[2]!)-clock(range[1]!):null;
  r.event.occurrences=[session(r,raw,stamp.slice(0,10),stamp.slice(11,16),duration&&duration>0?duration:null,attr(card,'data-post-id'))];r.event.occurrences[0]!.sourceUrl=url;
  r.event.providerAgeLabel=text(card).match(/\b\d{1,2}\+/)?.[0]??null;const button=element('event-button');if(button&&attr(button,'data-tickets-left')==='0'&&/продан|нет билет|Билетов нет/iu.test(attr(button,'data-btn-text-initial')+' '+text(button)))r.event.occurrences[0]!.availability='OBSERVED_SOLD_OUT';
  if(detail)r.event.observations.push(obs(detail));rows.push(r);
 }return rows;}

export function parseSpbOpera(p:Page,pages:Map<string,Page>):Row[]{const rows:Row[]=[],cp=pages.get('https://www.spbopera.ru/contacts/');if(!cp)return rows;
 for(const card of by(dom(p),'new-affiche-item')){const ns=walk(card),link=ns.find(n=>has(n,'new-affiche-item__name')),date=ruDate(attr(card,'data-date')),time=attr(card,'data-time'),title=text(link);if(!date||!time||!link||!title)continue;
  const url=absolute(attr(link,'href'),p),detail=pages.get(url),dn=detail?dom(detail):[],info=detail?text(dn.find(n=>tag(n)==='main')):'';
  // Гастроли и вторая сцена требуют своего подтверждённого адреса.
  if(/гастрол|вторая сцена|выезд|Екатерининск/iu.test(attr(card,'data-tags')+' '+field(ns,'new-affiche-item__place')))continue;
  const r=makeRow('spb-opera',p,new URL(url).pathname.replace(/[^a-z0-9]/g,'-'),title,'Камерный музыкальный театр «Санктъ-Петербургъ Опера»',null,['theater']);r.event.sourceUrl=url;
  contact(r,cp,'Санкт-Петербург, Галерная улица, 33','Санкт-Петербург, Галерная ул., 33');r.event.providerAgeLabel=attr(card,'data-min-age')+'+';
  const duration=info.match(/Продолжительность\s*:?\s*([^.;]{1,65})/iu);r.event.occurrences=[session(r,p,date,time,minutes(duration?.[1]??''),attr(card,'data-event-id'))];r.event.occurrences[0]!.sourceUrl=url;
  if(detail)r.event.observations.push(obs(detail));rows.push(r);
 }return rows;}

export function parseFilarm(raw:Page,pages:Map<string,Page>):Row[]{const p=interfaceHTML(raw),rows:Row[]=[],cp=pages.get('https://filarm.ru/contacts/');if(!cp)return rows;
 for(const card of by(dom(p),'event_item')){const ns=walk(card),link=ns.find(n=>tag(n)==='a'&&/^\/afisha\/concert\d+\.html$/.test(attr(n,'href'))),ticket=ns.map(n=>attr(n,'href')).find(h=>/^https:\/\/tickets\.filarm\.ru\/scheme\/[^/]+\/20\d{2}-\d{2}-\d{2}\/\d{2}:\d{2}/.test(h));if(!link||!ticket)continue;
  const match=ticket.match(/\/scheme\/[^/]+\/(20\d{2}-\d{2}-\d{2})\/(\d{2}:\d{2})/)!;const title=field(ns,'title'),hall=field(ns,'place');if(!title||!hall||!['Концертный зал','Камерный зал'].includes(hall))continue;
  const url=absolute(attr(link,'href'),p),detail=pages.get(url),r=makeRow('filarm',raw,new URL(url).pathname.split('/').at(-1)!.replace('.html',''),title,'Самарская филармония, '+hall,null,category(title));r.event.sourceUrl=url;
  contact(r,cp,'Самара, улица Фрунзе, 141','г. Самара, ул. Фрунзе, 141');r.event.price=factualPrice(field(ns,'price'));r.event.providerAgeLabel=field(ns,'age_limit')||null;
  const duration=detail?field(dom(detail),'concertpage_text_content').match(/Продолжительность\s*:?\s*([^.;]{1,65})/iu)?.[1]:'';
  r.event.occurrences=[session(r,raw,match[1]!,match[2]!,minutes(duration??''))];r.event.occurrences[0]!.sourceUrl=url;if(detail)r.event.observations.push(obs(detail));rows.push(r);
 }return rows;}

export function parseChelLibrary(p:Page,pages:Map<string,Page>):Row|null {const d=dom(p),main=d.find(n=>tag(n)==='main'),body=text(main),title=text(d.find(n=>tag(n)==='h1')),date=ruDate(body.match(/Начало:\s*([^|]+)/u)?.[1]??''),time=body.match(/Начало:[^|]+?(\d{1,2}:\d{2})/u)?.[1];
 const hall=body.match(/Название места:\s*(.+?)\s+Подразделение:/u)?.[1],department=body.match(/Подразделение:\s*(.+?)\s+Контакты:/u)?.[1],cp=pages.get('https://chelreglib.ru/ru/pages/about/lib/contacts/');
 if(!main||!date||!time||!title||!hall||!department||!cp||!text(dom(cp)[0]).includes('Челябинск'))return null;
 const address=department.match(/\(([^)]+(?:д\.|ул\.|пр\.)[^)]+)\)/u)?.[1]??department.match(/\(([^)]*(?:Ленина|Коммуны|Цвиллинга)[^)]*)\)/u)?.[1];if(!address||/онлайн|zoom/iu.test(hall))return null;
 const detail=body.slice(body.indexOf(title)+title.length,body.indexOf('Начало:'));
 const identity=bodyHash(title+'|'+hall+'|'+department+'|'+detail.replace(/\s+/g,' ')).slice(0,24),r=makeRow('chel-library',p,'programme-'+identity,title,'ЧОУНБ, '+hall,'Челябинск, '+address,category(body.match(/Категория:\s*([^:]+?)(?:Ключевые слова:|$)/u)?.[1]??title));
 r.venue.observations.push(obs(cp,['location']));r.event.providerAgeLabel=body.match(/Начало:[^|]+\|\s*(\d{1,2}\+)/u)?.[1]??null;
 r.event.occurrences=[session(r,p,date,time.padStart(5,'0'),null,new URL(p.url).pathname.split('/').filter(Boolean).at(-1))];
 if(/предварительн.{0,10}запис|обязательн.{0,25}регистрац/iu.test(detail)){r.event.admission.registration='REQUIRED';r.event.admission.conditions.push('Требуется самостоятельная предварительная запись в библиотеку.');}
 if(/Вход свободный|Вход бесплатный/iu.test(detail))r.event.price=factualPrice('Вход свободный');return r;}
