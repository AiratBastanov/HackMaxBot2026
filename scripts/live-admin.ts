import { loadConfig, loadInspectionConfig } from '../src/config.js';
import { LiveMax, MaxError, ReadOnlyMax } from '../src/max.js';
import { Storage } from '../src/storage.js';
import { subscribeTestEndpoint } from '../src/subscription.js';

async function main() {
  const command = process.argv[2];
  if (!['inspect', 'subscribe', 'clear-auth-block'].includes(command ?? '')) throw new Error('COMMAND_INVALID');
  if(command==='inspect') {
    const access=loadInspectionConfig(process.env),max=new ReadOnlyMax(access);
    const bot=await max.me(access.expectedBotId),subscriptions=await max.subscriptions();
    console.log(JSON.stringify({operation:'live_inspect',botId:bot.user_id,expectedIdentity:access.expectedBotId?'MATCH':'PIN_BEFORE_STARTUP',subscriptions:subscriptions.length,incomingEvents:'NOT_VERIFIED'}));return;
  }
  const config = loadConfig(process.env);
  if (config.mode !== 'live') throw new Error('LIVE_REQUIRED');
  const max = new LiveMax(config);
  const endpoint = `${config.publicBaseUrl}/webhooks/max`;
  if(command==='subscribe') {
    await subscribeTestEndpoint(max,endpoint,process.env.LIVE_EXCLUSIVE_CONSUMER_CONFIRMED==='true',process.env.LIVE_SUBSCRIPTION_JOURNAL_DIR??'.review/live-admin',record=>console.log(JSON.stringify(record)));return;
  }
  const bot = await max.me();
  const subscriptions = await max.subscriptions();
  // В stdout нет URL другой подписки: он может содержать чужие секреты.
  const owned = subscriptions.filter(s => s.url === endpoint);
  console.log(JSON.stringify({ operation: 'live_inspect', botIdMatches: bot.user_id === config.botId,
    subscriptions: subscriptions.length, designatedEndpointCount: owned.length,
    foreignEndpointCount: subscriptions.length - owned.length, incomingEvents: 'NOT_VERIFIED' }));
  if (subscriptions.some(s => s.url !== endpoint) || subscriptions.length > 1) throw new Error('SUBSCRIPTION_OWNERSHIP_AMBIGUOUS');
  {
    if (owned.length !== 1) throw new Error('DESIGNATED_SUBSCRIPTION_MISSING');
    const store = new Storage(config.databasePath, config, false);
    try { store.setMeta('auth_blocked', 'false'); } finally { store.close(); }
    console.log(JSON.stringify({ operation: 'clear_auth_block', result: 'SUCCESS', previousOutbound: 'NOT_REPLAYED' }));
  }
}
main().catch(e => {
  const code = e instanceof MaxError ? e.kind : e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'LIVE_CONFIGURATION_OR_STORAGE_FAILURE';
  console.error(JSON.stringify({ operation: 'live_admin', errorClass: code, status: e instanceof MaxError ? e.status : undefined })); process.exitCode = 1;
});
