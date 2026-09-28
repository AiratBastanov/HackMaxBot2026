import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CampaignClient } from '../src/data/campaign.js';
import { privateCampaign } from '../src/data/real-refresh.js';
import { sourceEntries } from '../src/data/multi-frontier.js';
import { sources, institutionIds, type Institution } from '../src/data/source-registry.js';
import { document,tag,attr,domText } from '../src/data/institutions.js';
import { atomicJson } from '../src/data/institution-http.js';
import { dom } from '../src/data/multi-parsers.js';
import { collectPublicInterfaces } from '../src/data/multi-channels.js';
import { collectMulti } from '../src/data/multi-discovery.js';
const [directory,phase='entries',...selected]=process.argv.slice(2);if(!directory)throw Error('CAMPAIGN_REQUIRED');
const root=privateCampaign(directory),client=new CampaignClient(root);
const ids=selected.length?selected.map(v=>{if(!institutionIds.includes(v as Institution))throw Error('SOURCE');return v as Institution;}):institutionIds.filter(v=>v!=='kamal');
const outcomes:{url:string;outcome:string}[]=[];
async function get(url:string){try{const p=await client.get(url);outcomes.push({url,outcome:'OK'});return p;}catch(e){outcomes.push({url,outcome:e instanceof Error?e.message:'FAILED'});return null;}}
try{
 if(phase==='channels'){const results=await collectPublicInterfaces(client,new Date().toISOString(),ids);console.log(JSON.stringify(results));}
 else if(phase==='discover'){const results=await collectMulti(client,new Date().toISOString(),ids);console.log(JSON.stringify({stopped:results.stopped,targets:results.items.length}));}
 else if(phase==='entries')await Promise.all(ids.map(async id=>{for(const url of sourceEntries(id))await get(url);}));
 else if(phase==='urls'){const input=JSON.parse(readFileSync(resolve(root,'next-urls.json'),'utf8')) as string[];await Promise.all(input.map(get));}
 else if(phase==='forms'){
  await Promise.all([
   (async()=>{const p=client.cached('https://meloman.ru/concert/');if(!p)return;const d=dom(p),block=d.find(n=>attr(n,'data-block-id'))!;
    for(const month of [8,9,10]){const form={d:attr(block,'data-block-id'),pg:'35',p:'1',datefield:'date_exec','f[0][f]':'month','f[0][v]':String(month),'f[0][t]':'radio','f[0][d]':'0','f[1][f]':'year','f[1][v]':'2026','f[1][t]':'view','f[1][d]':'0'};try{const page=await client.getPublicForm('https://meloman.ru/project/phpfiles/web/ajax.php',form);outcomes.push({url:page.url,outcome:'OK'});}catch(e){outcomes.push({url:'https://meloman.ru/project/phpfiles/web/ajax.php',outcome:String(e)});}}
   })(),
   (async()=>{try{const p=await client.getPublicForm('https://filarm.ru/ajax.php?JsHttpRequest=0-xml',{action:'load_filtered_afisha_page',div:'','q[count]':'5','q[page]':'2','q[is_filtered]':'false','q[month]':'','q[date_from]':'','q[date_to]':'','q[search_str]':'','q[zal]':''});outcomes.push({url:p.url,outcome:'OK'});}catch(e){outcomes.push({url:'https://filarm.ru/ajax.php',outcome:String(e)});}})()
  ]);
 }
 else if(phase==='support')await Promise.all(ids.map(async id=>{
   const urls=[...new Set(client.ledger.requests.filter(r=>r.outcome==='OK'&&r.url.startsWith(sources[id].origin)&&!r.url.endsWith('/robots.txt')).map(r=>r.url))];
   const targets=new Set<string>();
   for(const url of urls){const p=client.cached(url)!;for(const n of document(p).filter(n=>tag(n)==='a')){let u:URL;try{u=new URL(attr(n,'href').trim(),p.url);}catch{continue;}u.hash='';
     if(u.origin!==sources[id].origin||!/контакт|реквизит|афиша|календарь|анонс|выставки|стоимость|режим работы|правила (посещения|продажи|использования)|использование материал/iu.test(domText(n)))continue;
     if(/archive|\/en\/|abonement|media|press|svo|news\/|login|account|bilet|ticket.*[?=]/i.test(u.pathname))continue;targets.add(u.href);
   }}for(const url of targets)await get(url);
 }));else throw Error('PHASE');
}finally{client.close();atomicJson(resolve(root,'batch-'+Date.now()+'.json'),{phase,outcomes});console.log(JSON.stringify({phase,ok:outcomes.filter(r=>r.outcome==='OK').length,errors:outcomes.filter(r=>r.outcome!=='OK'),requests:client.ledger.requests.length,bytes:client.ledger.bytes,wallMs:client.ledger.networkMs}));}
