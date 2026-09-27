import {readFileSync} from 'node:fs';
import {X509Certificate,createHash} from 'node:crypto';
import {getCACertificates} from 'node:tls';
import {loadConfig} from '../src/config.js';
import {pollingTiming} from '../src/polling-timeout.js';

// Та же загрузка конфигурации, что в start-polling. Без сети, consumer и вывода секретов.
try {
  const c=loadConfig(process.env);
  if(c.mode!=='live'||c.ingress!=='polling'||c.admissionMode!=='PUBLIC')throw Error('PUBLIC_POLLING_REQUIRED');
  const port=30000+createHash('sha256').update(`maxbot-consumer:${c.botId}`).digest().readUInt32BE()%20000;
  if(Number(process.env.MAX_CONSUMER_PORT)!==port)throw Error('CONSUMER_PORT_IDENTITY_MISMATCH');
  let extraCA='NOT_CONFIGURED';
  if(process.env.NODE_EXTRA_CA_CERTS) {
    const cert=new X509Certificate(readFileSync(process.env.NODE_EXTRA_CA_CERTS));
    if(!cert.ca||!getCACertificates('extra').some(pem=>new X509Certificate(pem).fingerprint256===cert.fingerprint256))throw Error('CA_NOT_LOADED_BEFORE_NODE');
    extraCA='LOADED_BY_NODE';
  }
  console.log(JSON.stringify({operation:'polling_configuration_ready',admission:c.admissionMode,ingress:c.ingress,
    requestTimeoutMs:c.requestTimeoutMs,pollDeadlineMs:pollingTiming(c.pollTimeoutSeconds).clientDeadlineMs,
    extraCA,consumerPort:port,databasePath:c.databasePath,snapshotPath:c.snapshotPath}));
}catch(e){console.error(JSON.stringify({operation:'polling_configuration_failed',reason:e instanceof Error?e.message:'CONFIGURATION'}));process.exitCode=1;}
