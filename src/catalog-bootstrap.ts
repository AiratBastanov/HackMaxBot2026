import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { Config } from './config.js';
import { atomicJson } from './data/institution-http.js';

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
