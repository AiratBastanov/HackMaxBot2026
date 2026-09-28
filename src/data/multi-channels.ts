import { CampaignClient } from './campaign.js';
import { sources,type Institution } from './source-registry.js';
import { cityDate,cities } from './cities.js';
import { dom,by,walk,text,interfaceHTML,operaData } from './multi-parsers.js';
import { attr,tag,type Page } from './institutions.js';
import { atomicJson } from './institution-http.js';
import { resolve } from 'node:path';
import {existsSync,readFileSync} from 'node:fs';

export async function collectPublicInterfaces(client:CampaignClient,now:string,ids:Institution[]) {
 const outcomes:{source:Institution;scope:string;outcome:string;pages:number}[]=[];
 const outcomePath=resolve(client.root,'channel-outcomes.json'),previous:typeof outcomes=existsSync(outcomePath)?JSON.parse(readFileSync(outcomePath,'utf8')):[];
 await Promise.all(ids.filter(id=>['permopera','operann','spb-opera','meloman','filarm'].includes(id)).map(async source=>{
  const today=cityDate(now,cities[sources[source].city].timezone),end=new Date(Date.parse(today+'T00:00Z')+60*86400000).toISOString().slice(0,10);
  const months=[...new Set(Array.from({length:60},(_,i)=>new Date(Date.parse(today+'T00:00Z')+i*86400000).toISOString().slice(0,7)))];let pages=0;
  try{
   if(source==='permopera')for(const month of months){let url=sources.permopera.origin+'/playbills/playbill/?month='+month+'-01&json=1';
    for(let page=0;page<100;page++){const p=await client.get(url);pages++;const value=JSON.parse(p.body),d=dom(interfaceHTML(p)),dates=d.map(n=>attr(n,'data-calendar-date')).filter(Boolean);if(!value.has_next_page||dates.length&&dates.every(date=>date>=end))break;
     if(!value.next_page_url)throw Error('NEXT_PAGE_MISSING');const next=new URL(String(value.next_page_url).replace(/&#0*38;|&amp;/g,'&'),p.url);next.searchParams.set('json','1');next.searchParams.set('month',month+'-01');if(next.href===url)throw Error('PAGINATION_LOOP');url=next.href;if(page===99)throw Error('PAGINATION_SAFETY_BOUND');
    }
   }
   if(source==='operann'){let count=1;for(let page=0;page<count&&page<100;page++){const p=await client.get(sources.operann.origin+'/afisha'+(page?'?page='+page:''));pages++;const data=operaData(p);if(!Array.isArray(data?.data))throw Error('LIST_SCHEMA');count=Math.ceil(Number(data.meta?.count??20)/Number(data.meta?.per_page??20));
     const entries=data.data.flatMap((m:any)=>m.childs??[]);for(const e of entries){const date=e.date?.[0]?.value?.slice(0,10);if(date&&date>=today&&date<end&&e.url)await client.get(new URL(e.url,sources.operann.origin).href);}
     if(entries.length&&entries.every((e:any)=>e.date?.[0]?.value?.slice(0,10)>=end))break;
     if(page===99&&count>100)throw Error('PAGINATION_SAFETY_BOUND');
    }
   }
   if(source==='spb-opera')for(const month of months){const url=sources['spb-opera'].origin+'/afisha/?month='+Number(month.slice(5))+'&YEAR='+month.slice(0,4)+'&plays=1&concerts=1&tours=1&lectures=1';const p=await client.get(url);pages++;
    const links=new Set(by(dom(p),'new-affiche-item__name').map(n=>new URL(attr(n,'href'),p.url).href));for(const u of links)await client.get(u);
   }
   if(source==='meloman'){const listing=await client.get(sources.meloman.origin+'/concert/'),d=dom(listing),block=d.find(n=>attr(n,'data-block-id'));if(!block)throw Error('LIST_SCHEMA');
    for(const month of months){const form={d:attr(block,'data-block-id'),pg:'35',p:'1',datefield:'date_exec','f[0][f]':'month','f[0][v]':String(Number(month.slice(5))-1),'f[0][t]':'radio','f[0][d]':'0','f[1][f]':'year','f[1][v]':month.slice(0,4),'f[1][t]':'view','f[1][d]':'0'};
     const p=await client.getPublicForm('https://meloman.ru/project/phpfiles/web/ajax.php',form);pages++;const nodes=dom(interfaceHTML(p));if(!by(nodes,'article-ticket').length&&month>=today.slice(0,7))throw Error('EMPTY_MONTH_REVIEW');
     const halls=new Set(nodes.filter(n=>tag(n)==='a'&&attr(n,'href').trim().startsWith('/hall/')).map(n=>new URL(attr(n,'href').trim(),sources.meloman.origin).href));for(const url of halls)await client.get(url);
    }
   }
   if(source==='filarm'){let total=2;for(let page=2;page<=total&&page<=100;page++){const p=await client.getPublicForm('https://filarm.ru/ajax.php?JsHttpRequest=0-xml',{action:'load_filtered_afisha_page',div:'','q[count]':'5','q[page]':String(page),'q[is_filtered]':'false','q[month]':'','q[date_from]':'','q[date_to]':'','q[search_str]':'','q[zal]':''});pages++;const data=JSON.parse(p.body);total=Number(data.js?.pages??page);const d=dom(interfaceHTML(p)),dates=d.filter(n=>tag(n)==='a').map(n=>attr(n,'href').match(/\/scheme\/[^/]+\/(20\d{2}-\d{2}-\d{2})\//)?.[1]).filter((v):v is string=>!!v);
     if(dates.length&&dates.every(date=>date>=end))break;
     for(const n of d.filter(n=>tag(n)==='a'&&/^\/afisha\/concert\d+\.html$/.test(attr(n,'href')))){const url=new URL(attr(n,'href'),p.url).href;if(!client.cached(url))await client.get(url);}
     if(page===100&&total>100)throw Error('PAGINATION_SAFETY_BOUND');
    }
   }
   outcomes.push({source,scope:today+'..'+end,outcome:'SELECTED_60_DAY_SCOPE_EXHAUSTED',pages});
  }catch(e){outcomes.push({source,scope:today+'..'+end,outcome:e instanceof Error?e.message:'FAILED',pages});}
  atomicJson(outcomePath,[...previous.filter(p=>!outcomes.some(o=>o.source===p.source)),...outcomes]);
 }));return outcomes;
}
