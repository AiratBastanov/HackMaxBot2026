import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import * as p from '../src/data/multi-parsers.js';
import {bodyHash,makeSnapshots,type Page} from '../src/data/institutions.js';
import {groupRows} from '../src/data/multi-refresh.js';
import {Catalog} from '../src/culture/catalog.js';
import {activate,type CandidateFile} from '../src/data/real-refresh.js';
import {publicPolicyHash,snapshotDigest,reviewedSnapshot} from '../src/data/source-policy.js';
import {cities,cityInstant,resolveCity,type CityKey} from '../src/data/cities.js';
import {select,assess} from '../src/data/select.js';
import {robotsAllows} from '../src/data/institution-http.js';
import {campaignUrl,publicAddress,robotsSpacing} from '../src/data/campaign.js';
import {nuxtData} from '../src/data/multi-parsers.js';
import {loadCurrentCatalog} from '../src/polling-config.js';
import {installBundledCatalog} from '../src/catalog-bootstrap.js';
import {createHash} from 'node:crypto';

// Минимальные вымышленные HTML fixtures воспроизводят проверенные формы источников.
// Это не скачанные сайты и не источник production-фактов.
const at='2026-09-28T10:00:00.000Z',page=(url:string,body:string):Page=>({url,body,hash:bodyHash(body),fetchedAt:at,modified:null});
const q=(city:CityKey)=>({version:2,city,timezone:cities[city].timezone,date:{mode:'ANY'},time:{mode:'ANY'},party:{adults:1,childAges:[]},budgetBasis:'PARTY_TOTAL',budgetRub:null,category:null,zone:null,kind:'ANY',preferences:{categories:[]}});
const contact=(url:string,text:string)=>page(url,`<p>${text}</p>`),map=(...pages:Page[])=>new Map(pages.map(v=>[v.url,v]));
test('Даты, индивидуальная цена, услуга и семейный пакет не смешиваются',()=>{
 assert.equal(p.minutes('2 часа 15 минут'),135);assert.equal(p.ruDate('3 октября 2026'),'2026-10-03');
 assert.equal(p.factualPrice('500–900 руб.').kind,'RANGE');assert.equal(p.factualPrice('от 500 ₽').amount,null);
 assert.equal(p.factualPrice('Семейный пакет 800 ₽').kind,'CONDITIONAL');assert.equal(p.factualPrice('Вход свободный').amount,0);assert.equal(p.factualPrice('').kind,'UNKNOWN');
});
test('Пермская опера: JSON календаря, две страницы/дубликат, время +5 и одна постановка',()=>{
 const card=(id:number,date:string,sold=false)=>`<article data-element="event-card" data-post-id="${id}"><meta data-element="event-date" content="${date}T19:00:00"><button @click='$store.map.show({"name":"Театр","address":"Пермь, ул. Петропавловская, 25А"})'></button><h2 data-element="event-name">Учебная опера</h2><a data-element="event-link" href="/playbills/playbill/${date}-1900-uchebnaya-opera/">Учебная опера</a><p>19:00–21:40 Опера 12+</p><div data-element="event-button" data-tickets-left="${sold?0:20}" data-btn-text-initial="${sold?'Билеты проданы':'Купить билет'}"></div></article>`;
 const first=page('https://permopera.ru/playbills/playbill/?month=2026-10-01&json=1',JSON.stringify({content:card(1,'2026-10-03'),has_next_page:true,next_page_url:'?page=2'}));
 const second=page('https://permopera.ru/playbills/playbill/?page=2&json=1',JSON.stringify({content:card(1,'2026-10-03')+card(2,'2026-10-04',true),has_next_page:false}));
 const rows=[...p.parsePermOpera(first,map()),...p.parsePermOpera(second,map())],group=groupRows(rows);assert.equal(rows.length,3);assert.equal(group.rows.length,1);assert.equal(group.rows[0]!.event.occurrences.length,2);
 assert.equal(group.rows[0]!.event.occurrences[0]!.start,'2026-10-03T14:00:00.000Z');assert.equal(group.rows[0]!.event.occurrences[0]!.durationMinutes,160);
 assert.equal(group.rows[0]!.event.occurrences[1]!.availability,'OBSERVED_SOLD_OUT');const s=makeSnapshots(group.rows,at,72,60,group.venues)[0]!;assert.equal(select(s,q('prm'),new Date(at),false,true).strictTotal,1);
});
test('Красноярская афиша: ID основной программы, не соседнего виджета; цена и реальный город',()=>{
 const body=(id:number,date:string,city='Красноярск')=>`<button data-profticket-data='{"showId":999}'></button><div class="card-poster"><img src="/uploads/afisha_show/${id}/image/x.jpg"><h1>Учебный концерт ${id}</h1><div class="concert-info__item"><a href="/events?date=${date}">3 октября 19:00</a></div><div class="concert-info__item"><a href="/events?city=1">Большой зал, ${city} г.</a></div><div class="concert-info__item">500 — 900 ₽</div><div class="concert-info__item">6+</div></div>`;
 const a=p.parseKrasfil(page('https://krasfil.ru/events/101',body(11,'2026-10-03')))!;const b=p.parseKrasfil(page('https://krasfil.ru/events/102',body(12,'2026-10-04')))!;
 assert.equal(a.event.id,'krasfil:show-11');assert.equal(b.event.id,'krasfil:show-12');assert.equal(a.event.price.upperBound,900);assert.equal(a.event.occurrences[0]!.timezone,'Asia/Krasnoyarsk');assert.equal(p.parseKrasfil(page('https://krasfil.ru/events/103',body(13,'2026-10-03','Дивногорск'))),null);
});
test('НОВАТ: одна постановка/два сеанса, длительность, версия с другим постановщиком',()=>{
 const body=(date:string,credit='Учебная постановка А')=>`<section itemtype="https://schema.org/TheaterEvent"><meta itemprop="name" content="Учебный балет"><meta itemprop="address" content="Новосибирск, Красный проспект, 36"><meta itemprop="startDate" content="${date}T19:00:00+07:00"></section><div class="text_room">Большая сцена</div><div class="directors">${credit}</div><div class="desc_play__short">Балет; премьера 2026</div><div class="desc_play__information">2 часа 15 минут</div>`;
 const rows=[1,2].map((id,i)=>p.parseNovat(page('https://novat.ru/afisha/performances/detail/'+id+'/',body('2026-10-0'+(i+3))))!);assert.equal(groupRows(rows).rows.length,1);assert.equal(rows[0]!.event.occurrences[0]!.start,'2026-10-03T12:00:00.000Z');assert.equal(rows[0]!.event.occurrences[0]!.durationMinutes,135);
 assert.notEqual(rows[0]!.event.id,p.parseNovat(page('https://novat.ru/afisha/performances/detail/3/',body('2026-10-03','Постановка Б')))!.event.id);
});
test('Петербургская филармония: перенесённый концерт не остаётся на прежней дате',()=>{
 const url='https://www.philharmonia.spb.ru/afisha/2/',fresh=page(url,'<div class="afisha_element_image_zal346"></div><div><span class="event_date">3 октября 2026</span> 19:00</div><div class="afisha_element_title"><h2>Учебный концерт</h2></div><div class="afisha_element_duration">1 час 30 минут</div><div class="it-buy-prices">500–900 руб.</div>'),old=page('https://www.philharmonia.spb.ru/afisha/1/',`<a class="afisha_element_transfer_to_info" href="${url}">Перенесён на 3 октября</a>`),cp=contact('https://www.philharmonia.spb.ru/about/roadmap/','Михайловская ул., 2');
 const pages=map(fresh,old,cp),a=p.parseSpbPhil(old,pages)!,b=p.parseSpbPhil(fresh,pages)!;assert.equal(a.event.id,b.event.id);assert.equal(a.event.occurrences[0]!.start,'2026-10-03T16:00:00.000Z');assert.equal(groupRows([a,b]).rows[0]!.event.occurrences.length,1);assert.throws(()=>p.parseSpbPhil(old,map(cp)),/TRANSFER_TARGET/);
});
test('Московская филармония: readonly JSON месячного фильтра, год/зал/программа; старый slug исключён',()=>{
 const hall=page('https://meloman.ru/hall/a/','<h1>Камерный зал Филармонии</h1><div class="grid-hall-contacts">Адрес: Тверская, 31 Время работы: 10–20</div>');
 const card=(date:string,slugDate=date)=>`<article class="article-ticket"><time datetime="${date.split('-').reverse().join('.')} 19:00"></time><div class="article-ticket__toolbar"><div class="editor">Камерный зал Филармонии</div></div><a href="/concert/a-${slugDate}/"><p><b class="uppercase">Учебный концерт</b></p><p>Программа А</p></a></article>`;
 const listing=page('https://meloman.ru/project/phpfiles/web/ajax.php',JSON.stringify({data:card('2026-10-03')+card('2026-10-04')+card('2026-10-05','2025-10-05')})),rows=p.parseMelomanList(listing,map(hall));assert.equal(rows.length,2);assert.equal(groupRows(rows).rows.length,1);assert(rows.every(r=>r.event.price.kind==='UNKNOWN'&&r.event.occurrences[0]!.end===null));assert.equal(rows[0]!.venue.address,'Москва, Тверская, 31');
});
test('Самарская филармония: даты из опубликованной ссылки, индивидуальный диапазон отдельно от абонемента',()=>{
 const cp=contact('https://filarm.ru/contacts/','г. Самара, ул. Фрунзе, 141'),card=(id:number,date:string)=>`<div class="event_item"><a href="/afisha/concert${id}.html"></a><div class="title">Учебный концерт ${id}</div><div class="place">Концертный зал</div><div class="description">Абонемент № 1</div><div class="price">500-900 руб.</div><a href="https://tickets.filarm.ru/scheme/PUBLIC/${date}/10:30">Купить</a></div>`;
 const rows=p.parseFilarm(page('https://filarm.ru/ajax.php?JsHttpRequest=0-xml',JSON.stringify({text:card(1,'2026-10-03')+card(2,'2026-10-04')})),map(cp));assert.equal(rows.length,2);assert.equal(rows[0]!.event.price.kind,'RANGE');assert.equal(rows[0]!.event.occurrences[0]!.start,'2026-10-03T06:30:00.000Z');
});
test('Театр Санктъ-Петербургъ: ID репертуара, две даты, без исторической цены скрытого виджета',()=>{
 const cp=contact('https://www.spbopera.ru/contacts/','Санкт-Петербург, Галерная ул., 33'),card=(id:number)=>`<div class="new-affiche-item" data-date="0${id+2}.10.2026" data-time="19:00" data-event-id="${id}" data-min-age="12"><a class="new-affiche-item__name" href="/repertuar/spektakli/1-test/">Учебная опера</a></div>`;
 const rows=p.parseSpbOpera(page('https://www.spbopera.ru/afisha/',card(1)+card(2)+'<div hidden>17.11.2021 1700 руб.</div>'),map(cp));assert.equal(rows.length,2);assert.equal(groupRows(rows).rows.length,1);assert.equal(rows[0]!.event.price.kind,'UNKNOWN');
});
test('Башопера: одноимённые балет и опера не сливаются',()=>{
 const cp=contact('https://bashopera.ru/about/contacts/','г. Уфа, ул. Ленина, 5/1'),card=(id:number,type:string)=>`<div class="item content" id="event_${id}"><div class="name"><a href="/repertoire/${type}/${id}/">Учебная история</a></div><div class="date">3 октября</div><div class="hall">Большой зал, 19:00</div><div class="tags">6+</div></div>`;
 const rows=p.parseBashopera(page('https://bashopera.ru/affiche/',card(1,'opera')+card(2,'ballet')+'<footer>© 2026 Башкирский театр</footer>'),map(cp));assert.equal(rows.length,2);assert.equal(groupRows(rows).rows.length,2);assert.equal(rows[0]!.event.occurrences[0]!.start,'2026-10-03T14:00:00.000Z');
});
test('Библиотека Маяковского: подтверждённый день фильтра, свободный вход и неизвестные часы выставки',()=>{
 const body=(date:string)=>`<h1>Учебная встреча</h1><p>Вход свободный.</p><div>Информация Адрес: Невский, 20 Дата: ${date} Ограничение по возрасту: 6+</div>`;
 const a=p.parseSpbLibrary(page('https://pl.spb.ru/events/detail.php?ELEMENT_ID=1',body('3 октября 19:00–20:00')),['2026-10-03'])!,b=p.parseSpbLibrary(page('https://pl.spb.ru/events/detail.php?ELEMENT_ID=2',body('3 октября — 5 октября 10:00–18:00')),['2026-10-03','2026-10-05'])!;
 assert.equal(a.event.price.kind,'FREE');assert.equal(a.event.occurrences[0]!.durationMinutes,60);assert.equal(b.event.occurrences[0]!.kind,'FLEXIBLE_VISIT');assert.equal(b.event.occurrences[0]!.opening,null);assert.equal(p.parseSpbLibrary(page('https://pl.spb.ru/events/detail.php?ELEMENT_ID=1',body('3 октября 19:00')),['2026-10-04']),null);
});
test('Челябинский музей: выставка и постоянная экспозиция, взрослый/детский/семейный тариф раздельно',()=>{
 const url='https://chelmuseum.ru/exhibitions/test/',cp=contact('https://chelmuseum.ru/contacts/','г. Челябинск, ул. Труда, 100'),listing=page('https://chelmuseum.ru/exhibitions/',`<a href="${url}">Постоянная экспозиция Учебный музей</a>`);
 const body=(date:string)=>`<div class="exhibition-info"><h1>Учебный музей</h1>${date?`<div><b class="small-info-title">Даты</b>${date}</div>`:''}<div><b class="small-info-title">Расположение</b>Восточная и Западная башни музея</div><div><b class="small-info-title">Стоимость билетов</b>Взрослый: 500 ₽ Детский: 300 ₽ Семейный билет (двое взрослых и один ребенок от 6 лет): 800 ₽</div></div>`;
 const a=p.parseChelMuseum(page(url,body('')),map(cp,listing))!,b=p.parseChelMuseum(page('https://chelmuseum.ru/exhibitions/other/',body('01.09.2026 по 30.10.2026')),map(cp,listing))!;
 assert(a.event.occurrences[0]!.endless);assert.equal(b.event.occurrences[0]!.activeThrough,'2026-10-30');assert.equal(a.event.price.amount,500);assert.equal(a.event.tariffs![0]!.applicable,false);assert.equal(a.event.tariffs![1]!.kind,'PACKAGE');assert.equal(a.event.tariffs![1]!.amount,800);assert(a.venue.address?.includes('Труда, 100'));
});
test('NN библиотека: HTML-таблица, две даты, не диапазон ежедневных сеансов и не чужой город',()=>{
 const cp=contact('https://ngounb.ru/?page_id=84','Нижний Новгород, Варварская, 3');
 const a=page('https://ngounb.ru/?p=1','<h1 class="entry-title">План на октябрь 2026</h1><div class="entry-content"><table><tr><td>3 октября 17:00</td><td>Учебная лекция</td><td>Белый зал</td></tr><tr><td>4 октября 18:00</td><td>Учебная встреча</td><td>Белый зал</td></tr><tr><td>Октябрь</td><td>Выставка без точных дней</td><td>Холл</td></tr></table></div>');
 const rows=p.parseNNLibraryPlan(a,map(cp));assert.equal(rows.length,2);assert(rows.every(r=>r.event.city==='nnv'));assert.equal(rows[0]!.venue.address,null);assert.equal(rows[0]!.event.occurrences[0]!.end,null);
});
test('Челябинская библиотека: два сеанса одной программы, предварительная запись и адрес подразделения',()=>{
 const cp=contact('https://chelreglib.ru/ru/pages/about/lib/contacts/','Челябинск'),body=(day:number)=>`<main><h1>Учебный мастер-класс</h1><p>Предварительная запись обязательна.</p>Начало: ${day} октября 2026 г. 11:00 | 12+ Название места: Зал каталогов Подразделение: ЧОУНБ (пр. Ленина, д. 60) Контакты: Категория: мастер-класс Ключевые слова:</main>`;
 const rows=[3,4].map(id=>p.parseChelLibrary(page('https://chelreglib.ru/ru/events/'+id+'/',body(id)),map(cp))!);assert.equal(rows.length,2);assert.equal(groupRows(rows).rows.length,1);assert.equal(rows[0]!.event.admission.registration,'REQUIRED');assert.equal(rows[0]!.venue.address,'Челябинск, пр. Ленина, д. 60');
});
test('Срок источника изолирован: один expired shard не блокирует иной источник того же города; hash нельзя подменить',()=>{
 const a=p.makeRow('spb-opera',page('https://www.spbopera.ru/afisha/','fixture'),'a','Учебная опера','Сцена','Санкт-Петербург, Галерная, 33',['theater']);a.event.occurrences=[p.session(a,page('https://www.spbopera.ru/afisha/','fixture'),'2026-10-03','19:00',60)];
 const b=p.makeRow('spb-library',page('https://pl.spb.ru/events/detail.php?ELEMENT_ID=1','fixture'),'b','Учебная встреча','Библиотека','Санкт-Петербург, Невский, 20',['education']);b.event.occurrences=[p.session(b,page('https://pl.spb.ru/events/detail.php?ELEMENT_ID=1','fixture'),'2026-10-03','19:00',60)];
 const snapshots=[...makeSnapshots([a],at,1,60),...makeSnapshots([b],at,72,60)],candidate:CandidateFile={version:1,builtAt:at,snapshots,reviewQueue:[],sourceStatus:{'spb-opera':'PARSED_CACHED_SCOPE','spb-library':'PARSED_CACHED_SCOPE'}};
 mkdirSync('.tmp/multi-city',{recursive:true});const root=mkdtempSync(resolve('.tmp/multi-city/case-')),clock=Date.parse(at)+2*3600000;activate(candidate,snapshotDigest(candidate),root,clock,true);
 const config={flowDataMode:'real',admissionMode:'PUBLIC',snapshotPath:resolve(root,'active.json')} as any,c=loadCurrentCatalog(config,clock);assert.equal(c.selectionForCity('spb',clock)!.events.length,1);assert.equal(c.selectionForCity('spb',clock)!.events[0]!.id,b.event.id);
 assert(!c.permits([c.displayRef(a.event.id)!],clock,true));assert(c.permits([c.displayRef(b.event.id)!],clock,true));const tampered=structuredClone(c.review!);tampered.entries[1]!.publicPolicyHashes={};assert.equal(new Catalog('real',{snapshots},tampered,true).usableCities(clock).length,0);
 const pointer=JSON.parse(readFileSync(resolve(root,'active.json'),'utf8')),hash=createHash('sha256').update(readFileSync(resolve(root,pointer.snapshot))).digest('hex'),installed=resolve(root,'installed');
 assert.throws(()=>installBundledCatalog('0'.repeat(64),clock,root,installed),/HASH_MISMATCH/);
 assert(installBundledCatalog(hash,clock,root,installed).observationTimesPreserved);
 assert.deepEqual(Catalog.load({...config,snapshotPath:resolve(installed,'active.json')}).review,c.review);
 assert.throws(()=>installBundledCatalog(hash,clock+100*3600000,root,installed),/STALE/);
});
test('Registry/timezones/SSRF/robots safety remain bounded; untrusted Nuxt is never executed',()=>{
 for(const city of Object.keys(cities) as CityKey[])assert(resolveCity(cities[city].name).includes(city));assert.equal(cityInstant('2026-10-03','00:00',cities.sam.timezone),'2026-10-02T20:00:00.000Z');
 assert(!publicAddress('127.0.0.1'));assert(!publicAddress('169.254.169.254'));assert(!publicAddress('::1'));assert.throws(()=>campaignUrl('https://localhost/'));assert.throws(()=>campaignUrl('https://user:pass@novat.ru/'));
 assert.equal(robotsSpacing('User-agent: *\nCrawl-delay: 10'),10);assert.throws(()=>robotsAllows('User-agent: *\nCrawl-delay: 10','/afisha',2),/DELAY/);assert(robotsAllows('User-agent: *\nCrawl-delay: 10','/afisha',10));assert(!robotsAllows('User-agent: *\nDisallow: /private','/private/data'));
 assert.equal(nuxtData(page('https://operann.ru/afisha','<script>throw new Error("must never execute")</script>')),null);assert(publicPolicyHash('permopera'));assert.equal(publicPolicyHash('mosconcert'),null);
});
test('Кандидат: неопределённый SSR статус, отмена и отсутствие площадки не становятся строгим совпадением',()=>{
 const source=page('https://operann.ru/afisha/test','fixture'),r=p.makeRow('operann',source,'test','Учебная опера','Театр','Нижний Новгород, Белинского, 59',['theater']);r.event.occurrences=[p.session(r,source,'2026-10-03','19:00',90)];r.event.occurrences[0]!.availability='UNRESOLVED_SOURCE_STATUS';
 const s=makeSnapshots([r],at,72,60)[0]!,result=select(s,q('nnv'),new Date(at),false,true);assert.equal(result.strictTotal,0);assert.equal(result.uncertainTotal,1);assert(result.uncertain[0]!.reasons.some(v=>v.includes('Билеты распроданы')));
 r.event.occurrences[0]!.cancelled=true;assert.equal(select(makeSnapshots([r],at,72,60)[0],q('nnv'),new Date(at),false,true).uncertainTotal,0);
});

test('Нижегородская опера: безопасный Nuxt, фестиваль не сливает самостоятельные концерты',()=>{
 const item=(id:string,title:string)=>({id,url:'/afisha/'+id,title,date:[{value:'2026-10-03T16:00:00Z'}],field_hall:[{name:'Пакгаузы',field_address:['Нижний Новгород, Стрелка, 21']}],field_parent_performance:[{id:'953',url:'/repertiore/festival/test'}],durtion:['1 час']});
 const data={data:{'page-afisha':{data:[{childs:[item('1','Учебный концерт А'),item('2','Учебный концерт Б')]}]}}},table:any[]=[];
 function encode(v:any):number{const index=table.length;table.push(null);table[index]=v&&typeof v==='object'?Array.isArray(v)?v.map(encode):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])):v;return index;}encode(data);
 const a=page('https://operann.ru/afisha',`<article><a href="/afisha/1">Учебный концерт А</a><a href="/tickets/#/buy/undefined">Билеты распроданы</a></article><script type="application/json">${JSON.stringify(table)}</script>`),rows=p.parseOperaNNFull(a,map());assert.equal(rows.length,2);assert.notEqual(rows[0]!.event.id,rows[1]!.event.id);assert.equal(rows[0]!.event.occurrences[0]!.availability,'UNRESOLVED_SOURCE_STATUS');assert(rows[0]!.event.admission.conditions.some(s=>s.includes('не заполн')||s.includes('незаполн')));
});
test('Самарский театр: две даты одной постановки и длительность из отдельного времени',()=>{
 const cp=contact('https://opera-samara.ru/Kontaktnaya_informatsiya/','площадь Куйбышева, д. 1'),card=(day:number)=>`<section><div class="dateBox"><div class="date">${day} октября</div></div><div class="time">19:00</div><div class="name"><a href="/repertoire/opera1.html">Учебная опера</a></div><span>02:00 12+</span></section>`;
 const rows=p.parseSamaraOpera(page('https://opera-samara.ru/afisha/','<a>Октябрь 2026 (20)</a>'+card(3)+card(4)),map(cp));assert.equal(rows.length,2);assert.equal(groupRows(rows).rows.length,1);assert.equal(rows[0]!.event.occurrences[0]!.durationMinutes,120);assert.equal(rows[0]!.event.occurrences[0]!.timezone,'Europe/Samara');
});
test('Нижегородский художественный музей: часы отдельно от дат выставки и постоянная экспозиция',()=>{
 const body=(url:string,date:string)=>`<h1 class="nghm_content_block__title">Учебная выставка</h1><div class="nghm_content_block__date">${date}</div><div class="nghm_vm_block_item"><a href="${url}">Выставка</a><span class="nghm_vm_block_item_location_name">Русское искусство</span><div class="nghm_vm_block_item_location">Русское искусство Кремль, корпус 3</div></div><footer>График работы НГХМ Вторник — Среда с 10.00 до 18.00 Четверг — с 12.00 до 20.00 Пятница — воскресенье с 11.00 до 19.00 РУССКОЕ ИСКУССТВО</footer>`;
 const url='https://artmuseumnn.ru/vystavki/1/',a=p.parseNNArt(page(url,body(url,'1 сентября 2026 — 30 октября 2026')),map())!,b=p.parseNNArt(page(url,body(url,'Постоянная экспозиция')),map())!;assert.equal(a.event.occurrences[0]!.opening!.length,6);assert.equal(b.event.occurrences[0]!.endless,true);assert.equal(a.event.price.kind,'UNKNOWN');
});
test('Музей Петербурга: связанная постоянная экспозиция и период; Орешек не Петербург',()=>{
 const url='https://www.spbmuseum.ru/exhibits_and_exhibitions/permanent_displays/1/',cp=contact('https://www.spbmuseum.ru/themuseum/kontakty.php','Санкт-Петербург, Петропавловская крепость'),listing=page('https://www.spbmuseum.ru/exhibits_and_exhibitions/permanent_displays/',`<a href="${url}">Учебная экспозиция</a>`),body=(place:string,period='')=>`<h1>Учебная экспозиция</h1><div class="news-detail"><span class="event_date">${period}</span></div><i title="Место проведения">${place}</i>`;
 const a=p.parseSpbMuseum(page(url,body('Петропавловская крепость')),map(cp,listing))!,b=p.parseSpbMuseum(page('https://www.spbmuseum.ru/exhibits_and_exhibitions/temporary_exhibitions/2/',body('Петропавловская крепость','1 сентября 2026 — 30 октября 2026')),map(cp,listing))!;assert(a.event.occurrences[0]!.endless);assert.equal(b.event.occurrences[0]!.activeThrough,'2026-10-30');assert.equal(p.parseSpbMuseum(page(url,body('Крепость Орешек')),map(cp,listing)),null);
});
test('Новосибирская и Самарская библиотеки: опубликованный год, зал и отсутствие неизвестного окончания',()=>{
 const ncp=contact('https://ngonb.ru/about/contacts/','Юридический и фактический адрес: 630007 г. Новосибирск, ул. Советская, 6');
 for(const day of [3,4]){const row=p.parseNskLibrary(page('https://ngonb.ru/afisha/events/'+day+'/','<h1>Учебная лекция</h1><div class="event-date">'+day+' октября, 15:00</div><div class="event-location">Конференц-зал</div><div class="event-content">Вход свободный.</div><p>Дата создания: 2026-09-28</p>'),map(ncp))!;assert.equal(row.event.occurrences[0]!.end,null);assert.equal(row.event.price.kind,'FREE');}
 const details=[1,2].map(id=>page('https://libsmr.ru/afisha/num/'+id,'<p>28 сентября 2026.</p><footer>443110 г. Самара, проспект Ленина, 14 А</footer>'));
 const listing=page('https://libsmr.ru/afisha',details.map((v,i)=>`<a href="/afisha/num/${i+1}"><span class="nnode_day">${i+3}</span><span class="nnode_day2">октября</span><div class="nnode_time">16:00</div><div class="newszgl">Учебная встреча ${i}</div><div class="newslocation">Зал</div></a>`).join(''));const rows=p.parseSamaraLibrary(listing,map(...details));assert.equal(rows.length,2);assert(rows.every(r=>r.event.price.kind==='UNKNOWN'));
});
test('Пермские музей и библиотека: разные филиалы и свободный вход по записи',()=>{
 for(const [id,name,address]of [['1','Дом Мешкова','ул. Монастырская, 11'],['2','Детский музейный центр','г. Пермь, ул. Советская, 1']]){const row=p.parsePermMuseum(page('https://museumperm.ru/event/'+id,`<h1>Учебная выставка</h1><span class="event-info__date">1 сентября 2026 — 30 октября 2026</span><span class="primary-place">${name}</span><footer>${name} ${address}</footer>`))!;assert(row.venue.address?.includes('Пермь'));assert.equal(row.event.occurrences[0]!.opening,null);}
 const cp=contact('https://www.gorkilib.ru/about/contacts/','г.Пермь, ул. Ленина, д. 70');
 for(const day of [3,4]){const url='https://www.gorkilib.ru/events/test-'+day,listing=page('https://www.gorkilib.ru/',`<a href="${url}">28.09.2026 Учебный концерт</a>`),detail=page(url,`<main><h1>Учебный концерт</h1><p>Дата: ${day} октября Время: 18:30 Место проведения: конференц-зал Вход свободный по предварительной регистрации.</p></main>`),row=p.parsePermLibrary(detail,map(cp,listing))!;assert(row);assert.equal(row.event.occurrences[0]!.end,null);}
});
test('Челябинская филармония: год только связанной текущей афиши, адрес нужного зала и точная цена',()=>{
 const cp=page('https://philarmonia.ru/viewers/contacts/','<div class="contacts-top-hall">ПРОКОФЬЕВА<div class="contacts-top-hall__text">ул. Труда, 92а</div></div>');
 for(const day of [3,4]){const url='https://philarmonia.ru/afisha/'+day+'-test/',listing=page('https://philarmonia.ru/afisha/',`<a href="${url}">Концерт</a>`),detail=page(url,'<script>{"SERVER_TIME":'+Date.parse(at)/1000+'}</script><h1 class="detail-afisha-top__name">Учебный концерт</h1><div class="detail-afisha-top__date">'+day+' октября</div><span class="detail-afisha-top__time">19:00</span><div class="detail-afisha-top__adres">Зал Прокофьева</div><div class="place-price">500 ₽</div><div class="detail-afisha-top__session">1 час</div>');const row=p.parseChelPhil(detail,map(cp,listing))!;assert.equal(row.event.price.amount,500);assert(row.venue.address?.includes('92а'));assert.equal(p.parseChelPhil(detail,map(cp)),null);}
});
