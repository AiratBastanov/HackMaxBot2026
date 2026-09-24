import { loadConfig } from '../src/config.js';
import { Catalog } from '../src/culture/catalog.js';
import { accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';

// Без сети/БД и без вывода значений секретов. Запускается с теми же mounts/env/UID, что app.
try {
  const config=loadConfig(process.env),catalog=Catalog.load(config);
  if(config.mode!=='live'||config.host!=='0.0.0.0'||config.flowDataMode!=='synthetic-test'||config.flowTestClock) throw Error('PREFLIGHT_MODE');
  if(!catalog.snapshot||catalog.snapshot.mode!=='SYNTHETIC_FIXTURE'||Math.abs(Date.now()-Date.parse(catalog.snapshot.retrievedAt))>3600000) throw Error('PREFLIGHT_FRESH_SYNTHETIC_REQUIRED');
  accessSync(dirname(config.databasePath),constants.W_OK);
  console.log(JSON.stringify({result:'PASS',network:false,databaseOpened:false,mode:config.mode,dataMode:config.flowDataMode,publicDisplay:'NOT_CLEARED',nonRoot:process.getuid?.()!==0,secretFilesReadable:true,snapshotReadable:true,runtimeWritable:true,binding:config.host}));
} catch {console.error(JSON.stringify({result:'FAILED',errorClass:'PREFLIGHT_CONFIGURATION_OR_MOUNTS'}));process.exitCode=1;}
