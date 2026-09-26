import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {Catalog} from '../src/culture/catalog.js';
import {parseHermitageProgramme,parsePhilharmonic} from '../src/data/extended-institutions.js';
import {bodyHash} from '../src/data/institutions.js';
import {activate,type CandidateFile} from '../src/data/real-refresh.js';
import {snapshotDigest,publicPolicyHash} from '../src/data/source-policy.js';
import {seedCatalog} from '../src/catalog-bootstrap.js';
import type {Config} from '../src/config.js';

const c=Catalog.load({flowDataMode:'real',snapshotPath:'catalog/real/active.json',admissionMode:'PUBLIC'} as Config);
test('Public real catalog materially expanded, five reviewed sources, exact sessions distinct from exhibition periods',()=>{
 const events=c.availableCities.flatMap(city=>c.forCity(city)!.events);
 assert(events.length>=50);assert.equal(new Set(events.map(e=>e.id)).size,events.length);
 assert.equal(new Set(events.map(e=>e.provider)).size,5);
 assert(events.some(e=>e.categories.includes('education')));assert(events.some(e=>e.categories.includes('workshop')));
 assert(events.filter(e=>e.provider==='uralopera').every(e=>e.price.kind==='UNKNOWN'&&e.price.amount===null));
 assert(!events.some(e=>e.provider==='kamal'||e.provider==='kudago'||e.sourceUrl.endsWith('/6434')));
 for(const e of events){assert(publicPolicyHash(e.provider));assert(new URL(e.sourceUrl).protocol==='https:');
  for(const o of e.occurrences){if(o.kind==='FLEXIBLE_VISIT')assert(!o.start);if(o.kind==='TIMED_SESSION'){assert(o.start);assert(Date.parse(o.start)>=Date.parse(c.review!.reviewedAt));assert.equal(o.end===null,o.endBasis==='UNKNOWN');}}
 }
 assert.equal(c.usableCities(Date.parse(c.review!.reviewedAt)+1000).length,2);
 assert.equal(c.usableCities(Date.parse(c.review!.reviewedAt)+8*86400000).length,0);
});
test('Programme parser keeps year, registration, unknown end and exact performance identity',()=>{
 const body='<h1>Дни Эрмитажа-2026</h1><p>23 октября 11:00 - лекция «История». По лекционному билету. 16:00 - лекция «История». По лекционному билету. 24 октября 13:00 - премьера программы для детей и родителей «Выставка». Участие по регистрации. Адрес: Музей-заповедник «Казанский Кремль», Центр «Эрмитаж-Казань»</p>';
 const p={url:'https://kazan-kremlin.ru/news/dni-ermitazha-2026',body,hash:bodyHash(body),fetchedAt:'2026-09-26T12:00:00Z',modified:null};
 const rows=parseHermitageProgramme(p,'2026-09-26T12:00:00Z');assert.equal(rows.length,3);assert.equal(rows[0]!.event.id,rows[1]!.event.id);
 assert.notEqual(rows[0]!.event.occurrences[0]!.id,rows[1]!.event.occurrences[0]!.id);
 assert.equal(rows[2]!.event.admission.registration,'REQUIRED');assert.equal(rows[0]!.event.occurrences[0]!.end,null);
 assert.equal(parseHermitageProgramme({...p,body:body.replace('Дни Эрмитажа-2026','Дни Эрмитажа')},'2026-09-26T12:00:00Z').length,0);
});
test('Atomic activation refuses parser loss; no freshness renewal on rereading or installation',()=>{
 mkdirSync('.tmp/public-data',{recursive:true});const destination=mkdtempSync(resolve('.tmp/public-data/case-'));
 const snapshots=c.availableCities.map(city=>c.forCity(city)!);const at=Date.parse(c.review!.reviewedAt)+1000;
 const candidate:CandidateFile={version:1,builtAt:new Date(at).toISOString(),snapshots,reviewQueue:[],sourceStatus:Object.fromEntries(['kazan-kremlin','mie','uralopera','sgaf','tatmuseum'].map(s=>[s,'PARSED_CACHED_SCOPE']))};
 activate(candidate,snapshotDigest(candidate),destination,at,true);const before=readFileSync(resolve(destination,'active.json'),'utf8');
 const broken=structuredClone(candidate);const removed=broken.snapshots[0]!.events.pop()!;broken.sourceStatus[removed.provider]='PARSER_FAILED';
 assert.throws(()=>activate(broken,snapshotDigest(broken),destination,at,true));assert.equal(readFileSync(resolve(destination,'active.json'),'utf8'),before);
 const again=Catalog.load({flowDataMode:'real',snapshotPath:resolve(destination,'active.json'),admissionMode:'PUBLIC'} as Config);
 assert.equal(again.forCity('kzn')!.retrievedAt,c.forCity('kzn')!.retrievedAt);
});
