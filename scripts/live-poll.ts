import { appendFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { loadPollingConfig, loadCurrentSynthetic, testerFile, testRoot } from '../src/polling-config.js';
import { acquireConsumerLock } from '../src/consumer-lock.js';
import { PollingMax, verifyPolling, openCampaign, runPolling, observeDelivery } from '../src/polling.js';
import { LiveMax, MaxError } from '../src/max.js';
import { Storage } from '../src/storage.js';
import { Worker } from '../src/worker.js';
import { PairingWindow, savePairedTester } from '../src/pairing.js';
import { publicBot } from '../src/inspection.js';
import { resolve } from 'node:path';

async function main() {
  const command = process.argv[2];
  if (command !== 'start' && command !== 'resume' && command !== 'pair') throw Error('USE_START_RESUME_OR_PAIR');
  const args=process.argv.slice(3);
  if(args.length && (command!=='start'||args.length!==2||args[0]!=='--minutes'||!['15','30'].includes(args[1]!))) throw Error('USE_START_WITH_MINUTES_15_OR_30');
  // Только явный новый start; resume никогда не продлевает исходный deadline.
  const minutes=(args.length?Number(args[1]):15) as 15|30;
  if (command === 'pair' && (!process.stdin.isTTY || !process.stdout.isTTY)) throw Error('PAIRING_REQUIRES_OPERATOR_TERMINAL');
  const config = loadPollingConfig(process.env, command === 'pair');
  const catalog = loadCurrentSynthetic(config);
  const release = await acquireConsumerLock(config.botId);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  let store: Storage | undefined, worker: Worker | undefined, timer: NodeJS.Timeout | undefined;
  try {
    const max = new PollingMax(config);
    const bot = await verifyPolling(max,config.botId,process.env.LIVE_EXCLUSIVE_CONSUMER_CONFIRMED==='true',controller.signal);
    console.log(JSON.stringify({operation:'polling_identity',...publicBot(bot),subscriptions:'EMPTY'}));
    store = new Storage(config.databasePath, config);
    const campaign = openCampaign(store,command,catalog.version,Date.now(),minutes);
    timer = setTimeout(stop,Math.max(0,campaign.deadline-Date.now()));
    mkdirSync(testRoot,{recursive:true});
    const report = (value: object) => {
      const line = JSON.stringify({at:new Date().toISOString(),...value});
      appendFileSync(resolve(testRoot,`session-${campaign.id}.jsonl`),line+'\n');console.log(line);
      if(observeDelivery(store!,campaign,value)) controller.abort();
    };
    report({operation:'SESSION_LIMITS',deadline:new Date(campaign.deadline).toISOString(),maxPollingRequests:120,requestsUsed:campaign.requests});
    const pairing = command==='pair' ? new PairingWindow(config.botId) : undefined;
    // Worker работает независимо от ожидающего long poll; при pairing его вообще нет.
    worker = pairing ? undefined : new Worker(store,config,new LiveMax(config,fetch,controller.signal),Date.now,report,catalog);
    const actor = await runPolling({max,store,config,campaign,signal:controller.signal,pairing,report,ready:()=>{
      if(pairing) {
        console.log('READY_FOR_PAIRING: отправьте в этот бот ровно следующую строку. Код действует до двух минут, только один раз:');
        console.log(`/pair ${pairing.code}`); // Только интерактивный терминал, не evidence/log.
      } else { worker!.start(); report({operation:'READY_FOR_TESTER_ACTION',message:'Теперь отправьте /start. Данные вымышленные.'}); }
    }});
    if(pairing && actor && !controller.signal.aborted) {
      const terminal=createInterface({input:process.stdin,output:process.stdout});
      try {
        const answer=await terminal.question('Код получен. Подтвердите лично, что его отправил ожидаемый согласившийся тестировщик. Введите ПОДТВЕРЖДАЮ: ',{signal:controller.signal});
        savePairedTester(config.botId,pairing.confirm(answer.trim()==='ПОДТВЕРЖДАЮ',Date.now()),testerFile);
        report({operation:'PAIRING_CONFIRMED',message:'ID сохранён только в ignored test configuration. Для диалога запустите отдельный start.'});
      } finally {terminal.close();}
    }
    report({operation:'SESSION_STOPPED',requests:campaign.requests,reason:controller.signal.aborted?'CANCELLED_OR_TIME_LIMIT':'REQUEST_LIMIT_OR_PAIRING_FINISHED',humanObservation:'NOT_VERIFIED'});
  } finally {
    controller.abort();clearTimeout(timer); await worker?.stop(); store?.close(); await release();
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}
main().catch(e=>{
  const errorClass=e instanceof MaxError?e.kind:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'TEST_SESSION_FAILURE';
  console.error(JSON.stringify({operation:'live_poll',errorClass}));process.exitCode=1;
});
