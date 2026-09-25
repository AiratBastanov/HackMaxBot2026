import { loadConfig } from '../src/config.js';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCurrentCatalog } from '../src/polling-config.js';

// Без сети/БД и без вывода значений секретов. Запускается с теми же mounts/env/UID, что app.
try {
  const config=loadConfig(process.env);
  if(config.mode!=='live'||config.ingress!=='webhook'||config.host!=='0.0.0.0'||config.flowTestClock||config.flowDataMode!=='real') throw Error('PREFLIGHT_MODE');
  if(process.getuid?.()===0) throw Error('PREFLIGHT_ROOT');
  if(!process.env.MAX_BOT_TOKEN_FILE||!process.env.MAX_WEBHOOK_SECRET_FILE)throw Error('PREFLIGHT_SECRET_FILES');
  if(process.env.PUBLIC_HOST&&new URL(config.publicBaseUrl!).hostname!==process.env.PUBLIC_HOST)throw Error('PREFLIGHT_HOST_MISMATCH');
  const catalog=loadCurrentCatalog(config);
  accessSync(dirname(config.databasePath),constants.W_OK);
  if(existsSync(config.databasePath)) accessSync(config.databasePath,constants.R_OK|constants.W_OK);
  const journal=process.env.LIVE_SUBSCRIPTION_JOURNAL_DIR;
  if(!journal)throw Error('PREFLIGHT_JOURNAL');
  const journalParent=existsSync(journal)?journal:dirname(journal);
  if(!statSync(journalParent).isDirectory())throw Error('PREFLIGHT_JOURNAL');
  accessSync(journalParent,constants.R_OK|constants.W_OK);
  if(process.env.NODE_EXTRA_CA_CERTS)accessSync(process.env.NODE_EXTRA_CA_CERTS,constants.R_OK);
  console.log(JSON.stringify({result:'PASS',network:false,databaseOpened:false,mode:config.mode,ingress:config.ingress,dataMode:config.flowDataMode,scope:catalog.review?.scope,publicDisplay:'NOT_CLEARED',catalogVersion:catalog.version,nonRoot:process.getuid?.()===undefined?'NOT_VERIFIED':true,secretFilesReadable:true,snapshotReadable:true,runtimeWritable:true,journalWritable:true,binding:config.host}));
} catch {console.error(JSON.stringify({result:'FAILED',errorClass:'PREFLIGHT_CONFIGURATION_OR_MOUNTS'}));process.exitCode=1;}
