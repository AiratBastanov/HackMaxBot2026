import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { subscribedTypes } from './contracts.js';
import type { LiveMax } from './max.js';

// Одна явная административная попытка. Обычный startup этот модуль не вызывает.
export async function subscribeTestEndpoint(max:Pick<LiveMax,'me'|'subscriptions'|'subscribe'>,endpoint:string,
  exclusive:boolean,journalDirectory:string,report:(record:object)=>void=()=>{}) {
  const bot=await max.me(),before=await max.subscriptions();
  if(before.length) throw Error(before.length===1&&before[0]!.url===endpoint?'EXISTING_SUBSCRIPTION_REQUIRES_SPECIFIC_DECISION':'SUBSCRIPTION_OWNERSHIP_AMBIGUOUS');
  if(!exclusive) throw Error('EXCLUSIVE_CONSUMER_NOT_CONFIRMED');
  const dir=resolve(journalDirectory),root=realpathSync(process.cwd());
  if(!['.review','runtime'].includes(relative(root,dir).split(sep)[0]!)) throw Error('SUBSCRIPTION_PRIVATE_JOURNAL_REQUIRED');
  mkdirSync(dir,{recursive:true});if(relative(root,realpathSync(dir)).startsWith('..')) throw Error('SUBSCRIPTION_JOURNAL_ESCAPE');
  const file=resolve(dir,`${bot.user_id}-${createHash('sha256').update(endpoint).digest('hex').slice(0,16)}.json`);
  const record={botId:bot.user_id,createdAt:new Date().toISOString(),state:'ATTEMPTED'};
  try {writeFileSync(file,JSON.stringify(record),{flag:'wx',mode:0o600});} catch {throw Error('SUBSCRIPTION_PRIOR_ATTEMPT_OR_JOURNAL_UNAVAILABLE');}
  try {
    await max.subscribe(endpoint,subscribedTypes);
    const after=await max.subscriptions();
    if(after.length!==1||after[0]!.url!==endpoint||!after[0]!.update_types||subscribedTypes.some(type=>!after[0]!.update_types!.includes(type))) throw Error('SUBSCRIPTION_NOT_CONFIRMED');
    writeFileSync(file,JSON.stringify({...record,state:'CONFIRMED'}));
    report({operation:'subscribe',apiResult:'SUCCESS',incomingEvents:'NOT_VERIFIED'});
  } catch(error) {
    // В том числе crash после POST оставляет ATTEMPTED. Повтор требует отдельного решения оператора.
    const after=await max.subscriptions().catch(()=>null);
    const status={operation:'subscribe_reconcile',readResult:after?'OBSERVED':'UNAVAILABLE',designatedEndpointPresent:after?.some(s=>s.url===endpoint)??null,mutationResult:'NOT_CONFIRMED',retry:'REQUIRES_OPERATOR_RECONCILIATION'};
    writeFileSync(file,JSON.stringify({...record,state:'RECONCILIATION_REQUIRED',...status}));report(status);throw error;
  }
}
