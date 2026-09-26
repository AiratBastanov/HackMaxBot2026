import { loadConfig } from '../src/config.js';
import { acquireConsumerLock } from '../src/consumer-lock.js';
import { seedCatalog } from '../src/catalog-bootstrap.js';
import { PollingMax, verifyPolling, runPolling } from '../src/polling.js';
import { LiveMax, outboundAuthorization } from '../src/max.js';
import { Storage } from '../src/storage.js';
import { Worker } from '../src/worker.js';
import { Catalog } from '../src/culture/catalog.js';

async function main() {
  const config=loadConfig(process.env);
  seedCatalog(config);
  if(config.mode!=='live'||config.ingress!=='polling')throw Error('POLLING_PROFILE_REQUIRED');
  const release=await acquireConsumerLock(config.botId),controller=new AbortController();
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let store:Storage|undefined,worker:Worker|undefined;
  try {
    const max=new PollingMax(config);
    await verifyPolling(max,config.botId,process.env.LIVE_EXCLUSIVE_CONSUMER_CONFIRMED==='true',controller.signal);
    store=new Storage(config.databasePath,config);
    worker=new Worker(store,config,new LiveMax(config,fetch,controller.signal,outboundAuthorization(config,store)),Date.now,
      value=>console.log(JSON.stringify(value)),Catalog.load(config));
    await runPolling({max,store,config,signal:controller.signal,ready:()=>{
      worker!.start();console.log(JSON.stringify({operation:'polling_started',admission:config.admissionMode,ingress:'development-polling',stop:'SIGINT/SIGTERM'}));
    }});
  }finally {
    controller.abort();await worker?.stop();store?.close();await release();
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    console.log(JSON.stringify({operation:'polling_stopped'}));
  }
}
main().catch(e=>{console.error(JSON.stringify({operation:'polling_failure',errorClass:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'CONFIGURATION_OR_RUNTIME'}));process.exitCode=1;});
