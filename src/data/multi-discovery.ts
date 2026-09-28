import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CampaignClient } from './campaign.js';
import { sources,sourceOrigins,type Institution } from './source-registry.js';
import { sourceEntries } from './multi-frontier.js';
import { bodyHash,type Page,attr,tag,discover } from './institutions.js';
import { dom,walk,text,operaData,interfaceHTML,months as russianMonths } from './multi-parsers.js';
import { cityDate,cities } from './cities.js';
import { extendedLinks } from './extended-institutions.js';
import { atomicJson } from './institution-http.js';

export function cachedPages(client:CampaignClient):Map<string,Page>{return new Map([...new Set(client.ledger.requests.filter(r=>r.outcome==='OK').map(r=>r.url))].flatMap(url=>{const p=client.cached(url);return p?[[url,p] as const]:[];}));}
export type FrontierItem={source:Institution;url:string;channel:'HTML'|'EMBEDDED_PUBLIC_INTERFACE';reason:string;outcome?:string};
const detailPatterns:Partial<Record<Institution,RegExp>>={
 'spb-philharmonia':/^\/afisha\/\d+\/$/,novat:/^\/afisha\/(?:performances\/detail|excursions\/detail)\/\d+\/$/,
 'spb-opera':/^\/repertuar\/[^/]+\//,operann:/^\/afisha\/[^/?]+$/,'samara-opera':/^\/(?:\d+|repertoire|our_guests)\/(?:concert|ballet|opera)\d+\.html$/,
 permopera:/^\/playbills\/playbill\/\d{4}-\d{2}-\d{2}-[^/]+\/$/,'chel-philharmonia':/^\/afisha\/\d+[^/]*\/$/,
 bashopera:/^\/repertoire\/[^/]+\/\d+\/$/,krasfil:/^\/events\/\d+$/,filarm:/^\/afisha\/concert\d+\.html$/,meloman:/^\/(?:concert|hall)\/[^/]+\/$/,
 'spb-library':/^\/events\/detail.php$/,'spb-museum':/^\/exhibits_and_exhibitions\/(?:temporary_exhibitions|permanent_displays)\/\d+\/$/,
 'nn-art':/^\/(?:vystavki\/\d+|postoyannye-expozitzii\/[^/]+)\/$/,'samara-library':/^\/afisha\/num\/\d+$/,
 'perm-museum':/^\/event\/\d+$/,'chel-museum':/^\/(?:exhibitions|events)\/[^/]+\/$/,
 'perm-library':/^\/events\/[^/]+\/?$/,
 'nsk-library':/^\/afisha\/events\/\d+\/$/,'chel-library':/^\/ru\/events\/\d+\/$/,
};
export function discoverMulti(pages:Map<string,Page>,now:string,ids:Institution[]):FrontierItem[]{const jobs=new Map<string,FrontierItem>();
 const add=(source:Institution,url:string,reason:string,channel:FrontierItem['channel']='HTML')=>{try{const u=new URL(url);u.hash='';if(!sourceOrigins(source).includes(u.origin)||u.protocol!=='https:')return;jobs.set(u.href,{source,url:u.href,channel,reason});}catch{}};
 for(const source of ids){for(const url of sourceEntries(source))add(source,url,'ENTRY');const base=sources[source].origin,today=cityDate(now,cities[sources[source].city].timezone),end=new Date(Date.parse(today+'T00:00Z')+60*86400000).toISOString().slice(0,10);
  const months=[...new Set(Array.from({length:60},(_,i)=>new Date(Date.parse(today+'T00:00Z')+i*86400000).toISOString().slice(0,7)))];
  if(source==='permopera')for(const month of months)add(source,base+'/playbills/playbill/?month='+month+'-01&json=1','PUBLIC_MONTH_FILTER','EMBEDDED_PUBLIC_INTERFACE');
  if(source==='spb-library')for(let i=0;i<60;i++)add(source,base+'/events/showEventsList.php?useFilter=Y&categories=&addresses=&date='+new Date(Date.parse(today+'T00:00Z')+i*86400000).toISOString().slice(0,10),'PUBLIC_DATE_FILTER','EMBEDDED_PUBLIC_INTERFACE');
  for(const p of pages.values()){if(!sourceOrigins(source).includes(new URL(p.url).origin)||p.url.endsWith('/robots.txt')||/\.js(?:\?|$)/.test(p.url))continue;
   const html=interfaceHTML(p);
   const d=dom(html);
   if(source==='kazan-kremlin'||source==='mie'){for(const u of discover(p,source))add(source,u,'LINKED_EVENT');}
   if(['tatmuseum','uralopera','sgaf'].includes(source))for(const u of extendedLinks(p,source,now,60))add(source,u,'LINKED_EVENT');
   for(const n of d){let u:URL;try{u=new URL(attr(n,'href').trim(),p.url);}catch{continue;}
    if(detailPatterns[source]?.test(u.pathname)){
     if(source==='perm-library'&&!/\/events\/(afisha|exhibitions)\//.test(new URL(p.url).pathname))continue;
     if(source==='nn-art'&&/ЗАВЕРШЕНО/.test(text(n)))continue;
     if(source==='meloman'&&u.pathname.startsWith('/concert/')){const date=u.pathname.match(/20\d{2}-\d{2}-\d{2}/)?.[0];if(date&&(date<today||date>=end))continue;}
     add(source,u.href,'LINKED_EVENT_OR_VENUE');
    }
    if(source==='krasfil'&&u.pathname==='/events'&&u.searchParams.has('page'))add(source,u.href,'PUBLISHED_NEXT_PAGE');
    if(source==='novat'&&/^\/afisha\/performances\/20\d{2}\/\d+\/$/.test(u.pathname)&&months.some(m=>m===u.pathname.split('/')[3]+'-'+u.pathname.split('/')[4]!.padStart(2,'0')))add(source,u.href,'PUBLISHED_MONTH');
    if(source==='chel-library'&&u.pathname==='/ru/events/'&&u.searchParams.has('page'))add(source,u.href,'PUBLISHED_NEXT_PAGE');
    if(source==='nn-library'&&new URL(p.url).pathname==='/'&&!new URL(p.url).search&&u.searchParams.has('p')&&/план.+мероприятий/iu.test(text(n))&&months.some(month=>text(n).toLowerCase().includes(russianMonths[Number(month.slice(5))-1]!)&&text(n).includes(month.slice(0,4))))add(source,u.href,'PUBLISHED_MONTH_PLAN');
    if(source==='spb-philharmonia'){
      if(u.pathname==='/afisha/'&&u.searchParams.has('month')&&months.some(m=>m===u.searchParams.get('year')+'-'+String(u.searchParams.get('month')).padStart(2,'0')))add(source,u.href,'PUBLISHED_MONTH');
      const ajax=attr(n,'ajax');if(ajax)add(source,new URL(ajax,p.url).href,'PUBLISHED_NEXT_PAGE','EMBEDDED_PUBLIC_INTERFACE');
    }
    if(tag(n)==='a'&&/контакт|реквизит|стоимость|режим работы|правила посещения|наши залы/iu.test(text(n))&&!/archive|\/en\/|login|account/.test(u.pathname))add(source,u.href,'LINKED_SUPPORT');
   }
   if(source==='operann'){const data=operaData(p);if(data?.links?.next?.href)add(source,data.links.next.href,'PUBLISHED_NEXT_PAGE','EMBEDDED_PUBLIC_INTERFACE');}
  }
 }
 return [...jobs.values()];
}

export async function collectMulti(client:CampaignClient,now:string,ids:Institution[]){const path=resolve(client.root,'frontier.json');const previous=new Map<string,FrontierItem>();
 try{for(const r of JSON.parse(readFileSync(path,'utf8')).items as FrontierItem[])previous.set(r.url,r);}catch{}
 let stopped=false;
 for(let depth=0;depth<100&&!stopped;depth++){
  const jobs=discoverMulti(cachedPages(client),now,ids);for(const j of jobs)if(!previous.has(j.url))previous.set(j.url,j);
  const selected=new Set(jobs.map(j=>j.url));
  const pending=[...previous.values()].filter(j=>ids.includes(j.source)&&selected.has(j.url)&&!client.cached(j.url)&&!j.outcome);
  if(!pending.length)break;
  // Блоки по 48 целей: ограниченная память и постоянные контрольные точки.
  const queues=ids.map(id=>pending.filter(j=>j.source===id)),batch:FrontierItem[]=[];
  while(batch.length<48&&queues.some(q=>q.length))for(const q of queues)if(q.length&&batch.length<48)batch.push(q.shift()!);
  await Promise.all(batch.map(async j=>{try{await client.get(j.url);j.outcome='OK';}catch(e){const error=e instanceof Error?e.message:'FAILED';if(error==='ACQUISITION_BOUNDARY')stopped=true;else j.outcome=error;}}));
  atomicJson(path,{version:1,scopeStart:now,horizonDays:60,items:[...previous.values()],stopped,parserVersion:'multi-institution/1'});
 }
 for(const j of previous.values())if(client.cached(j.url))j.outcome='OK';
 atomicJson(path,{version:1,scopeStart:now,horizonDays:60,items:[...previous.values()],stopped,parserVersion:'multi-institution/1'});return {stopped,items:[...previous.values()]};
}
