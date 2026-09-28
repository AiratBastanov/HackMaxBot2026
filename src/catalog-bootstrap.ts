import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Config } from './config.js';
import { atomicJson } from './data/institution-http.js';
import { createHash } from 'node:crypto';
import { Catalog } from './culture/catalog.js';

// Установка не обновляет время наблюдения/срок review и не заменяет операторский snapshot.
export function seedCatalog(config:Pick<Config,'flowDataMode'|'snapshotPath'>) {
  if(config.flowDataMode!=='real'||!config.snapshotPath||existsSync(config.snapshotPath))return;
  if(resolve(config.snapshotPath)!==resolve('runtime/catalog/active.json'))throw Error('CATALOG_MISSING');
  const root=dirname(resolve(config.snapshotPath)),bundled=resolve('catalog/real');
  const pointer=JSON.parse(readFileSync(resolve(bundled,'active.json'),'utf8'));
  if(!/^[a-f0-9]{20}\.json$/.test(pointer.snapshot)||pointer.review!==pointer.snapshot.replace('.json','.review.json'))throw Error('CATALOG_POINTER');
  mkdirSync(root,{recursive:true});
  for(const file of [pointer.snapshot,pointer.review])copyFileSync(resolve(bundled,file),resolve(root,file));
  atomicJson(resolve(root,'active.json'),pointer);
}

// Явная операторская установка уже проверенного комплекта. Не читает БД/MAX,
// не обновляет fetchedAt/review и сохраняет прежние versioned файлы.
export function installBundledCatalog(expectedSha256:string,now=Date.now(),bundled=resolve('catalog/real'),destination=resolve('runtime/catalog')) {
  const pointer=JSON.parse(readFileSync(resolve(bundled,'active.json'),'utf8'));
  if(!/^[a-f0-9]{20}\.json$/.test(pointer.snapshot)||pointer.review!==pointer.snapshot.replace('.json','.review.json'))throw Error('CATALOG_POINTER');
  const catalog=Catalog.load({flowDataMode:'real',admissionMode:'PUBLIC',snapshotPath:resolve(bundled,'active.json')} as Config);
  if(!catalog.usableCities(now).length)throw Error('BUNDLED_CATALOG_NOT_PUBLIC_OR_STALE');
  const bytes=readFileSync(resolve(bundled,pointer.snapshot));
  if(!/^[a-f0-9]{64}$/.test(expectedSha256)||createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw Error('BUNDLED_CATALOG_HASH_MISMATCH');
  for(const file of [pointer.snapshot,pointer.review])if(existsSync(resolve(destination,file))&&!readFileSync(resolve(destination,file)).equals(readFileSync(resolve(bundled,file))))throw Error('CATALOG_VERSION_COLLISION');
  mkdirSync(destination,{recursive:true});
  for(const file of [pointer.snapshot,pointer.review])copyFileSync(resolve(bundled,file),resolve(destination,file));
  atomicJson(resolve(destination,'active.json'),pointer);
  return {installed:true,sha256:expectedSha256,cities:catalog.usableCities(now),snapshotPath:resolve(destination,pointer.snapshot),observationTimesPreserved:true};
}
