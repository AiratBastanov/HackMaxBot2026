import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchKudago,validateDownload} from '../src/data/kudago.js';
import {syntheticDownload,syntheticClock} from '../src/data/examples.js';
import {normalizeKudago} from '../src/data/normalize.js';
import {cityWindow} from '../src/data/cities.js';
import {assessParty} from '../src/data/party.js';
import {makeQuery} from '../src/culture/flow.js';

test('C16 controlled fetch uses only validated city IDs, city window and separate resume scope; no network',async()=>{
  const urls:string[]=[];const client={get:async(value:string)=>{
    urls.push(value);const url=new URL(value);
    if(url.pathname.includes('/locations/'))return{slug:'ekb',name:'Екатеринбург',timezone:'Asia/Yekaterinburg'};
    if(url.pathname.includes('/event-categories/'))return[];
    return{count:0,next:null,results:[]};
  }};
  const d=await fetchKudago(client,syntheticClock,undefined,false,'ekb');assert.equal(d.city,'ekb');assert.equal(d.window.start,'2030-04-04T19:00:00.000Z');
  assert(urls.some(u=>new URL(u).searchParams.get('location')==='ekb'));assert.equal(normalizeKudago(d).scope.city,'ekb');
  const before=urls.length;await assert.rejects(fetchKudago(client,syntheticClock,undefined,false,'https://arbitrary.invalid' as never));assert.equal(urls.length,before);
  await assert.rejects(fetchKudago(client,syntheticClock,syntheticDownload(),false,'ekb'),/RESUME_SCOPE_CHANGED/);
  assert.throws(()=>validateDownload({...d,location:{slug:'kzn',name:'Казань',timezone:'Europe/Moscow'}}));
});
test('C16 normalization retains provider age label without inventing admission or child tariff',()=>{
  const d=syntheticDownload();d.city='ekb';d.location={slug:'ekb',name:'Екатеринбург',timezone:'Asia/Yekaterinburg'};d.window=cityWindow(syntheticClock,'ekb');
  d.events.rows.forEach(e=>{e.location='ekb';e.age_restriction='12+';});d.places.rows.forEach(v=>v.location='ekb');
  const s=normalizeKudago(d,'SYNTHETIC_FIXTURE');assert(s.events.every(e=>e.providerAgeLabel==='12+'&&e.occurrences.every(o=>o.timezone==='Asia/Yekaterinburg')));
  const q=makeQuery({city:'ekb',date:'2030-04-06',from:'12:00',until:'18:00',party:{adults:1,childAges:[7]},budget:500,category:null});
  const result=assessParty(s.events[0]!,q);assert.equal(result.total,null);assert.equal(result.admission,'UNKNOWN');assert.match(result.unresolved.join(' '),/ребёнка/);
});
test('C16 supported per-adult FROM lower bound adds to known child subtotal',()=>{
  const s=normalizeKudago(syntheticDownload(),'SYNTHETIC_FIXTURE'),e=s.events[0]!;
  e.price={kind:'FROM',amount:null,lowerBound:300,currency:'RUB',applicability:'SINGLE_ADULT',evidence:'Взрослый от 300 ₽',conditions:[]};
  e.tariffs=[{audience:'CHILD',minAge:0,maxAge:17,kind:'EXACT',amount:100,lowerBound:null,currency:'RUB',applicable:true,conditions:[],evidence:null}];
  const q=makeQuery({city:'kzn',date:'2030-04-06',from:'12:00',until:'18:00',party:{adults:2,childAges:[7]},budget:500,category:null});
  const result=assessParty(e,q);assert.equal(result.lowerBound,700);assert.equal(result.knownSubtotal,100);assert.equal(result.total,null);
});
