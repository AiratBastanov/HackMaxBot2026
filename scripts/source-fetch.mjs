// Ограниченный сбор только открытых страниц, с общим сохраняемым ledger.
// Повторный вызов читает успешные ответы из cache, не запускает новый обход.
import { InstitutionClient } from '../dist/src/data/institution-http.js';
const [root,...urls]=process.argv.slice(2);
if(!root||!urls.length)throw Error('USE_ROOT_URLS');
const client=new InstitutionClient(root);
for(const url of urls)try {
  const p=await client.get(url);console.log(JSON.stringify({url:p.url,bytes:Buffer.byteLength(p.body),hash:p.hash}));
}catch(e){console.log(JSON.stringify({url,error:e.message}));}
console.log(JSON.stringify({requests:client.ledger.requests.length,bytes:client.ledger.bytes,networkMs:client.ledger.networkMs}));
