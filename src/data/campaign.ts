import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { InstitutionClient, atomicJson, robotsAllows, type Acquisition, type FetchRow } from './institution-http.js';
import { sources,sourceOrigins,type Institution } from './source-registry.js';
import { bodyHash, type Page } from './institutions.js';

export const campaignLimits={requests:4000,bytes:1_000_000_000,wallMs:90*60_000,waveMs:30*60_000,concurrency:6,spacingMs:2000,deadlineMs:20_000,bodyBytes:8*1024*1024} as const;
// Консервативно соблюдаем максимальную опубликованную задержку всех групп robots.
export const robotsSpacing=(body:string)=>Math.max(2,...[...body.matchAll(/^\s*crawl-delay:\s*(\d+(?:\.\d+)?)/gim)].map(m=>Number(m[1])));
type Ledger=Acquisition & {version?:2;limits?:typeof campaignLimits;waves?:{startedAt:string;finishedAt?:string;elapsedMs:number}[];blocked?:Record<string,string>;corrections?:{at:string;url:string;reason:string}[]};
export function recoverInterruptedCampaign(root:string){const lock=resolve(root,'campaign.lock');if(!existsSync(lock))return;
 const pid=Number(readFileSync(lock,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('LOCK_OWNER_REVIEW');
 try{process.kill(pid,0);throw Error('CAMPAIGN_OWNER_ALIVE');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
 const path=resolve(root,'acquisition.json'),ledger=JSON.parse(readFileSync(path,'utf8')) as Ledger,now=new Date().toISOString();
 for(const row of ledger.requests)if(row.outcome==='STARTED'){row.outcome='INTERRUPTED_BODY_CHARGED_AT_LIMIT';row.finishedAt=now;ledger.bytes+=Math.max(0,campaignLimits.bodyBytes-row.bytes);row.bytes=campaignLimits.bodyBytes;}
 for(const wave of ledger.waves??[])if(!wave.finishedAt){wave.finishedAt=now;wave.elapsedMs=Math.max(wave.elapsedMs,Date.parse(now)-Date.parse(wave.startedAt));}
 ledger.networkMs=(ledger.waves??[]).reduce((n,w)=>n+w.elapsedMs,0);ledger.corrections??=[];ledger.corrections.push({at:now,url:'https://localhost.invalid/',reason:'RECOVER_DEAD_OWNER: прерванная волна учтена до восстановления; незавершённые ответы — по верхней границе, без сброса бюджета.'});atomicJson(path,ledger);unlinkSync(lock);
}
export function publicAddress(ip:string) {
  if(ip.includes(':'))return /^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:db8:/i.test(ip);
  const a=ip.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<256)
    && ![0,10,127].includes(a[0]!)&&a[0]!<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]!>=16&&a[1]!<=31)
    &&!(a[0]===192&&(a[1]===168||a[1]===0))&&!(a[0]===100&&a[1]!>=64&&a[1]!<=127)&&!(a[0]===198&&[18,19].includes(a[1]!));
}
export function campaignUrl(value:string) {
  const u=new URL(value);const canonical=(Object.keys(sources) as Institution[]).flatMap(sourceOrigins).some(origin=>[new URL(origin).hostname,new URL(origin).hostname.replace(/^www\./,'')].includes(u.hostname));
  if(!canonical||u.protocol!=='https:'||u.port||u.username||u.password||u.hash||value.length>2000)throw Error('SOURCE_URL_DENIED');return u;
}
// curl получает закреплённый публичный DNS-адрес, сохраняет SNI и обычную проверку TLS.
// Ни cookies, ни auth, ни выполняемые сценарии страницы не используются.
async function request(url:URL,form?:string):Promise<{status:number;headers:Headers;body:Buffer}> {
  let dnsTimer:ReturnType<typeof setTimeout>|undefined;
  const began=Date.now();const addresses=await Promise.race([lookup(url.hostname,{all:true}),new Promise<never>((_,reject)=>{dnsTimer=setTimeout(()=>reject(Error('TIMEOUT')),campaignLimits.deadlineMs);})]).finally(()=>clearTimeout(dnsTimer));if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('PRIVATE_NETWORK_DENIED');
  const ip=addresses.find(a=>a.family===4)?.address??addresses[0]!.address;
  return new Promise((ok,fail)=>{
    const interfaceHeaders=url.hostname==='permopera.ru'&&url.searchParams.get('json')==='1'?['--header','X-Requested-With: XMLHttpRequest']:[];
    const child=spawn(process.platform==='win32'?'curl.exe':'curl',['--disable','--silent','--show-error','--proto','=https','--max-time','20','--connect-timeout','15','--max-filesize',String(campaignLimits.bodyBytes),'--compressed','--include','--resolve',`${url.hostname}:443:${ip.includes(':')?'['+ip+']':ip}`,'--user-agent','CulturalPlan-Research/2.0','--header','Accept: text/html,application/json,text/plain,application/xml,application/pdf',...interfaceHeaders,...(form?['--request','POST','--header','Content-Type: application/x-www-form-urlencoded','--data-raw',form]:[]),'--url',url.href],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    const chunks:Buffer[]=[];let size=0,overflow=false;child.stderr.resume();
    child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>campaignLimits.bodyBytes+65536){overflow=true;child.kill();}else chunks.push(b);});
    const timer=setTimeout(()=>child.kill(),Math.max(1,campaignLimits.deadlineMs-(Date.now()-began)));child.on('error',()=>{clearTimeout(timer);fail(Error('TRANSPORT_UNAVAILABLE'));});
    child.on('close',code=>{clearTimeout(timer);const raw=Buffer.concat(chunks);if(overflow)return fail(Object.assign(Error('BODY_LIMIT'),{bytes:size}));
      if(code!==0)return fail(Object.assign(Error(code===28?'TIMEOUT':'NETWORK_FAILURE'),{bytes:size}));
      let offset=0,status=0,headers=new Headers();
      for(let i=0;i<4;i++){const end=raw.indexOf('\r\n\r\n',offset);if(end<0||end-offset>65536)return fail(Error('HTTP_HEADERS'));
        const lines=raw.subarray(offset,end).toString('latin1').split('\r\n');status=Number(lines.shift()?.match(/^HTTP\/\S+ (\d{3})/)?.[1]);headers=new Headers();
        for(const line of lines){const at=line.indexOf(':');if(at>0)headers.append(line.slice(0,at),line.slice(at+1).trim());}offset=end+4;
        if(!(status===100||status===200&&raw.subarray(offset,offset+5).toString()==='HTTP/'))break;
      }
      if(!Number.isInteger(status)||status<200||status>599)return fail(Error('HTTP_STATUS'));ok({status,headers,body:raw.subarray(offset)});
    });
  });
}

// Один владелец ledger на кампанию. Несколько CLI не могут сбросить/раздвоить бюджет.
// Очереди по host + общий semaphore; cache не обновляет fetchedAt.
export class CampaignClient extends InstitutionClient {
  declare readonly ledger:Ledger;
  private readonly lock:string;private readonly fd:number;private closed=false;
  private readonly hosts=new Map<string,Promise<unknown>>();private active=0;private waiters:(()=>void)[]=[];
  private readonly forms=new Map<string,string>();
  private readonly runStarted=Date.now();private readonly initialRequests:number;
  private wave:{startedAt:string;finishedAt?:string;elapsedMs:number}|undefined;
  constructor(root:string,private readonly bounds?:{wallMs:number;requests:number;cacheAgeMs:number}){super(root);this.initialRequests=this.ledger.requests.length;this.lock=resolve(root,'campaign.lock');
    if(bounds&&(!Number.isFinite(bounds.wallMs)||bounds.wallMs<20_000||bounds.wallMs>campaignLimits.waveMs||!Number.isInteger(bounds.requests)||bounds.requests<1||bounds.requests>campaignLimits.requests||!Number.isFinite(bounds.cacheAgeMs)||bounds.cacheAgeMs<=0||bounds.cacheAgeMs>72*3600000))throw Error('BOOTSTRAP_BOUNDS');
    if(this.ledger.version&&this.ledger.version!==2)throw Error('CAMPAIGN_VERSION');
    if(this.ledger.waves?.some(w=>!w.finishedAt))throw Error('INTERRUPTED_WAVE_REVIEW_REQUIRED');
    this.fd=openSync(this.lock,'wx');writeFileSync(this.fd,String(process.pid));
    this.ledger.version=2;this.ledger.limits=campaignLimits;this.ledger.waves??=[];this.ledger.blocked??={};
    // Исправление дефекта ранней версии: слово captcha в text/plain robots
    // ошибочно считалось HTML challenge. HTTP-счётчики и исходный исход сохранены.
    for(const[host,reason]of Object.entries(this.ledger.blocked))if(reason==='ACCESS_CHALLENGE'){
      const r=this.ledger.requests.filter(r=>new URL(r.url).hostname===host).at(-1);
      if(r?.url.endsWith('/robots.txt')&&r.status===200&&r.type?.startsWith('text/plain')&&r.outcome==='ACCESS_CHALLENGE'){
        this.ledger.corrections??=[];this.ledger.corrections.push({at:new Date().toISOString(),url:r.url,reason:'C01: ошибочный HTML challenge detector для text/plain robots; разрешена повторная проверка исправленным классификатором.'});delete this.ledger.blocked[host];this.save();
      }
    }
  }
  close(){if(this.closed)return;this.closed=true;if(this.wave)this.wave.finishedAt=new Date().toISOString();this.save();closeSync(this.fd);unlinkSync(this.lock);}
  private save(){if(this.wave)this.wave.elapsedMs=Date.now()-Date.parse(this.wave.startedAt);this.ledger.networkMs=this.ledger.waves!.reduce((n,w)=>n+w.elapsedMs,0);atomicJson(resolve(this.root,'acquisition.json'),this.ledger);}
  private fresh(page:Page|null){return page&&(!this.bounds||Date.now()-Date.parse(page.fetchedAt)<this.bounds.cacheAgeMs)?page:null;}
  override cached(url:string):Page|null {const page=this.fresh(super.cached(url));if(page){const actual=new URL(page.url);if(actual.searchParams.has('_catalog_request')){actual.searchParams.delete('_catalog_request');return {...page,url:actual.href};}return page;}
    const r=this.ledger.requests.filter(r=>r.url===url&&r.outcome==='ROBOTS_ABSENT').at(-1);
    if(r?.finishedAt)return this.fresh({url,body:'',hash:bodyHash(''),fetchedAt:r.finishedAt,modified:null});
    const redirect=this.ledger.requests.filter(r=>r.url===url&&r.outcome==='REDIRECT').at(-1);
    if(redirect?.location&&redirect.location!==url)return this.fresh(super.cached(new URL(redirect.location,url).href));return null;
  }
  override async get(value:string):Promise<Page>{const url=campaignUrl(value),cached=this.cached(value);if(cached)return cached;
    if(url.pathname!=='/robots.txt'){
      const robots=await this.get(url.origin+'/robots.txt');if(!robotsAllows(robots.body,url.pathname+url.search,robotsSpacing(robots.body)))throw Error('ROBOTS_DENIED');
    }
    const tail=this.hosts.get(url.hostname)??Promise.resolve();const task=tail.then(()=>this.acquire(value));this.hosts.set(url.hostname,task.catch(()=>{}));return task;
  }
  async getPublicForm(value:string,fields:Record<string,string>):Promise<Page>{const u=campaignUrl(value),form=new URLSearchParams(fields).toString();
    const allowed=u.origin===sources.meloman.origin&&u.pathname==='/project/phpfiles/web/ajax.php'&&fields.pg==='35'&&!fields.action
      ||u.origin===sources.filarm.origin&&u.pathname==='/ajax.php'&&['load_filtered_afisha_page','load_filtered_afisha_block','load_afisha_page'].includes(fields.action??'');
    if(!allowed||form.length>16000||Object.keys(fields).some(k=>/pass|cookie|auth|token|email|phone/i.test(k)))throw Error('PUBLIC_READ_FORM_DENIED');
    u.searchParams.set('_catalog_request',bodyHash(form));this.forms.set(u.href,form);return this.get(u.href);
  }
  private async acquire(value:string):Promise<Page>{const cached=this.cached(value);if(cached)return cached;const url=campaignUrl(value);
    if(this.ledger.blocked![url.hostname])throw Error(this.ledger.blocked![url.hostname]);
    if(this.active>=campaignLimits.concurrency)await new Promise<void>(r=>this.waiters.push(r));this.active++;
    try{return await this.fetchOne(url);}finally{this.active--;this.waiters.shift()?.();}
  }
  private async fetchOne(url:URL,retry=0,redirects=0):Promise<Page>{
    if(!this.wave){this.wave={startedAt:new Date().toISOString(),elapsedMs:0};this.ledger.waves!.push(this.wave);}this.save();
    const last=this.ledger.requests.filter(r=>new URL(r.url).hostname===url.hostname).at(-1);
    const robots=this.cached(url.origin+'/robots.txt');
    const spacing=robotsSpacing(robots?.body??'')*1000;
    const wait=Math.max(0,Date.parse(last?.startedAt??'1970-01-01')+spacing-Date.now());
    if(this.ledger.requests.length>=campaignLimits.requests||this.ledger.bytes+campaignLimits.bodyBytes*campaignLimits.concurrency>campaignLimits.bytes||this.ledger.networkMs!+wait+20_000>campaignLimits.wallMs||this.wave.elapsedMs+wait+20_000>campaignLimits.waveMs||this.bounds&&(this.ledger.requests.length-this.initialRequests>=this.bounds.requests||Date.now()-this.runStarted+wait+20_000>this.bounds.wallMs))throw Error('ACQUISITION_BOUNDARY');
    if(wait)await delay(wait);
    const actual=new URL(url),form=this.forms.get(url.href);if(actual.searchParams.has('_catalog_request')){if(!form)throw Error('PUBLIC_FORM_CONTEXT_REQUIRED');actual.searchParams.delete('_catalog_request');}
    const row:FetchRow&{method?:string;formHash?:string}={url:url.href,startedAt:new Date().toISOString(),outcome:'STARTED',bytes:0,...(form?{method:'POST',formHash:bodyHash(form)}:{})};this.ledger.requests.push(row);this.save();
    let next:string|undefined,transient=false,backoff=2000;
    try{const r=await request(actual,form);row.bytes=r.body.length;this.ledger.bytes+=row.bytes;row.status=r.status;row.type=r.headers.get('content-type');row.modified=r.headers.get('last-modified');row.location=r.headers.get('location');
      if([301,302,303,307,308].includes(r.status)&&row.location){if(redirects>=3)throw Error('REDIRECT_LIMIT');next=campaignUrl(new URL(row.location,url).href).href;row.outcome='REDIRECT';}
      else if([404,410].includes(r.status)&&url.pathname==='/robots.txt'){row.outcome='ROBOTS_ABSENT';}
      else if(r.status!==200){transient=[408,500,502,503,504].includes(r.status);const after=r.headers.get('retry-after');if(after)backoff=Math.max(backoff,/^\d+$/.test(after)?Number(after)*1000:Date.parse(after)-Date.now());throw Error('HTTP_'+r.status);}
      else {const pdf=r.body.subarray(0,5).toString('ascii')==='%PDF-'&&/^(application\/pdf|application\/octet-stream)(?:;|$)/i.test(row.type??'');
        if(!pdf&&!/^(text\/(html|plain|javascript|xml|calendar)|application\/(xml|json|ld\+json|(?:x-)?javascript|pdf|rss\+xml))(?:;|$)/i.test(row.type??''))throw Error('CONTENT_TYPE');
        const charset=row.type?.match(/charset=([\w-]+)/i)?.[1]??'utf-8';let body:string;try{body=pdf?r.body.toString('base64'):new TextDecoder(charset).decode(r.body);}catch{throw Error('CHARSET');}
        if(row.type?.startsWith('text/html')&&/<title>[^<]*(?:access denied|just a moment|доступ ограничен|проверка браузера|captcha)[^<]*<\/title>/i.test(body)&&body.length<20000){throw Error('ACCESS_CHALLENGE');}
        row.hash=bodyHash(body);row.file='raw/'+row.hash+'.html';writeFileSync(resolve(this.root,row.file),body);row.outcome='OK';
      }
    }catch(e){row.outcome=e instanceof Error?e.message:'NETWORK_FAILURE';if(!row.bytes&&e&&typeof e==='object'&&'bytes'in e){row.bytes=Number(e.bytes);this.ledger.bytes+=row.bytes;}
      transient ||= ['TIMEOUT','NETWORK_FAILURE'].includes(row.outcome);
      if(['HTTP_401','HTTP_403','HTTP_429','ACCESS_CHALLENGE'].includes(row.outcome))this.ledger.blocked![url.hostname]=row.outcome;
      if(!transient||retry||backoff>60000)throw Error(row.outcome);
    }finally{row.finishedAt=new Date().toISOString();this.save();}
    if(transient){if(this.bounds&&Date.now()-this.runStarted+backoff+20_000>this.bounds.wallMs)throw Error('ACQUISITION_BOUNDARY');await delay(backoff);return this.fetchOne(url,1,redirects);}
    if(next){const target=campaignUrl(next);if(target.hostname!==url.hostname)throw Error('CROSS_HOST_REDIRECT_REVIEW:'+next);
      if(target.pathname!=='/robots.txt'&&robots&&!robotsAllows(robots.body,target.pathname+target.search,robotsSpacing(robots.body)))throw Error('ROBOTS_DENIED');
      return this.fetchOne(target,0,redirects+1);}
    const page=this.cached(url.href);if(!page)throw Error('FETCH_NOT_CACHED');return page;
  }
}
