import { resolve } from 'node:path';
import { loadPollingConfig, loadCurrentCatalog } from '../src/polling-config.js';

// Только чтение существующих credentials/admission; сети, БД и pairing здесь нет.
try {
  const config=loadPollingConfig({...process.env,FLOW_DATA_MODE:'real',DATA_SNAPSHOT_PATH:process.argv[2]??resolve('catalog/real/active.json')});
  const catalog=loadCurrentCatalog(config);
  console.log(JSON.stringify({result:'PASS',ingress:'test-polling',dataMode:'real',scope:'ADMITTED_TESTERS_FACTS',testers:config.testers.size,
    cities:catalog.availableCities,records:catalog.availableCities.reduce((n,c)=>n+catalog.forCity(c)!.events.length,0),network:false,databaseOpened:false,clock:'SYSTEM',refresh:'OPERATOR_CLI'}));
}catch(e){console.error(JSON.stringify({result:'FAIL',error:e instanceof Error?e.message:'REAL_PREFLIGHT_FAILED'}));process.exitCode=1;}
