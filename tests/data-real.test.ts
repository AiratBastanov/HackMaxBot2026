import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { extract, opening, period, bodyHash, extractKremlinNews, makeSnapshots, type Page } from '../src/data/institutions.js';
import { InstitutionClient, institutionUrl, robotsAllows } from '../src/data/institution-http.js';
import { activate, type CandidateFile } from '../src/data/real-refresh.js';
import { snapshotDigest } from '../src/data/source-policy.js';
import { assessParty } from '../src/data/party.js';
import { sourceReviews } from '../src/data/reviews.js';

const observed='2026-09-25T08:00:00.000Z';
const page=(body:string,url='https://m-i-e.ru/parser_fixture'):Page=>({url,body,hash:bodyHash(body),fetchedAt:observed,modified:null});
// Искусственная минимальная DOM-разметка теста, не опубликованный каталог или копия сайта.
const fixture=(hours='Ср, Чт: 10.00 — 19.00<br>Пт: 10.00 — 18.00<br>Сб, Вс: 11.00 — 18.00',price='Стоимость билетов: 150−300 рублей')=>page(`<title>Тест парсера (12+)</title><div class="t-cover__wrapper">25 июля - 25 октября 2026</div><li class="t822__col">Площадка<br>Дом Качки<br>ул. Карла Либкнехта, 26</li><li class="t822__col">Время работы<br>${hours}<br>Касса закрывается за час до окончания работы</li><li class="t822__col">Касса<br>${price}</li>`);
test('R17 DOM: диапазон не превращается во взрослый/детский тариф; timezone и SALES_CUTOFF отдельны',()=>{
  const {event:e}=extract(fixture(),'mie','2026-09-25');
  assert.equal(e.price.kind,'RANGE');assert.equal(e.price.amount,null);assert.equal(e.price.applicability,'UNRESOLVED');
  assert.equal(e.providerAgeLabel,'12+');assert.equal(e.admission.requirements?.minimumAge,null);
  assert.equal(e.occurrences[0]!.timezone,'Asia/Yekaterinburg');assert.equal(e.occurrences[0]!.opening![0]!.salesCutoff,1080);assert.equal(e.occurrences[0]!.opening![0]!.lastEntry,null);
  const cost=assessParty(e,{city:'ekb',start:observed,end:'2026-09-26T08:00:00Z',budgetRub:1500,category:null,zone:null,kind:'ANY',preferences:{categories:[]},party:{adults:2,childAges:[7]},budgetBasis:'PARTY_TOTAL'});
  assert.equal(cost.total,null);assert.equal(cost.admission,'UNKNOWN');
});
test('R17 календарь июня не применяется осенью; применимый источник площадки даёт собственный provenance',()=>{
  const p=fixture('В июне 2026<br>Ср, Чт: 10.00 — 19.00');
  assert.equal(extract(p,'mie','2026-09-25').event.occurrences[0]!.opening,null);
  const venue=page('площадка "Дом Качки"<br>ул. Карла Либкнехта, 26<br>Режим работы:<br>Среда, четверг: 10.00 — 19.00<br>Билеты','https://m-i-e.ru/mie-filial');
  const row=extract(p,'mie','2026-09-25',venue);assert(row.event.occurrences[0]!.opening?.length);assert.equal(row.event.observations.at(-1)!.requestUrl,venue.url);
});
test('R17 периоды с разными годами, исключение архива; календарь не создаёт ежедневные события',()=>{
  assert.deepEqual(period('17 мая 2024 – 31 декабря 2026'),{from:'2024-05-17',through:'2026-12-31'});
  assert.equal(extract(fixture(),'mie','2026-09-25').event.occurrences.length,1);
  assert.throws(()=>extract(fixture(),'mie','2027-01-01'),/OUTSIDE_SCOPE/);
  assert.equal(opening('в июне 2026 Пн 10:00-18:00','2026-10-01'),null);
});
test('R17 чужая площадка не получает источник Дома Качки; вход с улицы и второй заголовок тарифа сохранены',()=>{
  const initial=fixture(),p=page(initial.body.replace('Дом Качки','Креативный кластер «Л52»').replace('ул. Карла Либкнехта, 26','Вход с ул. Бажова, 124А').replace('Касса<br>','Стоимость билетов<br>'));
  const venue=page('площадка "Дом Качки"<br>ул. Карла Либкнехта, 26','https://m-i-e.ru/mie-filial');
  const row=extract(p,'mie','2026-09-25',venue);
  assert.equal(row.venue.sourceUrl,p.url);assert.equal(row.venue.address,'Вход с ул. Бажова, 124А');
  assert.equal(row.event.price.kind,'RANGE');assert.equal(row.event.price.upperBound,300);
});
test('R17 индивидуальный бесплатный вход, школьник не любой ребёнок, групповые тарифы не подмена',()=>{
  const p=page('<h1>Тестовый вход</h1><span class="__time">25/12/2025 — 31/12/2026</span><table><tr><td>Входной билет</td><td>Бесплатно (при индивидуальном посещении)</td></tr><tr><td>Входной билет для организованных групп</td><td>Взрослые – 200 ₽, школьники – 150 ₽</td></tr></table>','https://kazan-kremlin.ru/exhibitions/parser-fixture');
  const e=extract(p,'kazan-kremlin','2026-09-25').event;assert.equal(e.price.amount,0);assert(e.price.conditions.some(s=>s.includes('Семья')));
  const school=page(p.body.replace('Бесплатно (при индивидуальном посещении)','Взрослые – 200 ₽; школьники – 100 ₽'),p.url);
  const s=extract(school,'kazan-kremlin','2026-09-25').event;assert.equal(s.price.amount,200);assert.equal(s.tariffs?.filter(t=>t.audience==='CHILD').length,0);
});
test('R17 dated news: only explicit sessions, stable IDs, missing end stays unknown',()=>{
  const p=page('<h1>Мероприятия: 21 – 27 сентября</h1><h4>21.09.2026</h4><h3>Программы в музеях</h3><strong>Музей теста</strong><li class="ListItem">Занятие – 26, 27 сентября в 15:00</li><li class="ListItem">Иное – ежедневно в 12:00</li>','https://kazan-kremlin.ru/news/meropriyatiya-fixture');
  const a=extractKremlinNews(p,observed),b=extractKremlinNews(p,observed);assert.equal(a.length,1);assert.equal(a[0]!.event.occurrences.length,2);assert.deepEqual(a,b);assert.equal(a[0]!.event.occurrences[0]!.end,null);
  assert.equal(a[0]!.event.occurrences[0]!.start,'2026-09-26T12:00:00.000Z');
});
test('R17 robots, allowlist и redirects: deny до обращения; без private API и arbitrary origin',async()=>{
  assert.equal(robotsAllows('User-agent: *\nDisallow: /docs\nDisallow: /tilda/*\nAllow: /', '/docs'),false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /public', '/public/event'),true);
  assert.throws(()=>institutionUrl('https://m-i-e.ru@evil.example/event'));assert.throws(()=>institutionUrl('http://m-i-e.ru/'));
  const dir=mkdtempSync(resolve(tmpdir(),'maxbot-real-http-'));let calls=0;
  const transport=(async(input:unknown)=>{calls++;return String(input).endsWith('robots.txt')?new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}}):new Response('',{status:302,headers:{location:'https://evil.example/'}});}) as typeof fetch;
  const c=new InstitutionClient(dir,transport,()=>Date.parse(observed),async()=>{});
  await c.get('https://m-i-e.ru/robots.txt');await assert.rejects(c.get('https://m-i-e.ru/stone_city'),/SOURCE_URL_DENIED/);assert.equal(calls,2);
});
test('R17 cached reparse never renews fetchedAt; 403 closes route; no automatic retry',async()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'maxbot-real-cache-'));let calls=0;
  const f=(async(input:unknown)=>{calls++;return String(input).endsWith('robots.txt')?new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}}):new Response('',{status:403});}) as typeof fetch;
  const c=new InstitutionClient(dir,f,()=>Date.parse(observed),async()=>{});const first=await c.get('https://m-i-e.ru/robots.txt');
  assert.equal((await c.get('https://m-i-e.ru/robots.txt')).fetchedAt,first.fetchedAt);assert.equal(calls,1);
  await assert.rejects(c.get('https://m-i-e.ru/stone_city'),/HTTP_403/);await assert.rejects(c.get('https://m-i-e.ru/other'),/STOPPED/);assert.equal(calls,2);
});
test('R17 activate requires exact reviewed hash; failed partial cannot destroy previous active file',()=>{
  const row=extract(fixture(),'mie','2026-09-25'),snapshots=makeSnapshots([row],observed),dir=mkdtempSync(resolve(tmpdir(),'maxbot-real-activate-'));
  const c:CandidateFile={version:1,builtAt:observed,snapshots,reviewQueue:[],sourceStatus:{mie:'PARSED_CACHED_SCOPE'}};
  assert.throws(()=>activate(c,'0'.repeat(64),dir,Date.parse(observed)),/HASH/);
  activate(c,snapshotDigest(c),dir,Date.parse(observed));const before=readFileSync(resolve(dir,'active.json'),'utf8');
  const failed={...c,snapshots:[],sourceStatus:{mie:'FAILED'}};assert.throws(()=>activate(failed,snapshotDigest(failed),dir,Date.parse(observed)),/EMPTY/);assert.equal(readFileSync(resolve(dir,'active.json'),'utf8'),before);
  assert(sourceReviews.some(r=>r.eventId==='kudago:58328'));assert(sourceReviews.some(r=>r.eventId==='mie:way_to_the_dream'));
});
