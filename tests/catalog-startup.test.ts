import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {catalogStartupScenarios} from '../scripts/catalog-startup-scenarios.js';
import {refreshBootstrap,hasUsableEvents} from '../src/catalog-prepare.js';
import {bodyHash} from '../src/data/institutions.js';
import {CampaignClient} from '../src/data/campaign.js';
import {atomicJson} from '../src/data/institution-http.js';
test('Reviewed startup: fresh, upgrade/SQLite/bookmark, no downgrade, corruption, expiry, partial refresh and restart',{timeout:60000},async()=>{
  await catalogStartupScenarios('.tmp/catalog-startup-tests');
});
test('Bootstrap reparses fresh scoped cache with existing parser/review, without fetching or renewing old cache',async()=>{
  mkdirSync('.tmp/catalog-startup-tests',{recursive:true});const root=mkdtempSync(resolve('.tmp/catalog-startup-tests/cache-'));mkdirSync(resolve(root,'raw'));
  const fetchedAt=new Date().toISOString(),pages=[
    ['https://bashopera.ru/affiche/','<div class="item content" id="event_1"><div class="name"><a href="/repertoire/opera/1/">Учебная опера</a></div><div class="date">3 октября</div><div class="hall">Большой зал, 19:00</div><div class="tags">6+</div></div><footer>© 2026 Башкирский театр</footer>'],
    ['https://bashopera.ru/about/contacts/','<h1>Контакты</h1><p>Адрес: г. Уфа, ул. Ленина, 5/1</p>']
  ];
  const requests=pages.map(([url,body])=>{const hash=bodyHash(body!),file='raw/'+hash+'.html';writeFileSync(resolve(root,file),body!);return {url,hash,file,startedAt:fetchedAt,finishedAt:fetchedAt,outcome:'OK',bytes:Buffer.byteLength(body!)};});
  atomicJson(resolve(root,'acquisition.json'),{startedAt:fetchedAt,bytes:0,requests});
  const prepared=await refreshBootstrap(root,Date.now(),()=>{});assert(prepared);assert(hasUsableEvents(prepared,Date.now()));
  assert(prepared.snapshots.every(s=>s.events.every(e=>e.provider==='bashopera')));
  const client=new CampaignClient(root,{wallMs:20000,requests:1,cacheAgeMs:1});
  try{assert.equal(client.ledger.requests.length,2);assert.equal(client.cached(pages[0]![0]!),null);await assert.rejects(client.get(pages[0]![0]!),/ACQUISITION_BOUNDARY/);}finally{client.close();}
});
