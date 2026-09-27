import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadInspectionConfig} from '../src/config.js';
import {ReadOnlyMax,MaxError} from '../src/max.js';

// Read-only MAX; вывод содержит только public identity и занятость webhook.
// Для другого бота создаётся новый файл, существующая identity не переписывается.
try {
 const target=process.argv[2]??'.env.organizer';
 if(!/^\.env\.[a-z0-9_-]+$/.test(target)||target.endsWith('.example')||existsSync(target))throw Error('NEW_ENV_FILE_REQUIRED');
 const access=loadInspectionConfig({...process.env,MAX_INSPECTION_SCOPE_CONFIRMED:'true'});
 const max=new ReadOnlyMax(access),bot=await max.me(access.expectedBotId),subscriptions=await max.subscriptions();
 const port=30000+createHash('sha256').update(`maxbot-consumer:${bot.user_id}`).digest().readUInt32BE()%20000;
 const project=`cultural-plan-bot-${bot.user_id}`;
 const botUrl=bot.username&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(bot.username)?`https://max.ru/${bot.username}`:null;
 let template=readFileSync('.env.public.example','utf8')
   .replace(/^MAX_EXPECTED_BOT_ID=.*$/m,`MAX_EXPECTED_BOT_ID=${bot.user_id}`)
   .replace(/^MAX_CONSUMER_PORT=.*$/m,`MAX_CONSUMER_PORT=${port}`)
   .replace(/^COMPOSE_PROJECT_NAME=.*$/m,`COMPOSE_PROJECT_NAME=${project}`);
 if(botUrl)template=`# Ссылка бота из GET /me: ${botUrl}\n`+template;
 if(process.env.NODE_EXTRA_CA_CERTS_CONTAINER) {
  if(process.env.NODE_EXTRA_CA_CERTS_CONTAINER!=='/run/secrets/max-official-root.pem')throw Error('CA_CONTAINER_PATH');
  template+='\nNODE_EXTRA_CA_CERTS_CONTAINER=/run/secrets/max-official-root.pem\n';
 }
 writeFileSync(target,template,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({botId:bot.user_id,username:bot.username??null,botUrl,webhookExists:subscriptions.length>0,config:target,composeProject:project,consumerPort:port,connected:false}));
}catch(e){
 const reasons:Record<string,string>={
  NEW_ENV_FILE_REQUIRED:'Нужен новый файл .env; существующая конфигурация сохранена. Для другого бота используйте отдельную копию репозитория.',
  INSPECTION_TOKEN_FILE:'Не удалось прочитать MAX_BOT_TOKEN_FILE. Создайте secrets/max_bot_token без расширения .txt и проверьте доступ контейнера к файлу.',
  INSPECTION_TOKEN_EMPTY:'Файл MAX_BOT_TOKEN_FILE пуст. Сохраните действующий токен своего бота одной строкой в UTF-8.',
  INSPECTION_TOKEN_REQUIRED:'Не задан токен. Укажите MAX_BOT_TOKEN_FILE с путём к локальному файлу токена своего бота.',
  INSPECTION_TOKEN_INVALID:'Вместо примера нужен действующий токен бота одной строкой, без кавычек и пробелов.',
  INSPECTION_DUPLICATE_TOKEN:'Задайте только MAX_BOT_TOKEN_FILE; значение MAX_BOT_TOKEN одновременно не требуется.',
  INSPECTION_BOT_ID_INVALID:'MAX_EXPECTED_BOT_ID должен содержать точный целочисленный ID бота.',
  CA_CONTAINER_PATH:'NODE_EXTRA_CA_CERTS_CONTAINER должен указывать на /run/secrets/max-official-root.pem.',
 };
 const code=e instanceof MaxError?e.kind:e instanceof Error&&Object.hasOwn(reasons,e.message)?e.message:'SETUP_FAILED';
 const reason=e instanceof MaxError
  ?e.kind==='AUTH'?'MAX не подтвердил токен или ожидаемый ID бота. Проверьте доступ к выбранному боту в кабинете владельца.'
    :'Проверка MAX не завершена. Проверьте доступ к API и официальный CA; конфигурация не создана.'
  :reasons[code]??'Не удалось создать конфигурацию. Проверьте наличие .env.public.example и право записи в папку копии.';
 console.error(JSON.stringify({operation:'identity_init_failed',code,reason}));process.exitCode=1;
}
