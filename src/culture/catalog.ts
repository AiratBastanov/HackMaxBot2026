import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateSnapshot, type Snapshot } from '../data/contract.js';
import { sourceReviews } from '../data/reviews.js';
import type { Config } from '../config.js';
import type { CityKey } from '../data/cities.js';
import { reviewSchema, reviewedSnapshot, permittedRefs, snapshotDigest, type Review, type DisplayRef } from '../data/source-policy.js';
import { institutionIds } from '../data/source-registry.js';

export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
// Единственная граница чтения снимка. Замена целиком, без сети/SQLite и изменения дат.
export class Catalog {
  private value: Snapshot | null = null;
  private values = new Map<CityKey, Snapshot>();
  private shards:Snapshot[]=[];
  private hash = digest(null);
  readonly review:Review|null;
  constructor(readonly mode: Config['flowDataMode'], input: unknown = null, review:unknown = null,private readonly publicOnly=false) {
    this.review=review===null?null:reviewSchema.parse(review); this.replace(input);
  }
  permits(refs:DisplayRef[]|undefined,now:number,publicOnly=this.publicOnly) {return permittedRefs(this.shards,this.review,refs,now,publicOnly);}
  usableCities(now:number) {return [...new Set(this.shards.filter(s=>s.mode!=='REAL_CATALOG'||reviewedSnapshot(s,this.review,now,this.publicOnly)).map(s=>s.scope.city))];}
  get snapshots():readonly Snapshot[]{return this.shards;}
  displayRef(eventId:string):DisplayRef|undefined {const shard=this.shards.find(s=>s.events.some(e=>e.id===eventId));return shard?{snapshotHash:snapshotDigest(shard),eventId}:undefined;}
  selectionForCity(city:CityKey,now:number){const shards=this.shards.filter(s=>s.scope.city===city&&(s.mode!=='REAL_CATALOG'||reviewedSnapshot(s,this.review,now,this.publicOnly)));return shards.length?mergeCity(shards):null;}
  get snapshot() { return this.value; }
  get version() { return this.hash; }
  forCity(city: CityKey) { return this.values.get(city) ?? null; }
  get availableCities() { return [...this.values.keys()]; }
  get requiresReview() {return [...this.values.values()].some(s=>s.mode==='REAL_CATALOG');}
  replace(input: unknown) {
    const bundle = input && typeof input === 'object' && 'snapshots' in input ? (input as {snapshots: unknown}).snapshots : input === null ? [] : [input];
    if (!Array.isArray(bundle) || bundle.length > institutionIds.length) throw new Error('CATALOG_BUNDLE');
    const next = bundle.map(validateSnapshot);
    if (next.some(s => (s.mode === 'SYNTHETIC_FIXTURE') !== (this.mode === 'synthetic-test'))) throw new Error('CATALOG_MODE_MISMATCH');
    const ownership=new Set<string>();
    for(const s of next)for(const source of new Set(s.events.map(e=>e.provider))){const key=s.scope.city+':'+source;if(ownership.has(key))throw new Error('CATALOG_DUPLICATE_CITY');ownership.add(key);}
    this.shards=next.map(s=>freeze(s));
    this.values = new Map([...new Set(next.map(s=>s.scope.city))].map(city=>[city,freeze(mergeCity(this.shards.filter(s=>s.scope.city===city)))]));
    this.value = this.values.get('kzn') ?? next[0] ?? null; this.hash = digest({ next, sourceReviews, review:this.review });
  }
  static load(config: Config) {
    if (!config.snapshotPath) return new Catalog(config.flowDataMode);
    try {
      if (statSync(config.snapshotPath).size > 16 * 1024 * 1024) throw new Error('CATALOG_SIZE');
      let input=JSON.parse(readFileSync(config.snapshotPath,'utf8')),reviewPath=config.reviewPath;
      if(input?.version===1&&typeof input.snapshot==='string'&&typeof input.review==='string') {
        if(!/^[a-f0-9]{20}\.json$/.test(input.snapshot)||input.review!==input.snapshot.replace('.json','.review.json'))throw Error('CATALOG_POINTER');
        const root=dirname(config.snapshotPath),path=resolve(root,input.snapshot);reviewPath=resolve(root,input.review);
        if(statSync(path).size>16*1024*1024)throw Error('CATALOG_SIZE');input=JSON.parse(readFileSync(path,'utf8'));
      }
      if(reviewPath&&statSync(reviewPath).size>65536)throw Error('CATALOG_REVIEW_SIZE');
      const review=reviewPath?JSON.parse(readFileSync(reviewPath,'utf8')):null;
      return new Catalog(config.flowDataMode,input,review,config.admissionMode==='PUBLIC');
    } catch (e) {
      if (e instanceof Error && e.message === 'CATALOG_MODE_MISMATCH') throw e;
      return new Catalog(config.flowDataMode); // Ошибка/отсутствие — недоступность, никогда не synthetic fallback.
    }
  }
}

// Агрегация только в памяти для существующего чистого selection. Допуск и ссылки
// карточек по-прежнему относятся к исходным неизменяемым reviewed shards.
function mergeCity(shards:readonly Snapshot[]):Snapshot {
  if(shards.length===1)return shards[0]!;
  const first=shards[0]!,events=shards.flatMap(s=>s.events),venues=[...new Map(shards.flatMap(s=>s.venues).map(v=>[v.id,v])).values()];
  return {...first,scope:{...first.scope,start:shards.map(s=>s.scope.start).sort()[0]!,end:shards.map(s=>s.scope.end).sort().at(-1)!,categories:[...new Set(shards.flatMap(s=>s.scope.categories))]},
    retrievedAt:shards.map(s=>s.retrievedAt).sort()[0]!,outcome:'PARTIAL',paginationComplete:false,venueCoverageComplete:false,
    events,venues,stats:{...first.stats,providerCount:null,retrievedRows:shards.reduce((n,s)=>n+s.stats.retrievedRows,0),uniqueProviderIds:events.length,duplicateIds:shards.reduce((n,s)=>n+s.stats.duplicateIds,0),pages:shards.reduce((n,s)=>n+s.stats.pages,0),normalizedEvents:events.length,occurrences:events.reduce((n,e)=>n+e.occurrences.length,0),venues:venues.length}};
}
