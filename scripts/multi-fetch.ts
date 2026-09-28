import { CampaignClient } from '../src/data/campaign.js';
import { privateCampaign } from '../src/data/real-refresh.js';
const [root,...urls]=process.argv.slice(2);if(!root||!urls.length)throw Error('USE_PRIVATE_CAMPAIGN_URLS');
const client=new CampaignClient(privateCampaign(root));
try{await Promise.all(urls.map(async url=>{try{const p=await client.get(url);console.log(JSON.stringify({url:p.url,bytes:Buffer.byteLength(p.body),hash:p.hash}));}catch(e){console.log(JSON.stringify({url,error:e instanceof Error?e.message:'FAILED'}));}}));}
finally{client.close();console.log(JSON.stringify({requests:client.ledger.requests.length,bytes:client.ledger.bytes,wallMs:client.ledger.networkMs}));}
