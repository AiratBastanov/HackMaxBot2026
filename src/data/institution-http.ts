import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sources } from './source-policy.js';
import { bodyHash, type Page } from './institutions.js';

export function institutionUrl(value:string) {
  const u=new URL(value);
  if(!Object.values(sources).some(s=>s.origin===u.origin)||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search)throw Error('SOURCE_URL_DENIED');
  return u;
}
// Robots rules are collection policy only. Longest applicable rule wins; no XML entities or scripts execute.
export function robotsAllows(body:string,path:string) {
  let agents:string[]=[],rules:{agents:string[];allow:boolean;path:string}[]=[],hadRule=false;
  for(const line of body.split(/\r?\n/)) {
    const m=line.replace(/#.*/,'').trim().match(/^([\w-]+)\s*:\s*(.*)$/);if(!m)continue;
    const key=m[1]!.toLowerCase(),value=m[2]!.trim();
    if(key==='user-agent'){if(hadRule){agents=[];hadRule=false;}agents.push(value.toLowerCase());}
    else if(key==='allow'||key==='disallow'){hadRule=true;if(value)rules.push({agents:[...agents],allow:key==='allow',path:value});}
    else if(key==='crawl-delay'&&agents.some(a=>a==='*'||a==='culturalplan-research')&&Number(value)>2)throw Error('STRICTER_ROBOTS_DELAY_REVIEW');
  }
  const specific=rules.some(r=>r.agents.includes('culturalplan-research'));
  const applicable=rules.filter(r=>r.agents.includes(specific?'culturalplan-research':'*')&&new RegExp('^'+r.path.split('*').map(s=>s.replace(/[.+?^{}()|[\]\\]/g,'\\$&')).join('.*')).test(path));
  applicable.sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return applicable[0]?.allow??true;
}
export type FetchRow={url:string;startedAt:string;finishedAt?:string;status?:number;outcome:string;bytes:number;hash?:string;file?:string;type?:string|null;modified?:string|null;location?:string|null};
export type Acquisition={startedAt:string;bytes:number;requests:FetchRow[]};
export function atomicJson(path:string,value:unknown) {mkdirSync(resolve(path,'..'),{recursive:true});const temp=path+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n');renameSync(temp,path);}
export class InstitutionClient {
  readonly ledger:Acquisition;
  private tail:Promise<unknown>=Promise.resolve();
  constructor(readonly root:string,private readonly transport:typeof fetch=fetch,private readonly clock=Date.now,private readonly sleep:(ms:number)=>Promise<unknown>=delay) {
    mkdirSync(resolve(root,'raw'),{recursive:true});
    this.ledger=existsSync(resolve(root,'acquisition.json'))?JSON.parse(readFileSync(resolve(root,'acquisition.json'),'utf8')):{startedAt:new Date(clock()).toISOString(),bytes:0,requests:[]};
  }
  cached(url:string):Page|null {
    const r=this.ledger.requests.filter(r=>r.url===url&&r.outcome==='OK').at(-1);
    if(!r?.hash||!r.file||!r.finishedAt)return null;
    if(!/^raw\/[a-f0-9]{64}\.html$/.test(r.file))throw Error('CACHE_PATH');
    const body=readFileSync(resolve(this.root,r.file),'utf8');if(bodyHash(body)!==r.hash)throw Error('CACHE_HASH');
    return {url,body,hash:r.hash,fetchedAt:r.finishedAt,modified:r.modified??null};
  }
  get(url:string):Promise<Page> {const run=this.tail.then(()=>this.fetchPage(url));this.tail=run.catch(()=>{});return run;}
  private async fetchPage(value:string,redirects=0):Promise<Page> {
    const url=institutionUrl(value),cached=this.cached(value);if(cached)return cached;
    if(this.ledger.requests.some(r=>new URL(r.url).origin===url.origin&&['HTTP_401','HTTP_403','HTTP_429','NETWORK_FAILURE','401','403','429'].includes(r.outcome)))throw Error('SOURCE_ROUTE_STOPPED');
    if(url.pathname!=='/robots.txt') {
      const robots=this.cached(url.origin+'/robots.txt');
      if(!robots||!robotsAllows(robots.body,url.pathname))throw Error('ROBOTS_DENIED_OR_UNKNOWN');
    }
    const last=this.ledger.requests.filter(r=>new URL(r.url).origin===url.origin).at(-1);
    const wait=Math.max(0,Date.parse(last?.startedAt??'1970-01-01')+2000-this.clock());
    if(this.ledger.requests.length>=80||this.ledger.bytes>=40*1024*1024||this.clock()+wait+20000>Date.parse(this.ledger.startedAt)+900000)throw Error('ACQUISITION_BUDGET');
    await this.sleep(wait);
    const row:FetchRow={url:value,startedAt:new Date(this.clock()).toISOString(),outcome:'STARTED',bytes:0};this.ledger.requests.push(row);this.persist();
    let redirect:string|undefined;
    try {
      const response=await this.transport(value,{redirect:'manual',signal:AbortSignal.timeout(20000),credentials:'omit',headers:{'User-Agent':'CulturalPlan-Research/1.0',Accept:'text/html,text/plain,application/xml,application/json'}});
      row.status=response.status;row.type=response.headers.get('content-type');row.modified=response.headers.get('last-modified');row.location=response.headers.get('location');
      if([301,302,307,308].includes(response.status)&&row.location) {
        await response.body?.cancel();if(redirects>=2)throw Error('REDIRECT_LIMIT');
        redirect=institutionUrl(new URL(row.location,value).href).href;row.outcome='REDIRECT';
      } else {
        if(response.status!==200){await response.body?.cancel();throw Error('HTTP_'+response.status);}
        if(!/^(text\/(html|plain)|application\/(xml|json))(?:;|$)/i.test(row.type??'')){await response.body?.cancel();throw Error('CONTENT_TYPE');}
        const chunks:Uint8Array[]=[];const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_BODY');
        try {while(true){const part=await reader.read();if(part.done)break;row.bytes+=part.value.byteLength;this.ledger.bytes+=part.value.byteLength;
          if(row.bytes>4*1024*1024||this.ledger.bytes>40*1024*1024){await reader.cancel();throw Error('BODY_BUDGET');}chunks.push(part.value);}}
        finally{reader.releaseLock();}
        const body=Buffer.concat(chunks).toString('utf8');row.hash=bodyHash(body);row.file='raw/'+row.hash+'.html';writeFileSync(resolve(this.root,row.file),body);row.outcome='OK';
      }
    }catch(e){row.outcome=e instanceof Error&&/^[A-Z_0-9]+$/.test(e.message)?e.message:'NETWORK_FAILURE';throw Error(row.outcome);}
    finally{row.finishedAt=new Date(this.clock()).toISOString();this.persist();}
    return redirect?this.fetchPage(redirect,redirects+1):this.cached(value)!;
  }
  private persist(){atomicJson(resolve(this.root,'acquisition.json'),this.ledger);}
}
