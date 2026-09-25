// Только test preload. Обычный entrypoint не импортирует этот файл и не принимает API override.
import { readFileSync } from 'node:fs';
const origin=new URL(process.env.WEBHOOK_SMOKE_ORIGIN??'');
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||process.env.MAX_EXPECTED_BOT_ID!=='777'
  ||readFileSync(process.env.MAX_BOT_TOKEN_FILE!,'utf8').trim()!=='offline-webhook-smoke-token')throw Error('SMOKE_ONLY');
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin!=='https://platform-api2.max.ru')throw Error('SMOKE_EXTERNAL_NETWORK_FORBIDDEN');
  return original(new URL(url.pathname+url.search,origin),init);
};
