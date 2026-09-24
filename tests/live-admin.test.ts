import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, loadInspectionConfig } from '../src/config.js';
import { ReadOnlyMax, LiveMax } from '../src/max.js';
import { createApp } from '../src/app.js';
import { ACTOR, SECRET } from './fixtures.js';
import { subscribeTestEndpoint } from '../src/subscription.js';
import { subscribedTypes } from '../src/contracts.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

test('Read-only identity доступна без endpoint, БД, webhook secret и testers; до pin только GET',async()=>{
  const config=loadInspectionConfig({MAX_BOT_TOKEN:'synthetic-only-token-123',MAX_INSPECTION_SCOPE_CONFIRMED:'true'});
  const calls:string[]=[];
  const client=new ReadOnlyMax(config,(async(url,init)=>{
    assert.equal(init?.method,'GET');calls.push(String(url));
    return new Response(String(url).endsWith('/me')?'{"user_id":777,"first_name":"Синтетический бот","is_bot":true}':'{"subscriptions":[]}');
  }) as typeof fetch);
  assert.equal((await client.me()).user_id,'777');assert.deepEqual(await client.subscriptions(),[]);assert.equal(calls.length,2);
  await assert.rejects(client.me('778'),{kind:'AUTH'});
  assert.throws(()=>loadInspectionConfig({MAX_BOT_TOKEN:'synthetic-only-token-123'}),/SCOPE/);
});
test('Runtime identity pinned и live synthetic запрещает фиксированные часы/открытие display',async()=>{
  const env={APP_MODE:'live',DATABASE_PATH:':memory:',MAX_WEBHOOK_SECRET:SECRET,PROBE_TESTER_IDS:ACTOR,MAX_BOT_TOKEN:'synthetic-only-token-123',MAX_EXPECTED_BOT_ID:'777',PUBLIC_BASE_URL:'https://test.example.org',LIVE_SCOPE_CONFIRMED:'true',FLOW_DATA_MODE:'synthetic-test'};
  assert.throws(()=>loadConfig({...env,FLOW_TEST_CLOCK:'2030-04-05T06:00:00Z'}),/FLOW_TEST_CLOCK/);
  assert.throws(()=>loadConfig({...env,PUBLIC_DISPLAY:'CLEARED'}),/PUBLIC_DISPLAY/);
  const config=loadConfig(env);
  assert.throws(()=>createApp(config,{clock:()=>1}),/CLOCK/);
  await assert.rejects(new LiveMax(config,(async()=>new Response('{"user_id":778,"first_name":"Другой бот","is_bot":true}')) as typeof fetch).me(),{kind:'AUTH'});
});
test('Подписка сохраняет чужого/неясного consumer; неизвестный результат сверяется GET и блокирует повтор POST',async t=>{
  const root=resolve('.review/subscription-tests');mkdirSync(root,{recursive:true});const dir=mkdtempSync(resolve(root,'case-'));
  t.after(()=>{assert(dir.startsWith(root+sep));rmSync(dir,{recursive:true});});
  let posts=0,reads=0;let subscriptions:Awaited<ReturnType<LiveMax['subscriptions']>>=[];
  const max:Pick<LiveMax,'me'|'subscriptions'|'subscribe'>={me:async()=>({user_id:'777',is_bot:true,first_name:'Синтетика'}),subscriptions:async()=>{reads++;return subscriptions;},subscribe:async()=>{posts++;throw Error('TIMEOUT_AMBIGUOUS');}};
  const endpoint='https://test.example.org/webhooks/max';
  for(const url of ['https://unrelated.example.org/private',endpoint]) {subscriptions=[{url,time:1,update_types:[]}];await assert.rejects(subscribeTestEndpoint(max,endpoint,true,dir));}
  assert.equal(posts,0);subscriptions=[];await assert.rejects(subscribeTestEndpoint(max,endpoint,false,dir),/EXCLUSIVE/);
  const before=reads;await assert.rejects(subscribeTestEndpoint(max,endpoint,true,dir),/TIMEOUT/);assert.equal(reads-before,2);assert.equal(posts,1);
  await assert.rejects(subscribeTestEndpoint(max,endpoint,true,dir),/PRIOR_ATTEMPT/);assert.equal(posts,1);
  const successDir=resolve(dir,'success');max.subscribe=async()=>{posts++;subscriptions=[{url:endpoint,time:1,update_types:subscribedTypes}];};
  await subscribeTestEndpoint(max,endpoint,true,successDir);assert.equal(posts,2);
});
