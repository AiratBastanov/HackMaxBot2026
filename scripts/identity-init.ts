import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadInspectionConfig} from '../src/config.js';
import {ReadOnlyMax} from '../src/max.js';

// Read-only MAX; вывод содержит только public identity и занятость webhook.
// Для другого бота создаётся новый файл, существующая identity не переписывается.
try {
 const target=process.argv[2]??'.env.organizer';
 if(!/^\.env\.[a-z0-9_-]+$/.test(target)||target.endsWith('.example')||existsSync(target))throw Error('NEW_ENV_FILE_REQUIRED');
 const access=loadInspectionConfig({...process.env,MAX_INSPECTION_SCOPE_CONFIRMED:'true'});
 const max=new ReadOnlyMax(access),bot=await max.me(access.expectedBotId),subscriptions=await max.subscriptions();
 const port=30000+createHash('sha256').update(`maxbot-consumer:${bot.user_id}`).digest().readUInt32BE()%20000;
 const template=readFileSync('.env.public.example','utf8').replace(/^MAX_EXPECTED_BOT_ID=.*$/m,`MAX_EXPECTED_BOT_ID=${bot.user_id}`).replace(/^MAX_CONSUMER_PORT=.*$/m,`MAX_CONSUMER_PORT=${port}`);
 writeFileSync(target,template,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({botId:bot.user_id,username:bot.username??null,webhookExists:subscriptions.length>0,config:target,consumerPort:port,connected:false}));
}catch{console.error('IDENTITY_INIT_FAILED: проверьте token file, identity, TLS и новый путь .env; значения секретов не выводятся.');process.exitCode=1;}
